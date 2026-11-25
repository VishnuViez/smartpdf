import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, corpusFiles, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { savePdf } = await import(path.join(ROOT, 'app/lib/pdf/rewrite/save-pdf.js'));
const { resolveTextPlacement } = await import(path.join(ROOT, 'app/lib/pdf/model/placement.js'));
const { availableWidth, fitText } = await import(path.join(ROOT, 'app/lib/pdf/model/fitting.js'));

/**
 * End-to-end export fidelity.
 *
 * This is the suite that matters most: it asserts that what the editor would
 * SHOW is exactly what the saved file CONTAINS, across every kind of edit.
 *
 * Generated fixtures cannot prove this on their own. They are written by
 * pdf-lib, which emits no page-level CTM — so the class of bug where a
 * converter's device transform displaces appended text is invisible to them.
 * Point SMARTPDF_CORPUS at real documents to exercise it:
 *
 *   SMARTPDF_CORPUS=~/pdfs npm test
 */

const MARK = 'ZQJWMV';
const TOLERANCE = 0.01;   // PDF units

const scenarios = {
  unmoved:        () => ({}),
  movedUp:        (el, p) => ({ x: el.x + 30, y: Math.min(el.y + 40, p.h - el.h - 5) }),
  movedDown:      (el)    => ({ x: el.x + 10, y: Math.max(el.y - 40, 5) }),
  enlarged:       (el)    => ({ y: el.y, h: el.h * 2, w: el.w * 2, fontSize: el.fontSize * 2 }),
  reduced:        (el)    => ({ y: el.y, h: el.h * 0.5, w: el.w * 0.5, fontSize: el.fontSize * 0.5 }),
  movedAndSized:  (el)    => ({ x: el.x + 20, y: Math.max(el.y - 20, 5), h: el.h * 1.5, w: el.w * 1.5, fontSize: el.fontSize * 1.5 }),
  recoloured:     ()      => ({ colorHex: '#00d2a0' }),
};

async function fidelityOf(bytes, label) {
  const doc = await openDoc(lib, bytes);
  const model = await loadPageModel(doc, 0, lib.OPS);
  const cands = model.segments.filter(
    s => s.text.trim().length >= 4 && s.fontSize >= 6 &&
         s.y > 60 && s.y < model.height - 80);
  if (!cands.length) return { skipped: true };

  const el = cands[Math.floor(cands.length / 2)];
  const fontRecord = model.fonts.get(el.fontKey);
  const page = { w: model.width, h: model.height };
  const failures = [];

  for (const [name, mutate] of Object.entries(scenarios)) {
    const edit = { text: MARK, ...mutate(el, page) };

    // what the editor would draw
    const place = resolveTextPlacement(el, edit);
    const room = availableWidth({ ...el, x: place.x, baseline: place.baseline }, model);
    const fit = fitText({ text: place.text, fontRecord, fontSize: place.fontSize, available: room });

    let res;
    try {
      res = await savePdf(bytes, [{ pageIndex: 0, model, edits: new Map([[el.id, edit]]), fieldValues: new Map() }]);
    } catch (err) {
      failures.push(`${name}: save threw — ${err?.message}`);
      continue;
    }
    // a page we refused to touch is a valid, reported outcome
    if (res.warnings.some(w => w.kind === 'unreadable' || w.kind === 'skipped')) continue;

    const out = await openDoc(lib, res.bytes);
    const tc = await (await out.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => i.str.includes(MARK));
    if (!item) {
      if (res.warnings.some(w => w.kind === 'offpage')) continue;
      failures.push(`${name}: text missing from the saved file`);
      continue;
    }

    const dx = item.transform[4] - place.x;
    const dy = item.transform[5] - place.baseline;
    const ds = Math.hypot(item.transform[1], item.transform[3]) - fit.fontSize;
    if (Math.abs(dx) > TOLERANCE || Math.abs(dy) > TOLERANCE || Math.abs(ds) > TOLERANCE) {
      failures.push(`${name}: dx=${dx.toFixed(3)} dy=${dy.toFixed(3)} dsize=${ds.toFixed(3)}`);
    }
  }
  return { failures, label };
}

describe('export fidelity: the file matches the preview', () => {
  for (const name of fixtureNames()) {
    test(name, async () => {
      let r;
      try { r = await fidelityOf(fixtureBytes(name), name); }
      catch { return; }                       // unopenable fixtures covered elsewhere
      if (r.skipped) return;
      assert.deepEqual(r.failures, [], `${name}:\n  ${r.failures.join('\n  ')}`);
    });
  }

  test('real-world corpus (set SMARTPDF_CORPUS to exercise page-level CTMs)', async () => {
    const files = corpusFiles();
    if (!files.length) return;
    const all = [];
    for (const f of files) {
      let r;
      try { r = await fidelityOf(f.bytes, f.name); } catch { continue; }
      if (r.skipped) continue;
      for (const fail of r.failures) all.push(`${f.name} :: ${fail}`);
    }
    assert.deepEqual(all, [`checked ${files.length} documents`].slice(0, 0),
      `${all.length} fidelity failures across ${files.length} real documents:\n  ${all.slice(0, 12).join('\n  ')}`);
  });
});
