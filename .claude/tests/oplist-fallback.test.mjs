import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { buildRunsFromOperatorList } =
  await import(path.join(ROOT, 'app/lib/pdf/parse/text-from-oplist.js'));

/**
 * The fallback used when getTextContent fails. It must agree with
 * getTextContent on POSITION. It is allowed to differ on CHUNKING:
 * getTextContent merges adjacent show operations into single items and
 * synthesises whitespace runs that have no operator behind them — so the two
 * can never be compared by index.
 */
async function pair(name) {
  const doc = await openDoc(lib, fixtureBytes(name));
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const tc = await page.getTextContent();
  const ref = (tc.items || [])
    .filter(i => i.str && i.str.trim() && i.transform?.length >= 6)
    .map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5] }));
  const alt = buildRunsFromOperatorList(ops, lib.OPS, 0)
    .map(r => ({ text: r.text, x: r.x, y: r.baseline, size: r.size }));
  return { ref, alt };
}

const nearestDistance = (r, alt) =>
  alt.reduce((best, q) => Math.min(best, Math.hypot(r.x - q.x, r.y - q.y)), Infinity);

describe('operator-list fallback', () => {
  const textFixtures = fixtureNames().filter(
    n => !['no-text.pdf', 'truncated.pdf', 'corrupt-content.pdf', 'inline-images.pdf'].includes(n)
  );

  for (const name of textFixtures) {
    test(`${name}: positions agree with getTextContent`, async () => {
      const { ref, alt } = await pair(name);
      if (!ref.length) return;
      assert.ok(alt.length > 0, 'fallback produced no runs at all');

      const distances = ref.map(r => nearestDistance(r, alt)).sort((a, b) => a - b);
      const median = distances[Math.floor(distances.length / 2)];
      const p90 = distances[Math.floor(distances.length * 0.9)];

      assert.ok(median <= 0.5, `median positional error ${median.toFixed(3)} units is too high`);
      assert.ok(p90 <= 10, `p90 positional error ${p90.toFixed(3)} units is too high`);
    });
  }

  test('REGRESSION: text matrices are parsed, not silently zeroed', async () => {
    // setTextMatrix passes a Float32Array in args[0] while `transform` spreads
    // six numbers. Assuming one shape produced x=0, y=0, size=1 everywhere.
    const { alt } = await pair('standard14.pdf');
    assert.ok(alt.length > 0);
    assert.ok(alt.some(r => r.x > 1), 'every x is ~0 — matrix args were not parsed');
    assert.ok(alt.some(r => r.y > 1), 'every y is ~0 — matrix args were not parsed');
    assert.ok(alt.every(r => r.size > 1), 'every size is 1 — font size came from setFont, not the text matrix');
  });

  test('recovers the real font sizes of the fixture', async () => {
    const { alt } = await pair('standard14.pdf');
    const sizes = [...new Set(alt.map(r => Math.round(r.size)))].sort((a, b) => a - b);
    for (const expected of [24, 14, 11, 10]) {
      assert.ok(sizes.includes(expected), `expected a ${expected}pt run, saw ${sizes.join(',')}`);
    }
  });

  test('page text is recovered', async () => {
    const { ref, alt } = await pair('standard14.pdf');
    const norm = a => a.map(r => r.text).join('').replace(/\s+/g, '');
    assert.equal(norm(alt), norm(ref));
  });

  test('every emitted run has finite geometry', async () => {
    for (const name of textFixtures) {
      const { alt } = await pair(name);
      for (const r of alt) {
        assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.size),
          `${name}: non-finite run ${JSON.stringify(r)}`);
        assert.ok(r.size > 0, `${name}: non-positive size`);
      }
    }
  });

  test('malformed operator lists yield nothing rather than throwing', () => {
    assert.deepEqual(buildRunsFromOperatorList(null, lib.OPS, 0), []);
    assert.deepEqual(buildRunsFromOperatorList({ fnArray: [], argsArray: [] }, lib.OPS, 0), []);
    const junk = { fnArray: [lib.OPS.setTextMatrix, lib.OPS.showText], argsArray: [[null], [null]] };
    assert.deepEqual(buildRunsFromOperatorList(junk, lib.OPS, 0), []);
  });
});
