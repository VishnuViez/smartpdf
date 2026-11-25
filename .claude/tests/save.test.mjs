import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { savePdf } = await import(path.join(ROOT, 'app/lib/pdf/rewrite/save-pdf.js'));

async function modelOf(name, pageIndex = 0) {
  const doc = await openDoc(lib, fixtureBytes(name));
  return loadPageModel(doc, pageIndex, lib.OPS);
}
/** Read the text back out of a saved PDF. */
async function textOf(bytes, pageIndex = 0) {
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const tc = await (await doc.getPage(pageIndex + 1)).getTextContent();
  return (tc.items || []).map(i => i.str).join('');
}
async function visibleTextOf(bytes, pageIndex = 0) {
  // render mode 3 text is still extractable; filter it out via the op list
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const ops = await page.getOperatorList();
  const inv = {}; for (const k in lib.OPS) inv[lib.OPS[k]] = k;
  let mode = 0; let out = '';
  for (let i = 0; i < ops.fnArray.length; i++) {
    const n = inv[ops.fnArray[i]];
    if (n === 'setTextRenderingMode') mode = ops.argsArray[i][0];
    else if (n === 'showText' && mode !== 3 && mode !== 7) {
      for (const g of ops.argsArray[i][0] || []) if (g && g.unicode) out += g.unicode;
    }
  }
  return out;
}

