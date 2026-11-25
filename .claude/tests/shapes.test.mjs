import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { harvestShapes } = await import(path.join(ROOT, 'app/lib/pdf/parse/shapes.js'));

async function shapesOf(name, pageIndex = 0) {
  const doc = await openDoc(lib, fixtureBytes(name));
  const page = await doc.getPage(pageIndex + 1);
  return harvestShapes(await page.getOperatorList(), lib.OPS);
}

describe('shape harvesting', () => {
  test('underline rules are found at their true page coordinates', async () => {
    const s = await shapesOf('form-underlines.pdf');
    const h = s.filter(x => x.type === 'hline');
    assert.equal(h.length, 6, `expected 6 rules, got ${h.length}`);

    // row 1: Name blank at x=80 w=180, Phone blank at x=345 w=150, both y=316
    const row1 = h.filter(l => Math.abs(l.y - 316) < 1).sort((a, b) => a.x - b.x);
    assert.equal(row1.length, 2, 'row 1 should contain exactly two separate rules');
    assert.ok(Math.abs(row1[0].x - 80) < 1, `first rule x=${row1[0].x}`);
    assert.ok(Math.abs(row1[0].w - 180) < 1, `first rule w=${row1[0].w}`);
    assert.ok(Math.abs(row1[1].x - 345) < 1, `second rule x=${row1[1].x}`);
    assert.ok(Math.abs(row1[1].w - 150) < 1, `second rule w=${row1[1].w}`);

    const row2 = h.filter(l => Math.abs(l.y - 276) < 1);
    assert.equal(row2.length, 3, 'row 2 should contain three separate rules');
  });

  test('stroked boxes are found with correct geometry', async () => {
    const s = await shapesOf('form-boxes.pdf');
    const rects = s.filter(x => x.type === 'rect');
    assert.equal(rects.length, 3, `expected 3 boxes, got ${rects.length}`);
    const byX = [...rects].sort((a, b) => a.x - b.x || b.y - a.y);
    const name = byX.find(r => Math.abs(r.x - 40) < 1 && Math.abs(r.y - 300) < 1);
    assert.ok(name, `no box at (40,300): ${JSON.stringify(rects)}`);
    assert.ok(Math.abs(name.w - 250) < 1 && Math.abs(name.h - 28) < 1);
    const tall = rects.find(r => r.h > 60);
    assert.ok(tall && Math.abs(tall.w - 520) < 1, 'tall notes box missing');
  });

  test('comb cells are found as equal adjacent rectangles', async () => {
    const s = await shapesOf('form-comb.pdf');
    const rects = s.filter(x => x.type === 'rect');
    assert.equal(rects.length, 20, `expected 12 + 8 cells, got ${rects.length}`);
    const wide = rects.filter(r => Math.abs(r.w - 26) < 0.5);
    assert.equal(wide.length, 12);
    const widths = new Set(wide.map(r => Math.round(r.w)));
    assert.equal(widths.size, 1, 'comb cells must all be the same width');
    const xs = wide.map(r => r.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(Math.abs((xs[i] - xs[i - 1]) - 26) < 0.5, 'cells must be evenly spaced');
    }
  });

  test('pages without vector art yield no shapes', async () => {
    const s = await shapesOf('standard14.pdf');
    assert.equal(s.filter(x => x.type === 'rect' || x.type === 'hline').length, 0);
  });

  test('every shape has finite geometry', async () => {
    for (const n of ['form-underlines.pdf', 'form-boxes.pdf', 'form-comb.pdf', 'no-text.pdf']) {
      for (const s of await shapesOf(n)) {
        for (const k of ['x', 'y', 'w', 'h']) {
          assert.ok(Number.isFinite(s[k]), `${n}: ${k} not finite`);
        }
      }
    }
  });

  test('malformed operator lists yield nothing rather than throwing', () => {
    assert.deepEqual(harvestShapes(null, lib.OPS), []);
    assert.deepEqual(harvestShapes({ fnArray: [], argsArray: [] }, lib.OPS), []);
    assert.deepEqual(
      harvestShapes({ fnArray: [lib.OPS.constructPath], argsArray: [[lib.OPS.stroke, null, null]] }, lib.OPS),
      []
    );
  });
});
