import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { redactPdf } = await import(path.join(ROOT, 'app/lib/pdf/redact/redact.js'));
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));

const textOf = async (bytes, pageIndex = 0) =>
  (await (await (await openDoc(lib, bytes)).getPage(pageIndex + 1)).getTextContent())
    .items.map(i => i.str).join('');

/** Find a segment by its text and return the rectangle covering it. */
async function regionFor(name, match, pageIndex = 0) {
  const doc = await openDoc(lib, fixtureBytes(name));
  const model = await loadPageModel(doc, pageIndex, lib.OPS);
  const seg = model.segments.find(s => match.test(s.text));
  assert.ok(seg, `fixture has no segment matching ${match}`);
  return {
    seg,
    region: { pageIndex, x: seg.x - 2, y: seg.y - 2, w: seg.w + 4, h: seg.h + 4 },
  };
}

describe('redaction: the text must be GONE, not covered', () => {
  test('THE WHOLE POINT: redacted text cannot be extracted afterwards', async () => {
    const { seg, region } = await regionFor('standard14.pdf', /Times body text/);
    const before = await textOf(fixtureBytes('standard14.pdf'));
    assert.match(before, /Times body text/, 'fixture precondition failed');

    const { bytes, report } = await redactPdf(fixtureBytes('standard14.pdf'), [region]);
    const after = await textOf(bytes);

    assert.ok(!/Times body text/.test(after),
      `redacted text is still extractable: ${JSON.stringify(after)}`);
    assert.ok(report.textOpsErased > 0, 'no text operators were erased');
    void seg;
  });

  test('the glyphs are absent from the FILE, not merely from extraction', async () => {
    const { region } = await regionFor('standard14.pdf', /Courier mono/);
    const { bytes } = await redactPdf(fixtureBytes('standard14.pdf'), [region]);
    const raw = Buffer.from(bytes).toString('latin1');
    // the fixture writes this as a literal string in the content stream
    assert.ok(!raw.includes('Courier mono'),
      'the redacted text survives in the raw bytes and can be recovered with a hex editor');
  });

  test('text OUTSIDE the region is untouched', async () => {
    const { region } = await regionFor('standard14.pdf', /Times body text/);
    const { bytes } = await redactPdf(fixtureBytes('standard14.pdf'), [region]);
    const after = await textOf(bytes);
    assert.match(after, /Helvetica heading/, 'unrelated heading was destroyed');
    assert.match(after, /Courier mono/, 'unrelated text was destroyed');
    assert.match(after, /Body line 0/, 'unrelated body text was destroyed');
  });

  test('a covering box really is painted', async () => {
    const { region } = await regionFor('standard14.pdf', /Times body text/);
    const { bytes } = await redactPdf(fixtureBytes('standard14.pdf'), [region]);
    const doc = await openDoc(lib, bytes);
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const ops = await page.getOperatorList();
    const inv = {}; for (const k in lib.OPS) inv[lib.OPS[k]] = k;
    // a filled path must have been added
    const fills = ops.fnArray.filter((f, i) => {
      void i; return /^(fill|eoFill|constructPath)$/.test(inv[f] || '');
    }).length;
    assert.ok(fills > 0, 'no fill operation was emitted for the cover box');
    void vp;
  });

  test('several regions across several pages all take effect', async () => {
    const a = await regionFor('multipage.pdf', /Page 1 of 40/, 0);
    const b = await regionFor('multipage.pdf', /Page 3 of 40/, 2);
    const { bytes, report } = await redactPdf(fixtureBytes('multipage.pdf'),
      [a.region, b.region]);
    assert.equal(report.pages, 2);
    assert.ok(!/Page 1 of 40/.test(await textOf(bytes, 0)));
    assert.ok(!/Page 3 of 40/.test(await textOf(bytes, 2)));
    assert.match(await textOf(bytes, 1), /Page 2 of 40/, 'an untouched page lost its text');
  });

  test('document metadata is cleared, since it can repeat the redacted text', async () => {
    const { region } = await regionFor('standard14.pdf', /Times body text/);
    const { bytes, report } = await redactPdf(fixtureBytes('standard14.pdf'), [region]);
    assert.equal(report.metadataStripped, true);
    const { PDFDocument } = await import('pdf-lib');
    const out = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    assert.ok(!out.getTitle(), 'title survived');
    assert.ok(!out.getAuthor(), 'author survived');
  });

  test('metadata can be kept when the caller asks', async () => {
    const { region } = await regionFor('standard14.pdf', /Times body text/);
    const { report } = await redactPdf(fixtureBytes('standard14.pdf'), [region],
      { stripMetadata: false });
    assert.equal(report.metadataStripped, false);
  });

  test('images overlapping a region are removed, not covered', async () => {
    // page 2 of the verification fixture is a full-width image
    const doc = await openDoc(lib, fixtureBytes('no-text.pdf'));
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const { bytes, report } = await redactPdf(fixtureBytes('no-text.pdf'),
      [{ pageIndex: 0, x: 0, y: 0, w: base.width, h: base.height }]);
    void report;
    const out = await openDoc(lib, bytes);
    const ops = await (await out.getPage(1)).getOperatorList();
    const inv = {}; for (const k in lib.OPS) inv[lib.OPS[k]] = k;
    const paints = ops.fnArray.filter(f => /paintImage|paintJpeg/.test(inv[f] || '')).length;
    assert.equal(paints, 0, 'an image inside the redaction region survived');
  });

  test('the output is a valid PDF with the same page count', async () => {
    for (const name of ['standard14.pdf', 'colors.pdf', 'form-underlines.pdf']) {
      const original = await openDoc(lib, fixtureBytes(name));
      const { bytes } = await redactPdf(fixtureBytes(name),
        [{ pageIndex: 0, x: 40, y: 600, w: 200, h: 40 }]);
      const out = await openDoc(lib, bytes);
      assert.equal(out.numPages, original.numPages, `${name}: page count changed`);
      await (await out.getPage(1)).getOperatorList();
    }
  });

  test('a page whose content cannot be read is REFUSED, never falsely boxed', async () => {
    // a box drawn over content we could not parse would look redacted but
    // leave the text intact — the worst possible outcome
    const { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFArray } = await import('pdf-lib');
    const src = await PDFDocument.load(fixtureBytes('standard14.pdf'), { ignoreEncryption: true });
    const page = src.getPages()[0];
    const ctx = page.node.context;
    const c = page.node.Contents();
    const st = c instanceof PDFArray ? ctx.lookup(c.get(0)) : (c instanceof PDFRawStream ? c : ctx.lookup(c));
    st.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    st.contents = new Uint8Array([6, 225, 9, 9, 9]);
    st.dict.set(PDFName.of('Length'), PDFNumber.of(5));
    const broken = await src.save({ useObjectStreams: false });

    const { report } = await redactPdf(broken, [{ pageIndex: 0, x: 0, y: 0, w: 300, h: 300 }]);
    assert.ok(report.warnings.some(w => w.kind === 'unreadable'),
      `expected a refusal for the unreadable page: ${JSON.stringify(report.warnings)}`);
    assert.equal(report.pages, 0, 'an unreadable page was reported as redacted');
  });

  test('encrypted documents are refused', async () => {
    const { protectPdf } = await import(path.join(ROOT, 'app/lib/pdf/security/protect.js'));
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'pw' });
    await assert.rejects(
      () => redactPdf(locked, [{ pageIndex: 0, x: 0, y: 0, w: 100, h: 100 }]),
      e => e.name === 'EncryptedDocumentError');
  });

  test('no regions is a no-op that still returns a valid document', async () => {
    const { bytes, report } = await redactPdf(fixtureBytes('standard14.pdf'), []);
    assert.equal(report.pages, 0);
    assert.match(await textOf(bytes), /Helvetica heading/);
  });
});

