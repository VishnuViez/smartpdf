import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));

const modelOf = async name => loadPageModel(await openDoc(lib, fixtureBytes(name)), 0, lib.OPS);

describe('loader integration: segments, lines and fields on the model', () => {
  test('every fixture that loads exposes the new collections', async () => {
    for (const name of fixtureNames()) {
      let m;
      try { m = await modelOf(name); } catch { continue; }
      assert.ok(Array.isArray(m.segments), `${name}: segments missing`);
      assert.ok(Array.isArray(m.lines), `${name}: lines missing`);
      assert.ok(Array.isArray(m.fields), `${name}: fields missing`);
    }
  });

  test('segments are never single characters on ordinary prose', async () => {
    const m = await modelOf('standard14.pdf');
    assert.ok(m.segments.length > 0);
    const singles = m.segments.filter(s => s.text.trim().length === 1);
    assert.equal(singles.length, 0, `single-character segments: ${JSON.stringify(singles.map(s => s.text))}`);
  });

  test('side-by-side blanks: two segments AND two fields on one line', async () => {
    const m = await modelOf('form-underlines.pdf');
    const row = m.segments.filter(s => Math.abs(s.baseline - 320) < 3);
    assert.equal(row.length, 2, `segments on row: ${row.map(s => s.text)}`);
    const rowFields = m.fields.filter(f => Math.abs(f.rule?.y - 316) < 1);
    assert.equal(rowFields.length, 2, 'expected two independent input fields');
    assert.ok(rowFields[0].rect.x + rowFields[0].rect.w <= rowFields[1].rect.x ||
              rowFields[1].rect.x + rowFields[1].rect.w <= rowFields[0].rect.x,
              'fields overlap');
  });

  test('declared AcroForm fields reach the model', async () => {
    const m = await modelOf('acroform.pdf');
    assert.equal(m.fields.length, 3);
    assert.ok(m.fields.every(f => f.kind === 'acroform'));
  });

  test('comb reaches the model with its cells intact', async () => {
    const m = await modelOf('form-comb.pdf');
    const combs = m.fields.filter(f => f.kind === 'comb');
    assert.equal(combs.length, 2);
    assert.ok(combs.some(c => c.cells.length === 12));
  });

  test('documents with no form furniture expose no fields', async () => {
    assert.equal((await modelOf('standard14.pdf')).fields.length, 0);
    assert.equal((await modelOf('colors.pdf')).fields.length, 0);
  });

  test('field detection failure never takes the page down', async () => {
    // corrupt content still yields a usable model with empty collections
    const m = await modelOf('corrupt-content.pdf');
    assert.ok(Array.isArray(m.segments) && Array.isArray(m.fields));
    assert.ok(m.width > 0);
  });

  test('segments preserve the run ids they came from', async () => {
    const m = await modelOf('standard14.pdf');
    const allRunIds = new Set(m.runs.map(r => r.id));
    for (const s of m.segments) {
      assert.ok(s.runIds.length > 0);
      for (const id of s.runIds) assert.ok(allRunIds.has(id), `segment references unknown run ${id}`);
    }
  });
});