describe('save: producing a real PDF', () => {
  test('no edits produces a valid, loadable document', async () => {
    const model = await modelOf('standard14.pdf');
    const { bytes, changed } = await savePdf(fixtureBytes('standard14.pdf'),
      [{ pageIndex: 0, model, edits: new Map(), fieldValues: new Map() }]);
    assert.equal(changed, 0);
    const text = await textOf(bytes);
    assert.match(text, /Helvetica heading/);
  });

  test('THE POINT OF ALL THIS: an edit reaches the saved file', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    assert.ok(target, 'fixture text not found');

    const { bytes, changed, warnings } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[target.id, { text: 'REPLACED', fontSize: target.fontSize, colorHex: '#ff0000' }]]),
      fieldValues: new Map(),
    }]);
    assert.equal(changed, 1);
    assert.deepEqual(warnings, [], `unexpected warnings: ${JSON.stringify(warnings)}`);

    const visible = await visibleTextOf(bytes);
    assert.match(visible, /REPLACED/, 'the replacement is not visible in the output');
    assert.ok(!/Times body text/.test(visible), 'the original text is still visible');
  });

  test('untouched text survives the edit unchanged', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[target.id, { text: 'REPLACED' }]]),
      fieldValues: new Map(),
    }]);
    const visible = await visibleTextOf(bytes);
    assert.match(visible, /Helvetica heading/, 'unrelated heading was lost');
    assert.match(visible, /Courier mono/, 'unrelated text was lost');
    assert.match(visible, /Body line 0/, 'unrelated body text was lost');
  });

  test('original glyphs are HIDDEN, not deleted, so advances survive', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: 'X' }]]), fieldValues: new Map(),
    }]);
    // still present in the raw text layer...
    assert.match(await textOf(bytes), /Times body text/);
    // ...but not drawn
    assert.ok(!/Times body text/.test(await visibleTextOf(bytes)));
  });

  test('a moved element is written at its new position', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Courier mono/.test(s.text));
    const dx = 120, dy = -200;
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[target.id, { text: 'MOVED', x: target.x + dx, y: target.y + dy }]]),
      fieldValues: new Map(),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => /MOVED/.test(i.str));
    assert.ok(item, 'moved text missing from output');
    assert.ok(Math.abs(item.transform[4] - (target.x + dx)) < 1.5,
      `x is ${item.transform[4]}, expected ~${target.x + dx}`);
  });

  test('colour survives the round trip', async () => {
    const model = await modelOf('colors.pdf');
    const target = model.segments.find(s => /Black default/.test(s.text));
    const { bytes } = await savePdf(fixtureBytes('colors.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[target.id, { text: 'TEAL', colorHex: '#00d2a0' }]]),
      fieldValues: new Map(),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const ops = await (await doc.getPage(1)).getOperatorList();
    const inv = {}; for (const k in lib.OPS) inv[lib.OPS[k]] = k;
    const colours = ops.argsArray
      .filter((_, i) => inv[ops.fnArray[i]] === 'setFillRGBColor')
      .map(a => String(a[0]).toLowerCase());
    assert.ok(colours.includes('#00d2a0'), `expected #00d2a0 in ${JSON.stringify(colours)}`);
  });

  test('form field values are written into the page', async () => {
    const model = await modelOf('form-underlines.pdf');
    assert.ok(model.fields.length >= 2);
    const [first, second] = model.fields;
    const { bytes, changed } = await savePdf(fixtureBytes('form-underlines.pdf'), [{
      pageIndex: 0, model, edits: new Map(),
      fieldValues: new Map([[first.id, 'Ada Lovelace'], [second.id, '555-0100']]),
    }]);
    assert.equal(changed, 2);
    const visible = await visibleTextOf(bytes);
    assert.match(visible, /Ada Lovelace/);
    assert.match(visible, /555-0100/);
    assert.match(visible, /Name/, 'the form labels were lost');
  });

  test('comb values are written one character per cell', async () => {
    const model = await modelOf('form-comb.pdf');
    const comb = model.fields.find(f => f.comb && f.cells.length === 12);
    const { bytes } = await savePdf(fixtureBytes('form-comb.pdf'), [{
      pageIndex: 0, model, edits: new Map(), fieldValues: new Map([[comb.id, 'INV2026']]),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();

    // getTextContent MERGES adjacent draws, so item count means nothing here.
    // What matters: every character is present, and each sits in its own cell.
    const items = (tc.items || []).filter(i =>
      i.transform[4] >= comb.rect.x - 2 &&
      i.transform[4] <= comb.rect.x + comb.rect.w + 2 &&
      i.transform[5] >= comb.rect.y - 2 &&
      i.transform[5] <= comb.rect.y + comb.rect.h + 2);
    const combined = items.map(i => i.str).join('').replace(/\s+/g, '');
    assert.equal(combined, 'INV2026', `comb text came out as ${JSON.stringify(combined)}`);

    const xs = items.filter(i => i.str.trim()).map(i => i.transform[4]).sort((a, b) => a - b);
    assert.ok(xs.length >= 2);
    assert.ok(xs[0] >= comb.cells[0].x - 2, 'first character sits before the first cell');
    const lastCell = comb.cells[6];
    assert.ok(xs[xs.length - 1] <= lastCell.x + lastCell.w + 2,
      'characters ran past the cells they belong to');
    // spacing must reflect the cell pitch, not ordinary text advance
    assert.ok(xs[1] - xs[0] > 10, `characters are bunched together (${xs[1] - xs[0]} apart)`);
  });

  test('text no font can represent leaves the ORIGINAL intact and says so', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    const { bytes, warnings } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[target.id, { text: '中文' }]]),      // no Latin font can draw this
      fieldValues: new Map(),
    }]);
    assert.ok(warnings.some(w => w.kind === 'skipped'), `expected a skip warning: ${JSON.stringify(warnings)}`);
    // the crucial part: we must NOT have destroyed the original
    const visible = await visibleTextOf(bytes);
    assert.match(visible, /Times body text/,
      'the original was hidden even though no replacement could be written');
  });

  test('multi-page documents only rewrite the page that changed', async () => {
    const model = await modelOf('multipage.pdf', 3);
    const target = model.segments.find(s => /Page 4 of 40/.test(s.text));
    assert.ok(target);
    const { bytes } = await savePdf(fixtureBytes('multipage.pdf'), [{
      pageIndex: 3, model, edits: new Map([[target.id, { text: 'EDITED PAGE' }]]), fieldValues: new Map(),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    assert.equal(doc.numPages, 40);
    assert.match(await visibleTextOf(bytes, 3), /EDITED PAGE/);
    assert.match(await visibleTextOf(bytes, 0), /Page 1 of 40/, 'page 1 was disturbed');
    assert.match(await visibleTextOf(bytes, 39), /Page 40 of 40/, 'page 40 was disturbed');
  });

  test('output is a valid PDF that reloads cleanly', async () => {
    for (const name of ['standard14.pdf', 'colors.pdf', 'form-underlines.pdf', 'rotations.pdf']) {
      const model = await modelOf(name);
      const target = model.segments[0];
      if (!target) continue;
      const { bytes } = await savePdf(fixtureBytes(name), [{
        pageIndex: 0, model, edits: new Map([[target.id, { text: 'Z' }]]), fieldValues: new Map(),
      }]);
      const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
      assert.ok(doc.numPages > 0, `${name}: output has no pages`);
      await (await doc.getPage(1)).getOperatorList();     // must not throw
    }
  });
});

describe('save: text must never come out partial or missing', () => {
  /** Force a model's font to behave like an embedded subset with limited glyphs. */
  function restrictFont(model, allowed) {
    for (const f of model.fonts.values()) {
      f.isSubset = true;
      f.unicodeToChar = new Map([...allowed].map(ch => [ch, ch.charCodeAt(0)]));
    }
  }

  test('REGRESSION: a subset font that cannot encode the text still writes ALL of it', async () => {
    // Previously "REPLACED" came out as "EE" — only the encodable characters —
    // while the original was hidden, so text appeared to vanish or move.
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    restrictFont(model, 'Timesbodytex ');          // no R, P, L, A, C, D

    const { bytes, warnings, changed } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: 'REPLACED' }]]), fieldValues: new Map(),
    }]);
    assert.equal(changed, 1);
    const visible = await visibleTextOf(bytes);
    assert.match(visible, /REPLACED/, `text came out partial or missing: ${JSON.stringify(visible)}`);
    assert.ok(warnings.some(w => w.kind === 'substituted'), 'substitution happened without telling the user');
  });

  test('substituted text lands at the ORIGINAL position, not offset', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Times body text/.test(s.text));
    const { x, baseline } = target;
    restrictFont(model, 'Times ');

    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: 'ZQXJKW' }]]), fieldValues: new Map(),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => /ZQXJKW/.test(i.str));
    assert.ok(item, 'substituted text missing entirely');
    assert.ok(Math.abs(item.transform[4] - x) < 0.5, `x drifted: ${item.transform[4]} vs ${x}`);
    assert.ok(Math.abs(item.transform[5] - baseline) < 0.5, `baseline drifted: ${item.transform[5]} vs ${baseline}`);
  });

  test('the substitute keeps serif/mono/weight characteristics', async () => {
    const model = await modelOf('standard14.pdf');
    const target = model.segments.find(s => /Courier mono/.test(s.text));
    for (const f of model.fonts.values()) {
      f.isSubset = true;
      f.unicodeToChar = new Map();
      f.flags = { ...f.flags, fixedPitch: true };
    }
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: 'MONO' }]]), fieldValues: new Map(),
    }]);
    const raw = Buffer.from(bytes).toString('latin1');
    assert.match(raw, /Courier/, 'a monospace original was not substituted with Courier');
  });

  test('REGRESSION: a resized element keeps its baseline inside the box', async () => {
    // The baseline offset must scale with the box, or text drifts on resize.
    const model = await modelOf('standard14.pdf');
    const t = model.segments.find(s => /Times body text/.test(s.text));
    const factor = 2;
    const patch = {
      text: 'BIGGER',
      x: t.x, y: t.y, w: t.w * factor, h: t.h * factor, fontSize: t.fontSize * factor,
    };
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[t.id, patch]]), fieldValues: new Map(),
    }]);
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => /BIGGER/.test(i.str));
    assert.ok(item);
    const expected = patch.y + (t.baseline - t.y) * factor;
    assert.ok(Math.abs(item.transform[5] - expected) < 0.01,
      `baseline ${item.transform[5]} should be ${expected} (offset must scale with the box)`);
    // and it must sit within the resized box
    assert.ok(item.transform[5] >= patch.y && item.transform[5] <= patch.y + patch.h,
      'baseline fell outside the resized box');
  });

  test('an unmoved edit lands exactly where the original text was', async () => {
    for (const name of ['standard14.pdf', 'colors.pdf']) {
      const model = await modelOf(name);
      for (const t of model.segments.slice(0, 3)) {
        const { bytes } = await savePdf(fixtureBytes(name), [{
          pageIndex: 0, model, edits: new Map([[t.id, { text: 'ZZ' }]]), fieldValues: new Map(),
        }]);
        const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
        const tc = await (await doc.getPage(1)).getTextContent();
        const item = (tc.items || []).find(i => i.str.includes('ZZ'));
        assert.ok(item, `${name}: edit missing`);
        assert.ok(Math.abs(item.transform[4] - t.x) < 0.01, `${name}: x drifted by ${item.transform[4] - t.x}`);
        assert.ok(Math.abs(item.transform[5] - t.baseline) < 0.01, `${name}: baseline drifted by ${item.transform[5] - t.baseline}`);
      }
    }
  });
});