describe('redaction: a region that catches part of a line', () => {
  /** A line of text whose START is outside the region but which runs through it. */
  async function docWithLongLine() {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const d = await PDFDocument.create();
    const page = d.addPage([400, 200]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    page.drawText('Card on file: 4539 8842 1177 3920', { x: 20, y: 150, size: 12, font });
    page.drawText('Untouched second line', { x: 20, y: 100, size: 12, font });
    return d.save({ useObjectStreams: false });
  }

  test('REGRESSION: a line entering the region from the left is still erased', async () => {
    // Found by dragging a box over just the digits in the browser: the report
    // said three runs erased for four regions, and the card number survived
    // under its black box. Selecting on the operator's ORIGIN missed it,
    // because the line begins at x=20, well left of the box.
    const bytes = await docWithLongLine();
    assert.match(await textOf(bytes), /4539 8842 1177 3920/, 'fixture precondition failed');

    // the digits begin around x=95; the line's origin at x=20 is outside
    const { bytes: out, report } = await redactPdf(bytes,
      [{ pageIndex: 0, x: 95, y: 146, w: 120, h: 16 }]);

    assert.ok(report.textOpsErased >= 1, 'the line through the region was not erased');
    const after = await textOf(out);
    assert.ok(!/4539/.test(after), `the card number survived: ${JSON.stringify(after)}`);
    assert.ok(!/8842 1177 3920/.test(after), 'part of the card number survived');
    assert.match(after, /Untouched second line/, 'an unrelated line was destroyed');
  });

  test('the box is widened to cover whatever the partial selection erased', async () => {
    // Erasure cannot split a line, so a partial selection removes all of it.
    // If the box stayed where the user drew it, the rest of the line would
    // vanish with nothing over it and the page would look damaged.
    const bytes = await docWithLongLine();
    const { report } = await redactPdf(bytes, [{ pageIndex: 0, x: 95, y: 146, w: 120, h: 16 }]);
    assert.ok(report.boxesWidened > 0, 'the cover box was not widened to match');
  });

  test('a region over empty space erases nothing and widens nothing', async () => {
    const bytes = await docWithLongLine();
    const { bytes: out, report } = await redactPdf(bytes,
      [{ pageIndex: 0, x: 20, y: 30, w: 120, h: 20 }]);
    assert.equal(report.textOpsErased, 0);
    assert.equal(report.boxesWidened, 0);
    assert.match(await textOf(out), /4539 8842 1177 3920/, 'untouched text was erased');
  });

  test('without glyph geometry the caller is WARNED, and nothing is missed', async () => {
    // The fallback over-estimates run widths so a crossing line is still
    // caught. Erasing too much is visible; leaving text under a box is not.
    const bytes = await docWithLongLine();
    const { bytes: out, report } = await redactPdf(bytes,
      [{ pageIndex: 0, x: 95, y: 146, w: 120, h: 16 }]);
    assert.ok(report.warnings.some(w => w.kind === 'estimated-extents'),
      'the estimate was used without telling the caller');
    assert.ok(!/4539/.test(await textOf(out)));
  });

  test('supplied glyph geometry suppresses the estimate warning', async () => {
    const bytes = await docWithLongLine();
    const doc = await openDoc(lib, bytes);
    const model = await loadPageModel(doc, 0, lib.OPS);
    const { bytes: out, report } = await redactPdf(bytes,
      [{ pageIndex: 0, x: 95, y: 146, w: 120, h: 16 }],
      { pageRuns: async () => model.runs });

    assert.ok(!report.warnings.some(w => w.kind === 'estimated-extents'),
      `unexpected estimate warning: ${JSON.stringify(report.warnings)}`);
    assert.ok(!/4539/.test(await textOf(out)), 'the card number survived');
    assert.match(await textOf(out), /Untouched second line/);
  });

  test('exact geometry does NOT erase a neighbour the estimate would reach', async () => {
    // Two short runs side by side. A box over the right-hand one must leave
    // the left-hand one alone when real widths are known.
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const d = await PDFDocument.create();
    const page = d.addPage([400, 120]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    page.drawText('LEFT', { x: 20, y: 60, size: 12, font });
    page.drawText('SECRET', { x: 200, y: 60, size: 12, font });
    const bytes = await d.save({ useObjectStreams: false });

    const doc = await openDoc(lib, bytes);
    const model = await loadPageModel(doc, 0, lib.OPS);
    const { bytes: out } = await redactPdf(bytes,
      [{ pageIndex: 0, x: 198, y: 56, w: 60, h: 16 }],
      { pageRuns: async () => model.runs });

    const after = await textOf(out);
    assert.ok(!/SECRET/.test(after), 'the selected text survived');
    assert.match(after, /LEFT/, 'a neighbour outside the box was erased');
  });
});
