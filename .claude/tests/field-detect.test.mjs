import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { harvestShapes } = await import(path.join(ROOT, 'app/lib/pdf/parse/shapes.js'));
const { detectFields, centeredBaseline, layoutComb, fitFontSize } =
  await import(path.join(ROOT, 'app/lib/pdf/parse/field-detect.js'));

async function fieldsOf(name) {
  const doc = await openDoc(lib, fixtureBytes(name));
  const page = await doc.getPage(1);
  const model = await loadPageModel(doc, 0, lib.OPS);
  const shapes = harvestShapes(await page.getOperatorList(), lib.OPS);
  const annotations = await page.getAnnotations();
  return detectFields({ annotations, shapes, runs: model.runs });
}

describe('field detection', () => {
  test('AcroForm widgets are used verbatim when present', async () => {
    const fields = await fieldsOf('acroform.pdf');
    assert.equal(fields.length, 3, `expected 3 declared fields, got ${fields.length}`);
    assert.ok(fields.every(f => f.kind === 'acroform'));
    const names = fields.map(f => f.name).sort();
    assert.deepEqual(names, ['applicant.name', 'applicant.notes', 'applicant.phone']);
    const notes = fields.find(f => f.name === 'applicant.notes');
    assert.equal(notes.multiline, true, 'multiline flag lost');
    const name = fields.find(f => f.name === 'applicant.name');
    assert.ok(Math.abs(name.rect.w - 241) < 2, `width ${name.rect.w}`);
  });

  test('THE KEY CASE: side-by-side blanks become separate fields', async () => {
    const fields = await fieldsOf('form-underlines.pdf');
    const rules = fields.filter(f => f.kind === 'underline');
    assert.equal(rules.length, 6, `expected 6 blanks, got ${rules.length}`);
    const row1 = rules.filter(f => Math.abs(f.rule.y - 316) < 1).sort((a, b) => a.rect.x - b.rect.x);
    assert.equal(row1.length, 2, 'Name and Phone blanks must be two distinct fields');
    assert.ok(Math.abs(row1[0].rect.x - 80) < 1 && Math.abs(row1[0].rect.w - 180) < 1);
    assert.ok(Math.abs(row1[1].rect.x - 345) < 1 && Math.abs(row1[1].rect.w - 150) < 1);
    assert.ok(row1[0].rect.x + row1[0].rect.w < row1[1].rect.x, 'fields must not overlap');
  });

  test('underline text sits ABOVE the rule, never on it', async () => {
    const fields = await fieldsOf('form-underlines.pdf');
    for (const f of fields.filter(x => x.kind === 'underline')) {
      assert.ok(f.baseline > f.rule.y, `baseline ${f.baseline} is not above rule ${f.rule.y}`);
      assert.ok(f.baseline - f.rule.y < f.fontSize * 0.5, 'baseline floats too far above the rule');
      assert.ok(f.fontSize > 0);
    }
  });

  test('boxes are detected and text is vertically centred inside them', async () => {
    const fields = await fieldsOf('form-boxes.pdf');
    const boxes = fields.filter(f => f.kind === 'box');
    assert.equal(boxes.length, 3, `expected 3 boxes, got ${boxes.length}`);

    const single = boxes.find(b => Math.abs(b.rect.h - 28) < 1);
    assert.ok(single, 'single-line box missing');
    // baseline must sit inside the box, below centre by roughly a quarter of the size
    assert.ok(single.baseline > single.rect.y, 'baseline below the box');
    assert.ok(single.baseline < single.rect.y + single.rect.h, 'baseline above the box');
    const centre = single.rect.y + single.rect.h / 2;
    assert.ok(Math.abs(single.baseline - (centre - 0.25 * single.fontSize)) < 0.01,
      `baseline ${single.baseline} is not optically centred (centre ${centre}, size ${single.fontSize})`);
  });

  test('padding is respected: the content box is strictly inside the rect', async () => {
    for (const name of ['form-boxes.pdf', 'form-comb.pdf', 'acroform.pdf']) {
      for (const f of await fieldsOf(name)) {
        assert.ok(f.content.x >= f.rect.x, `${name}: content left of rect`);
        assert.ok(f.content.y >= f.rect.y, `${name}: content below rect`);
        assert.ok(f.content.x + f.content.w <= f.rect.x + f.rect.w + 1e-6, `${name}: content right of rect`);
        assert.ok(f.content.y + f.content.h <= f.rect.y + f.rect.h + 1e-6, `${name}: content above rect`);
        assert.ok(f.content.w > 0 && f.content.h > 0);
      }
    }
  });

  test('a tall box is treated as multiline and starts at the top', async () => {
    const tall = (await fieldsOf('form-boxes.pdf')).find(f => f.rect.h > 60);
    assert.ok(tall, 'tall box missing');
    assert.equal(tall.multiline, true);
    assert.ok(tall.baseline > tall.rect.y + tall.rect.h / 2, 'multiline text must start at the top');
  });

  test('comb runs are detected as ONE field with per-cell geometry', async () => {
    const fields = await fieldsOf('form-comb.pdf');
    const combs = fields.filter(f => f.kind === 'comb');
    assert.equal(combs.length, 2, `expected 2 combs, got ${combs.length}`);
    const twelve = combs.find(c => c.cells.length === 12);
    assert.ok(twelve, `no 12-cell comb: ${combs.map(c => c.cells.length)}`);
    assert.equal(twelve.maxLen, 12);
    assert.ok(Math.abs(twelve.rect.w - 12 * 26) < 1, `comb width ${twelve.rect.w}`);
    // cells evenly spaced and non-overlapping
    for (let i = 1; i < twelve.cells.length; i++) {
      const d = twelve.cells[i].centerX - twelve.cells[i - 1].centerX;
      assert.ok(Math.abs(d - 26) < 0.5, `cell spacing ${d}`);
    }
    assert.ok(combs.some(c => c.cells.length === 8), 'second comb missing');
  });

  test('comb layout centres each character in its own cell', async () => {
    const comb = (await fieldsOf('form-comb.pdf')).find(f => f.kind === 'comb' && f.cells.length === 12);
    const measure = (ch, size) => size * 0.5;
    const placed = layoutComb(comb, 'AB1234', measure);
    assert.equal(placed.length, 6);
    placed.forEach((p, i) => {
      const cell = comb.cells[i];
      const glyphCentre = p.x + (comb.fontSize * 0.5) / 2;
      assert.ok(Math.abs(glyphCentre - cell.centerX) < 0.01,
        `char ${p.char} not centred: ${glyphCentre} vs ${cell.centerX}`);
      assert.equal(p.baseline, comb.baseline);
    });
  });

  test('comb layout never overflows the available cells', async () => {
    const comb = (await fieldsOf('form-comb.pdf')).find(f => f.cells.length === 8);
    assert.equal(layoutComb(comb, 'WAY TOO LONG FOR EIGHT').length, 8);
    assert.deepEqual(layoutComb(comb, ''), []);
  });

  test('comb cells are NOT also reported as individual boxes', async () => {
    const fields = await fieldsOf('form-comb.pdf');
    assert.equal(fields.filter(f => f.kind === 'box').length, 0,
      'comb cells leaked through as separate box fields');
  });

  test('pages with no form furniture yield no fields', async () => {
    assert.deepEqual(await fieldsOf('standard14.pdf'), []);
    assert.deepEqual(await fieldsOf('no-text.pdf'), []);
  });

  test('every field has finite geometry and a usable font size', async () => {
    for (const name of ['form-underlines.pdf', 'form-boxes.pdf', 'form-comb.pdf', 'acroform.pdf']) {
      for (const f of await fieldsOf(name)) {
        for (const k of ['x', 'y', 'w', 'h']) {
          assert.ok(Number.isFinite(f.rect[k]), `${name}: rect.${k} not finite`);
        }
        assert.ok(Number.isFinite(f.baseline), `${name}: baseline not finite`);
        assert.ok(f.fontSize > 0 && f.fontSize < 200, `${name}: implausible fontSize ${f.fontSize}`);
        assert.ok(typeof f.id === 'string' && f.id.length > 0);
      }
    }
  });

  test('geometry helpers behave', () => {
    // centring: a 10pt line in a 30-unit box at y=100
    assert.ok(Math.abs(centeredBaseline(100, 30, 10) - (115 - 2.5)) < 1e-9);
    assert.ok(fitFontSize(28, 2) > 20 && fitFontSize(28, 2) < 25);
    assert.ok(fitFontSize(4, 2) >= 4, 'must not return a non-positive size');
  });

  test('degenerate input is handled', () => {
    assert.deepEqual(detectFields(), []);
    assert.deepEqual(detectFields({ annotations: [], shapes: [], runs: [] }), []);
    assert.deepEqual(detectFields({ annotations: [{ subtype: 'Widget', fieldType: 'Tx', rect: [NaN, 0, 1, 1] }] }), []);
  });
});

describe('field detection: not everything with a line is a form', () => {
  test('REGRESSION: table rules with text on them are NOT input fields', async () => {
    const fields = await fieldsOf('table-rules.pdf');
    assert.ok(fields.length <= 1,
      `a reference table produced ${fields.length} phantom fields: ${JSON.stringify(fields.map(f => f.rect))}`);
  });

  test('real blanks still survive the table-rule filter', async () => {
    const fields = await fieldsOf('form-underlines.pdf');
    assert.equal(fields.filter(f => f.kind === 'underline').length, 6,
      'the filter ate genuine blanks');
  });
});