describe('WYSIWYG: preview and export must agree', () => {
  test('both sides pick the SAME substitute family', async () => {
    const { standardSubstitute } = await import(path.join(ROOT, 'app/lib/pdf/model/fonts.js'));
    const { createFontRecord } = await import(path.join(ROOT, 'app/lib/pdf/model/fonts.js'));
    const { StandardFonts } = await import('pdf-lib');

    const cases = [
      [{ flags: { fixedPitch: true } }, /Courier/],
      [{ flags: { serif: true } }, /Times/],
      [{ flags: {} }, /Helvetica/],
    ];
    for (const [rec, want] of cases) {
      const sub = standardSubstitute(rec);
      assert.ok(StandardFonts[sub.std], `${sub.std} is not a real StandardFonts key`);
      assert.match(sub.std, want, 'exporter would pick a different family');
      assert.match(sub.css, want, 'preview CSS would show a different family');
    }
    // weight and slope carry across to both
    const bold = standardSubstitute(createFontRecord({ key: 'k', baseFont: 'Foo-Bold' }));
    assert.match(bold.std, /Bold/);
    assert.equal(bold.weight, 700);
    const ital = standardSubstitute(createFontRecord({ key: 'k', baseFont: 'Foo-Italic' }));
    assert.ok(/Italic|Oblique/.test(ital.std));
    assert.equal(ital.italic, true);
  });

  test('the preview font resolver makes the same call as the exporter', async () => {
    const { resolvePreviewFont } = await import(path.join(ROOT, 'app/lib/pdf/model/preview-font.js'));
    const { createFontRecord } = await import(path.join(ROOT, 'app/lib/pdf/model/fonts.js'));

    const subsetRec = createFontRecord({
      key: 'g_d0_f1', baseFont: 'MUIQHM+Gotham-Book',
      toUnicode: new Map([[77, 'M'], [65, 'A'], [67, 'C']]),
    });
    // text the subset CAN draw -> keep the document's own face
    const keep = resolvePreviewFont('MAC', subsetRec, 12);
    assert.equal(keep.substituted, false);
    assert.match(keep.css, /g_d0_f1/, 'preview should use the embedded face when it can');

    // text it CANNOT -> both sides substitute
    const swap = resolvePreviewFont('MACY', subsetRec, 12);
    assert.equal(swap.substituted, true);
    assert.ok(!/g_d0_f1/.test(swap.css), 'preview kept the embedded face the exporter will not use');
    assert.match(swap.css, /Helvetica/);
  });

  test('a NON-subset font is never needlessly substituted in the preview', async () => {
    const { resolvePreviewFont } = await import(path.join(ROOT, 'app/lib/pdf/model/preview-font.js'));
    const { createFontRecord } = await import(path.join(ROOT, 'app/lib/pdf/model/fonts.js'));
    const rec = createFontRecord({ key: 'g_d0_f2', baseFont: 'Helvetica',
      toUnicode: new Map([[84, 'T']]) });
    const r = resolvePreviewFont('Anything at all', rec, 10);
    assert.equal(r.substituted, false, 'a full font was needlessly swapped in the preview');
  });
});

