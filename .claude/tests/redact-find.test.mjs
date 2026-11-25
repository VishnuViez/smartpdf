import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { findInSegments, sameRegion } = await import(path.join(ROOT, 'app/lib/pdf/redact/find.js'));
const { redactPdf } = await import(path.join(ROOT, 'app/lib/pdf/redact/redact.js'));
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));

/** A document where the same name appears on two pages, as real ones do. */
async function repeatedNameDoc() {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([400, 220]);
  p1.drawText('Patient name: Priya Raghunathan', { x: 20, y: 180, size: 12, font });
  p1.drawText('Insurer: Northgate Mutual', { x: 20, y: 150, size: 12, font });
  const p2 = d.addPage([400, 220]);
  p2.drawText('Account holder: Priya Raghunathan', { x: 20, y: 180, size: 12, font });
  p2.drawText('Total billed: GBP 1,240.00', { x: 20, y: 150, size: 12, font });
  return d.save({ useObjectStreams: false });
}

async function modelsOf(bytes) {
  const doc = await openDoc(lib, bytes);
  const out = [];
  for (let i = 0; i < doc.numPages; i++) out.push(await loadPageModel(doc, i, lib.OPS));
  return out;
}

const textOf = async (bytes, pageIndex) =>
  (await (await (await openDoc(lib, bytes)).getPage(pageIndex + 1)).getTextContent())
    .items.map(i => i.str).join(' ');

