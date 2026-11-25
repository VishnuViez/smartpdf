import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { buildSegments, buildLines, groupIntoLines } =
  await import(path.join(ROOT, 'app/lib/pdf/model/grouping.js'));

async function segmentsOf(name, pageIndex = 0) {
  const doc = await openDoc(lib, fixtureBytes(name));
  const model = await loadPageModel(doc, pageIndex, lib.OPS);
  return { model, segments: buildSegments(model.runs, { pageIndex }) };
}

describe('grouping: selectable units', () => {
  test('REGRESSION: glyph-split runs become ONE selectable segment', () => {
    // Some producers emit one show-operation per character. Selecting those
    // directly means selecting letters. Build that case explicitly.
    const mk = (text, x, w) => ({
      id: `r${x}`, text, x, baseline: 100, y: 97, w, h: 14,
      fontSize: 14, fontKey: 'f1', colorHex: '#000000',
    });
    const glyphs = [];
    let x = 30;
    for (const ch of 'Fragmented') { glyphs.push(mk(ch, x, 8)); x += 8; }
    x += 30;                                  // clear separation
    for (const ch of 'Words') { glyphs.push(mk(ch, x, 8)); x += 8; }

    const segments = buildSegments(glyphs);
    const texts = segments.map(s => s.text.replace(/\s+/g, ''));
    assert.deepEqual(texts, ['Fragmented', 'Words'],
      `glyphs were not reassembled into words: ${JSON.stringify(texts)}`);
    assert.ok(segments.every(s => s.text.length > 1), 'a single-character segment survived');
    assert.ok(segments[0].runIds.length === 10, 'segment lost its source runs');
  });

  test('words are exposed inside each segment', async () => {
    const { segments } = await segmentsOf('fragmented-words.pdf');
    const withWords = segments.filter(s => s.words.length > 0);
    assert.ok(withWords.length > 0);
    for (const s of withWords) {
      for (const w of s.words) {
        assert.ok(w.text.length > 0);
        assert.ok(Number.isFinite(w.x) && Number.isFinite(w.w) && w.w > 0);
      }
    }
  });

  test('THE KEY CASE: two labelled blanks on one line stay two segments', async () => {
    const { segments } = await segmentsOf('form-underlines.pdf');
    const row1 = segments.filter(s => Math.abs(s.baseline - 320) < 3);
    const texts = row1.map(s => s.text.trim());
    assert.ok(texts.some(t => /Name/.test(t)), `no Name segment: ${JSON.stringify(texts)}`);
    assert.ok(texts.some(t => /Phone/.test(t)), `no Phone segment: ${JSON.stringify(texts)}`);
    assert.ok(!texts.some(t => /Name/.test(t) && /Phone/.test(t)),
      `Name and Phone were merged into one segment: ${JSON.stringify(texts)}`);
    assert.equal(row1.length, 2, `expected exactly 2 segments on the row, got ${row1.length}`);
  });

  test('three blanks on one line stay three segments', async () => {
    const { segments } = await segmentsOf('form-underlines.pdf');
    const row2 = segments.filter(s => Math.abs(s.baseline - 280) < 3);
    assert.equal(row2.length, 3, `expected City/State/Zip separate, got ${row2.map(s => s.text)}`);
  });

  test('line grouping reunites what segment splitting separated', async () => {
    const { segments } = await segmentsOf('form-underlines.pdf');
    const lines = buildLines(segments);
    const row1 = lines.find(l => Math.abs(l.baseline - 320) < 3);
    assert.ok(row1, 'row 1 line missing');
    assert.equal(row1.segments.length, 2);
    assert.match(row1.text, /Name/);
    assert.match(row1.text, /Phone/);
  });

  test('ordinary prose groups into readable segments', async () => {
    const { segments } = await segmentsOf('standard14.pdf');
    const texts = segments.map(s => s.text);
    assert.ok(texts.some(t => /Helvetica heading/.test(t)), `heading not grouped: ${JSON.stringify(texts.slice(0,5))}`);
    assert.ok(texts.some(t => /Times body text/.test(t)));
    assert.ok(texts.some(t => /Body line 0/.test(t)));
  });

  test('segments carry font, colour and finite geometry', async () => {
    const { segments } = await segmentsOf('colors.pdf');
    for (const s of segments) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'baseline']) {
        assert.ok(Number.isFinite(s[k]), `segment.${k} not finite`);
      }
      assert.ok(s.fontSize > 0);
      assert.match(s.colorHex, /^#[0-9a-f]{6}$/i);
      assert.ok(s.runIds.length > 0, 'segment lost its source run ids');
    }
    const red = segments.find(s => /Pure red/.test(s.text));
    assert.equal(red.colorHex.toLowerCase(), '#ff0000', 'colour lost during grouping');
  });

  test('handles empty and degenerate input', () => {
    assert.deepEqual(buildSegments([]), []);
    assert.deepEqual(groupIntoLines([]), []);
    assert.deepEqual(buildLines([]), []);
  });
});