describe('save: must never destroy a page it cannot read', () => {
  test('REGRESSION: an undecodable content stream leaves the page untouched', async () => {
    // Simulate a stream this build cannot decompress by corrupting the filtered
    // bytes while leaving the /Filter claim in place.
    const { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFArray } = await import('pdf-lib');
    const src = await PDFDocument.load(fixtureBytes('standard14.pdf'), { ignoreEncryption: true });
    const page = src.getPages()[0];
    const ctx = page.node.context;
    const c = page.node.Contents();
    const st = c instanceof PDFArray ? ctx.lookup(c.get(0)) : (c instanceof PDFRawStream ? c : ctx.lookup(c));
    st.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    st.contents = new Uint8Array([6, 225, 1, 2, 3, 4, 5]);       // not valid flate
    st.dict.set(PDFName.of('Length'), PDFNumber.of(7));
    const broken = await src.save({ useObjectStreams: false });

    const model = await modelOf('standard14.pdf');   // a plausible model
    const target = model.segments[0];
    const { bytes, warnings, changed } = await savePdf(broken, [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: 'SHOULD NOT APPEAR' }]]),
      fieldValues: new Map(),
    }]);

    assert.equal(changed, 0, 'a page we could not read was reported as changed');
    assert.ok(warnings.some(w => w.kind === 'unreadable'),
      `no warning for the unreadable page: ${JSON.stringify(warnings)}`);
    // the output must not consist solely of our injected text
    const raw = Buffer.from(bytes).toString('latin1');
    assert.ok(!raw.includes('SHOULD NOT APPEAR'),
      'text was written into a page whose original content could not be read');
  });
});

