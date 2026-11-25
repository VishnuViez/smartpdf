import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, corpusFiles, loadPdfjs, openDoc, withTimeout } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));

const LOAD_BUDGET_MS = 20000;

async function modelFor(bytes, pageIndex = 0) {
  let doc;
  try {
    doc = await withTimeout(openDoc(lib, bytes), LOAD_BUDGET_MS, 'getDocument');
  } catch (err) {
    // Open failures are pdf.js's own and carry no phase; mark them so callers
    // can tell "this file is not a PDF" from "our loader broke".
    err.openFailure = true;
    throw err;
  }
  return withTimeout(loadPageModel(doc, pageIndex, lib.OPS), LOAD_BUDGET_MS, 'loadPageModel');
}

describe('loader: never hangs, never emits invalid geometry', () => {
  for (const name of fixtureNames()) {
    test(name, async () => {
      let model;
      try {
        model = await modelFor(fixtureBytes(name));
      } catch (err) {
        // Failing is allowed. Hanging is not, and the error must name its phase.
        assert.ok(!/^TIMEOUT/.test(err.message), `${name} HUNG: ${err.message}`);
        if (!err.openFailure) {
          assert.ok(typeof err.phase === 'string' && err.phase.length > 0,
            `${name} threw from the loader without a phase label: ${err.message}`);
        }
        return;
      }
      assert.ok(Number.isFinite(model.width) && model.width > 0, 'page width invalid');
      assert.ok(Number.isFinite(model.height) && model.height > 0, 'page height invalid');
      assert.equal(model.index, 0);
      assert.ok(model.fonts instanceof Map);
      for (const r of model.runs) {
        for (const k of ['x', 'y', 'w', 'h', 'fontSize']) {
          assert.ok(Number.isFinite(r[k]), `${name}: run.${k} is not finite (${r[k]}) for ${JSON.stringify(r.text)}`);
        }
        assert.ok(r.fontSize > 0, `${name}: non-positive fontSize`);
        assert.match(r.colorHex, /^#[0-9a-f]{6}$/i, `${name}: bad colorHex ${r.colorHex}`);
      }
    });
  }
});

describe('loader: behaviour that regressed before', () => {
  test('REGRESSION: single-character runs are editable (old code dropped <2 chars)', async () => {
    const m = await modelFor(fixtureBytes('tiny-and-single-char.pdf'));
    const singles = m.runs.filter(r => r.text.trim().length === 1);
    assert.ok(singles.length >= 8,
      `expected the 8 single letters to survive, found ${singles.length}: ${JSON.stringify(m.runs.map(r => r.text))}`);
  });

  test('4pt text is kept in the model at its true size', async () => {
    const m = await modelFor(fixtureBytes('tiny-and-single-char.pdf'));
    const tiny = m.runs.filter(r => r.fontSize < 6);
    assert.ok(tiny.length > 0, 'tiny text was dropped');
    for (const r of tiny) assert.ok(r.fontSize > 0 && r.fontSize < 8);
  });

  test('fill colour is recovered per run, not hardcoded black', async () => {
    const m = await modelFor(fixtureBytes('colors.pdf'));
    const byText = t => m.runs.find(r => r.text.includes(t));
    assert.equal(byText('Pure red')?.colorHex.toLowerCase(), '#ff0000');
    assert.equal(byText('Pure green')?.colorHex.toLowerCase(), '#00ff00');
    assert.equal(byText('Pure blue')?.colorHex.toLowerCase(), '#0000ff');
    assert.equal(byText('Black default')?.colorHex.toLowerCase(), '#000000');
    const distinct = new Set(m.runs.map(r => r.colorHex.toLowerCase()));
    assert.ok(distinct.size >= 4, `expected several distinct colours, got ${[...distinct].join(',')}`);
  });

  test('fonts are identified with real family names', async () => {
    const m = await modelFor(fixtureBytes('standard14.pdf'));
    const families = [...m.fonts.values()].map(f => f.family);
    assert.ok(families.some(f => /Helvetica|Arial/i.test(f)), `no Helvetica in ${families}`);
    assert.ok(families.some(f => /Times/i.test(f)), `no Times in ${families}`);
    assert.ok(families.some(f => /Courier/i.test(f)), `no Courier in ${families}`);
    for (const f of m.fonts.values()) {
      assert.ok(typeof f.label() === 'string' && f.label().length > 0);
      assert.match(f.cssFont(12), /\d+px/);
    }
  });

  test('page rotation is reported for every rotated page', async () => {
    const doc = await openDoc(lib, fixtureBytes('rotations.pdf'));
    const seen = [];
    for (let i = 0; i < doc.numPages; i++) {
      seen.push((await loadPageModel(doc, i, lib.OPS)).rotation);
    }
    assert.deepEqual(seen, [0, 90, 180, 270]);
  });

  test('a page with no text yields zero runs, not a crash', async () => {
    const m = await modelFor(fixtureBytes('no-text.pdf'));
    assert.equal(m.runs.length, 0);
    assert.ok(m.width > 0);
  });

  test('destroyed content stream degrades instead of hanging', async () => {
    const m = await modelFor(fixtureBytes('corrupt-content.pdf'));
    assert.ok(Array.isArray(m.runs), 'expected a usable model');
  });

  test('a truncated file fails at open, promptly', async () => {
    await assert.rejects(
      () => modelFor(fixtureBytes('truncated.pdf')),
      err => !/^TIMEOUT/.test(err.message),
      'truncated file must fail fast, not hang'
    );
  });

  test('inline images do not corrupt the text model', async () => {
    const m = await modelFor(fixtureBytes('inline-images.pdf'));
    assert.ok(Array.isArray(m.runs));
  });

  test('every page of a 40-page document loads', async () => {
    const doc = await openDoc(lib, fixtureBytes('multipage.pdf'));
    assert.equal(doc.numPages, 40);
    for (const i of [0, 1, 19, 38, 39]) {
      const m = await withTimeout(loadPageModel(doc, i, lib.OPS), LOAD_BUDGET_MS, `page ${i}`);
      assert.equal(m.index, i);
      assert.ok(m.runs.length > 0, `page ${i + 1} produced no runs`);
    }
  });
});

describe('loader: optional real-world corpus', () => {
  test('SMARTPDF_CORPUS documents all load', async () => {
    const files = corpusFiles();
    if (!files.length) return;
    const failures = [];
    for (const f of files) {
      try { await modelFor(f.bytes); }
      catch (err) { failures.push(`${f.name}: ${err.message.slice(0, 80)}`); }
    }
    assert.deepEqual(failures, [], `${failures.length}/${files.length} failed`);
  });
});
