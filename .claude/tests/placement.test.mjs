import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { resolveTextPlacement, originalRect } = await import(path.join(ROOT, 'app/lib/pdf/model/placement.js'));
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { savePdf } = await import(path.join(ROOT, 'app/lib/pdf/rewrite/save-pdf.js'));

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('placement: one source of truth for preview and export', () => {
  const element = { x: 100, y: 197.2, w: 80, h: 14, baseline: 200, fontSize: 14, text: 'orig', colorHex: '#112233' };

  test('an untouched element keeps its exact original placement', () => {
    const p = resolveTextPlacement(element, { text: 'new' });
    assert.ok(near(p.x, 100));
    assert.ok(near(p.baseline, 200));
    assert.ok(near(p.fontSize, 14));
    assert.equal(p.colorHex, '#112233');
  });

  test('moving shifts the baseline by exactly the move', () => {
    const p = resolveTextPlacement(element, { text: 'x', x: 150, y: element.y - 50 });
    assert.ok(near(p.x, 150));
    assert.ok(near(p.baseline, 150), `baseline ${p.baseline}`);
  });

  test('REGRESSION: resizing scales the baseline offset with the box', () => {
    const p = resolveTextPlacement(element, { text: 'x', y: element.y, h: element.h * 2, fontSize: 28 });
    // offset above the box bottom was 2.8; at 2x it must be 5.6
    assert.ok(near(p.baseline, element.y + 5.6), `baseline ${p.baseline}`);
    assert.ok(p.baseline >= element.y && p.baseline <= element.y + element.h * 2,
      'baseline escaped the resized box');
  });

  test('overrides win, absent overrides fall back to the element', () => {
    const p = resolveTextPlacement(element, { fontSize: 9 });
    assert.ok(near(p.fontSize, 9));
    assert.ok(near(p.x, 100), 'x should have fallen back to the element');
    assert.equal(p.text, 'orig');
  });

  test('never emits NaN, whatever it is handed', () => {
    for (const [el, ed] of [[null, null], [{}, {}], [element, { x: NaN, y: undefined, h: 0 }]]) {
      const p = resolveTextPlacement(el, ed);
      for (const k of ['x', 'baseline', 'fontSize']) {
        assert.ok(Number.isFinite(p[k]), `${k} is ${p[k]}`);
      }
      assert.ok(p.fontSize > 0);
    }
    const r = originalRect(null);
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(r[k]));
  });
});

describe('WYSIWYG: what the exporter writes IS the shared placement', () => {
  async function check(name, mutate) {
    const doc = await openDoc(lib, fixtureBytes(name));
    const model = await loadPageModel(doc, 0, lib.OPS);
    const el = model.segments.find(s => s.text.trim().length > 4);
    const edit = { text: 'WYSIWYG', ...mutate(el) };

    // what the preview would draw
    const expected = resolveTextPlacement(el, edit);

    const { bytes } = await savePdf(fixtureBytes(name), [{
      pageIndex: 0, model, edits: new Map([[el.id, edit]]), fieldValues: new Map(),
    }]);
    const out = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const tc = await (await out.getPage(1)).getTextContent();
    const item = (tc.items || []).find(i => /WYSIWYG/.test(i.str));
    assert.ok(item, `${name}: edited text missing from the file`);

    assert.ok(Math.abs(item.transform[4] - expected.x) < 0.01,
      `${name}: x — preview ${expected.x}, file ${item.transform[4]}`);
    assert.ok(Math.abs(item.transform[5] - expected.baseline) < 0.01,
      `${name}: baseline — preview ${expected.baseline}, file ${item.transform[5]}`);
    const writtenSize = Math.hypot(item.transform[1], item.transform[3]);
    assert.ok(Math.abs(writtenSize - expected.fontSize) < 0.01,
      `${name}: size — preview ${expected.fontSize}, file ${writtenSize}`);
  }

  test('unmoved edit', async () => {
    await check('standard14.pdf', () => ({}));
  });
  test('moved edit', async () => {
    await check('standard14.pdf', el => ({ x: el.x + 120, y: el.y - 200 }));
  });
  test('resized edit', async () => {
    await check('standard14.pdf', el => ({ y: el.y, h: el.h * 2.5, w: el.w * 2.5, fontSize: el.fontSize * 2.5 }));
  });
  test('moved AND resized edit', async () => {
    // keep the move ON the page: colors.pdf is only 300pt tall
    await check('colors.pdf', el => ({ x: el.x + 40, y: el.y - 60, h: el.h * 0.6, fontSize: el.fontSize * 0.6 }));
  });

  test('an edit moved off the page is reported, not silently lost', async () => {
    const doc = await openDoc(lib, fixtureBytes('colors.pdf'));
    const model = await loadPageModel(doc, 0, lib.OPS);
    const el = model.segments.find(s => s.text.trim().length > 4);
    const { warnings } = await savePdf(fixtureBytes('colors.pdf'), [{
      pageIndex: 0, model,
      edits: new Map([[el.id, { text: 'OFFPAGE', x: el.x, y: el.y + 500 }]]),
      fieldValues: new Map(),
    }]);
    assert.ok(warnings.some(w => w.kind === 'offpage'),
      `moving text outside the page produced no warning: ${JSON.stringify(warnings)}`);
  });
});