describe('save: edited text must not run through its neighbours', () => {
  test('THE COLLISION CASE: long replacement text is fitted, not overlapped', async () => {
    const { availableWidth, measureText } = await import(path.join(ROOT, 'app/lib/pdf/model/fitting.js'));
    const model = await modelOf('form-underlines.pdf');
    const row = model.segments.filter(s => Math.abs(s.baseline - 320) < 3).sort((a, b) => a.x - b.x);
    const target = row[0];                       // "Name:" — bounded by its blank
    const room = availableWidth(target, model);
    const long = 'Applicant Full Legal Name';

    const fr = model.fonts.get(target.fontKey);
    assert.ok(measureText(long, fr, target.fontSize) > room,
      'fixture no longer exercises overflow');

    const { bytes, warnings } = await savePdf(fixtureBytes('form-underlines.pdf'), [{
      pageIndex: 0, model, edits: new Map([[target.id, { text: long }]]), fieldValues: new Map(),
    }]);

    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => i.str.includes('Applicant'));
    assert.ok(item, 'replacement missing from the file');

    // Whatever fitting was applied, the drawn width must respect the space,
    // or the user must have been told it could not.
    const drawnWidth = item.width;
    const overflowed = drawnWidth > room + 1;
    if (overflowed) {
      assert.ok(warnings.some(w => w.kind === 'overflow'),
        `text overflowed by ${(drawnWidth - room).toFixed(1)}pt with no warning`);
    } else {
      assert.ok(drawnWidth <= room + 1,
        `drawn width ${drawnWidth.toFixed(1)} exceeds available ${room.toFixed(1)}`);
    }
  });

  test('fitting operators reach the file as native Tz / Tc', async () => {
    const model = await modelOf('form-underlines.pdf');
    const row = model.segments.filter(s => Math.abs(s.baseline - 320) < 3).sort((a, b) => a.x - b.x);
    const { bytes } = await savePdf(fixtureBytes('form-underlines.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[row[0].id, { text: 'Applicant Full Legal Name' }]]),
      fieldValues: new Map(),
    }]);
    const raw = Buffer.from(bytes).toString('latin1');
    assert.ok(/ Tc\b/.test(raw) || / Tz\b/.test(raw),
      'no tracking or condensing operator was emitted for text that needed fitting');
  });

  test('text that comfortably fits is emitted with NO fitting operators', async () => {
    const model = await modelOf('standard14.pdf');
    const t = model.segments.find(s => /Helvetica heading/.test(s.text));
    const { bytes } = await savePdf(fixtureBytes('standard14.pdf'), [{
      pageIndex: 0, model, edits: new Map([[t.id, { text: 'Hi' }]]), fieldValues: new Map(),
    }]);
    const raw = Buffer.from(bytes).toString('latin1');
    const appended = raw.slice(raw.lastIndexOf('BT'));
    assert.ok(!/ Tz\b/.test(appended), 'short text was needlessly condensed');
    assert.ok(!/-[\d.]+ Tc\b/.test(appended), 'short text was needlessly tracked');
  });
});