describe('find: catching every occurrence, not just the visible one', () => {
  test('THE WHOLE POINT: a name blacked out on page 1 is also found on page 2', async () => {
    // The classic leak. The boxes drawn by hand are perfect and the document
    // still carries the name, because nobody scrolled to the appendix.
    const bytes = await repeatedNameDoc();
    const models = await modelsOf(bytes);
    const hits = models.flatMap(m => findInSegments(m.segments, 'Priya Raghunathan'));

    assert.equal(hits.length, 2, `expected one hit per page, got ${JSON.stringify(hits)}`);
    assert.deepEqual(hits.map(h => h.pageIndex).sort(), [0, 1]);

    const { bytes: out, report } = await redactPdf(bytes, hits);
    assert.equal(report.pages, 2);
    for (const p of [0, 1]) {
      const after = await textOf(out, p);
      assert.ok(!/Priya/.test(after), `page ${p + 1} still has the name: ${after}`);
      assert.ok(!/Raghunathan/.test(after), `page ${p + 1} still has the surname`);
    }
    assert.match(await textOf(out, 0), /Northgate Mutual/, 'unrelated text was destroyed');
    assert.match(await textOf(out, 1), /1,240/, 'unrelated text was destroyed');
  });

  test('matching ignores case by default', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    const hits = models.flatMap(m => findInSegments(m.segments, 'priya raghunathan'));
    assert.equal(hits.length, 2);
  });

  test('case-sensitive matching can be demanded', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'priya', { caseSensitive: true })).length, 0);
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Priya', { caseSensitive: true })).length, 2);
  });

  test('a phrase spanning two words is found, and so is a single word', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Raghunathan')).length, 2);
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Northgate Mutual')).length, 1);
  });

  test('a part-word match returns the whole word, because erasure cannot split one', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    const [hit] = models.flatMap(m => findInSegments(m.segments, 'Raghu'));
    assert.ok(hit, 'the partial match was not found');
    const [full] = models.flatMap(m => findInSegments(m.segments, 'Raghunathan'));
    assert.ok(hit.w >= full.w - 0.5,
      'a partial match returned a narrower box than the word it sits in');
  });

  test('wholeWord rejects a match inside a longer word', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Raghu', { wholeWord: true })).length, 0);
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Raghunathan', { wholeWord: true })).length, 2);
  });

  test('text that is not there yields nothing, and an empty query yields nothing', async () => {
    const models = await modelsOf(await repeatedNameDoc());
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'Nonexistent Person')).length, 0);
    assert.equal(models.flatMap(m => findInSegments(m.segments, '')).length, 0);
    assert.equal(models.flatMap(m => findInSegments(m.segments, '   ')).length, 0);
  });

  test('every hit lands on the text it claims to cover', async () => {
    const bytes = await repeatedNameDoc();
    const models = await modelsOf(bytes);
    for (const m of models) {
      for (const hit of findInSegments(m.segments, 'Priya Raghunathan')) {
        const seg = m.segments.find(s =>
          hit.x >= s.x - 1 && hit.x + hit.w <= s.x + s.w + 1 &&
          hit.y >= s.y - 1 && hit.y + hit.h <= s.y + s.h + 1);
        assert.ok(seg, `hit ${JSON.stringify(hit)} is not inside any segment`);
        assert.match(seg.text, /Priya Raghunathan/);
      }
    }
  });

  test('repeated hits on one page are reported separately', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const d = await PDFDocument.create();
    const font = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 200]);
    p.drawText('ACME here', { x: 20, y: 160, size: 12, font });
    p.drawText('and ACME there', { x: 20, y: 130, size: 12, font });
    const bytes = await d.save({ useObjectStreams: false });

    const models = await modelsOf(bytes);
    const hits = models.flatMap(m => findInSegments(m.segments, 'ACME'));
    assert.equal(hits.length, 2);
    assert.ok(!sameRegion(hits[0], hits[1]), 'two distinct hits compared equal');
  });

  test('works on a real fixture without inventing hits', async () => {
    const models = await modelsOf(fixtureBytes('standard14.pdf'));
    assert.ok(models.flatMap(m => findInSegments(m.segments, 'Helvetica heading')).length >= 1);
    assert.equal(models.flatMap(m => findInSegments(m.segments, 'zzzz-not-present')).length, 0);
  });

  test('a hit on a value drawn as its own operator reports NO widening', async () => {
    // The warning exists to say that more was removed than was chosen. It
    // only means that if an exact hit stays silent, so the operator box must
    // be pdf.js geometry rather than a padded version of it.
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const d = await PDFDocument.create();
    const font = await d.embedFont(StandardFonts.Helvetica);
    const page = d.addPage([400, 200]);
    page.drawText('Patient name:', { x: 20, y: 160, size: 12, font });
    page.drawText('Priya Raghunathan', { x: 140, y: 160, size: 12, font });
    const bytes = await d.save({ useObjectStreams: false });

    const doc = await openDoc(lib, bytes);
    const model = await loadPageModel(doc, 0, lib.OPS);
    const hits = findInSegments(model.segments, 'Priya Raghunathan');
    assert.equal(hits.length, 1, 'fixture precondition failed');

    const { bytes: out, report } = await redactPdf(bytes, hits,
      { pageRuns: async () => model.runs });
    assert.equal(report.boxesWidened, 0, 'an exact hit was reported as widening');
    const after = await textOf(out, 0);
    assert.ok(!/Priya/.test(after), 'the name survived');
    assert.match(after, /Patient name:/, 'the label was erased with the value');
  });

  test('a hit inside a one-operator line SHOWS the whole line it will erase', async () => {
    // "Patient name: Priya Raghunathan" is drawn as one operator, so the name
    // cannot be removed without the label. The hit therefore covers the whole
    // line: the box the user is shown is exactly what disappears, and no
    // widening is reported because nothing grew after they saw it.
    const bytes = await repeatedNameDoc();
    const models = await modelsOf(bytes);
    const hits = models.flatMap(m => findInSegments(m.segments, 'Priya Raghunathan'));
    const seg = models[0].segments.find(sg => /Patient name/.test(sg.text));
    const hit = hits.find(h => h.pageIndex === 0);
    assert.ok(Math.abs(hit.w - seg.w) < 1,
      `the hit box (${hit.w}) does not match the line it will erase (${seg.w})`);

    const { bytes: out, report } = await redactPdf(bytes, hits,
      { pageRuns: async (p) => models[p].runs });
    assert.equal(report.boxesWidened, 0,
      'nothing grew beyond what was shown, so nothing should be reported');
    assert.ok(!/Patient name/.test(await textOf(out, 0)),
      'the label shares an operator with the name and should have gone too');
  });

  test('a hand-drawn box smaller than the line it erases IS reported', async () => {
    // Dragging covers only part of a line; erasing takes all of it. The user
    // must be told, or the page quietly loses text they never selected.
    const bytes = await repeatedNameDoc();
    const models = await modelsOf(bytes);
    const seg = models[0].segments.find(sg => /Patient name/.test(sg.text));
    const partial = { pageIndex: 0, x: seg.x + seg.w * 0.6, y: seg.y, w: seg.w * 0.3, h: seg.h };

    const { bytes: out, report } = await redactPdf(bytes, [partial],
      { pageRuns: async (p) => models[p].runs });
    assert.ok(report.boxesWidened >= 1, 'a partial drag over a line did not warn');
    assert.ok(!/Raghunathan/.test(await textOf(out, 0)), 'the name survived a partial drag');
  });
});
