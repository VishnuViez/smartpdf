import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, loadPdfjs, openDoc } from './_helpers.mjs';

const lib = await loadPdfjs();
const { loadPageModel } = await import(path.join(ROOT, 'app/lib/pdf/parse/document-loader.js'));
const { measureText, availableWidth, fitText, wrapText, FIT_LIMITS } =
  await import(path.join(ROOT, 'app/lib/pdf/model/fitting.js'));

/** A font whose every glyph is exactly half an em — makes arithmetic checkable. */
const uniform = (w = 0.5) => ({
  widths: new Map('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789'
    .split('').map(c => [c, w])),
});

describe('fitting: measurement uses the document\'s real metrics', () => {
  test('width is the sum of observed glyph advances', () => {
    const f = uniform(0.5);
    assert.equal(measureText('abcd', f, 10), 4 * 0.5 * 10);
    assert.equal(measureText('', f, 10), 0);
    assert.equal(measureText('abc', f, 0), 0);
  });

  test('real metrics are harvested from an actual document', async () => {
    const doc = await openDoc(lib, fixtureBytes('standard14.pdf'));
    const model = await loadPageModel(doc, 0, lib.OPS);
    const fr = [...model.fonts.values()].find(f => f.widths.size > 0);
    assert.ok(fr, 'no font carried any glyph advances');
    assert.ok(fr.widths.size >= 5, `only ${fr.widths.size} advances harvested`);
    for (const [ch, w] of fr.widths) {
      assert.ok(w > 0 && w < 3, `implausible advance for ${JSON.stringify(ch)}: ${w}`);
    }
    // a wide letter must measure wider than a narrow one
    if (fr.widths.get('m') && fr.widths.get('i')) {
      assert.ok(fr.widths.get('m') > fr.widths.get('i'), 'metrics are not real');
    }
  });

  test('measured width matches the segment the document actually drew', async () => {
    const doc = await openDoc(lib, fixtureBytes('standard14.pdf'));
    const model = await loadPageModel(doc, 0, lib.OPS);
    for (const seg of model.segments.slice(0, 4)) {
      const fr = model.fonts.get(seg.fontKey);
      if (!fr || fr.widths.size === 0) continue;
      const measured = measureText(seg.text, fr, seg.fontSize);
      const actual = seg.w;
      const err = Math.abs(measured - actual) / Math.max(1, actual);
      assert.ok(err < 0.06,
        `measured ${measured.toFixed(2)} vs actual ${actual.toFixed(2)} for ${JSON.stringify(seg.text)} (${(err*100).toFixed(1)}% off)`);
    }
  });

  test('tracking and condensing change the measurement predictably', () => {
    const f = uniform(0.5);
    const base = measureText('abcdefghij', f, 10);
    assert.ok(measureText('abcdefghij', f, 10, { hScale: 0.5 }) === base * 0.5);
    assert.ok(measureText('abcdefghij', f, 10, { charSpacingEm: -0.05 }) < base);
  });
});

describe('fitting: available space detection', () => {
  test('a run bounded by a neighbour gets the gap, not the page', async () => {
    const doc = await openDoc(lib, fixtureBytes('form-underlines.pdf'));
    const model = await loadPageModel(doc, 0, lib.OPS);
    const row = model.segments.filter(s => Math.abs(s.baseline - 320) < 3)
                              .sort((a, b) => a.x - b.x);
    assert.equal(row.length, 2, 'fixture changed');
    const [name, phone] = row;
    const room = availableWidth(name, model);
    // "Name:" is bounded by its own blank, which starts at x=80 — NOT by the
    // page edge at 612, and not by "Phone:" further along the line.
    const ownField = model.fields.find(f => Math.abs(f.rect.x - 80) < 2);
    assert.ok(ownField, 'fixture changed: no blank at x=80');
    assert.ok(room < ownField.rect.x - name.x + 1,
      `room ${room} runs past the blank that bounds it`);
    assert.ok(room > 20, `room ${room} is implausibly small`);
    assert.ok(room < phone.x - name.x, 'room reached the neighbouring label');
  });

  test('the last run on a line is bounded by the page edge', async () => {
    const doc = await openDoc(lib, fixtureBytes('standard14.pdf'));
    const model = await loadPageModel(doc, 0, lib.OPS);
    const seg = model.segments.find(s => /Helvetica heading/.test(s.text));
    const room = availableWidth(seg, model);
    assert.ok(room > 400 && room <= model.width - seg.x,
      `room ${room} is not bounded by the page`);
  });

  test('runs on other lines do not constrain this one', () => {
    const model = {
      width: 600,
      segments: [
        { id: 'a', x: 50, baseline: 500, w: 100, fontSize: 10 },
        { id: 'b', x: 80, baseline: 200, w: 100, fontSize: 10 },   // far below
      ],
      fields: [],
    };
    const room = availableWidth(model.segments[0], model);
    assert.ok(room > 500, `a run on a different line constrained this one: ${room}`);
  });
});

describe('fitting: the cascade', () => {
  const f = uniform(0.5);

  test('text that already fits is left completely alone', () => {
    const r = fitText({ text: 'abc', fontRecord: f, fontSize: 10, available: 500 });
    assert.equal(r.strategy, 'none');
    assert.equal(r.hScale, 1);
    assert.equal(r.charSpacing, 0);
    assert.equal(r.fontSize, 10);
    assert.equal(r.fits, true);
  });

  test('a slight overflow is absorbed by tracking alone', () => {
    // 10 chars x 0.5em x 10pt = 50 units natural; give it 49
    const r = fitText({ text: 'abcdefghij', fontRecord: f, fontSize: 10, available: 49 });
    assert.equal(r.strategy, 'tracked');
    assert.equal(r.fontSize, 10, 'size must not change for a small overflow');
    assert.equal(r.hScale, 1, 'must not condense before tracking is exhausted');
    assert.ok(r.charSpacing < 0 && r.charSpacing >= FIT_LIMITS.minCharSpacingEm * 10);
    assert.ok(r.fits);
    assert.ok(r.width <= 49 + 1e-6);
  });

  test('a larger overflow condenses, still without changing size', () => {
    // tracking alone yields 4 units (10 chars x 0.04em x 10pt), reaching 46;
    // 44 is past that, so condensing must take over
    const r = fitText({ text: 'abcdefghij', fontRecord: f, fontSize: 10, available: 44 });
    assert.equal(r.strategy, 'condensed');
    assert.equal(r.fontSize, 10, 'size changed too eagerly');
    assert.ok(r.hScale < 1 && r.hScale >= FIT_LIMITS.minHScale);
    assert.ok(r.fits);
  });

  test('only a large overflow reduces the size', () => {
    const r = fitText({ text: 'abcdefghij', fontRecord: f, fontSize: 10, available: 40 });
    assert.equal(r.strategy, 'shrunk');
    assert.ok(r.fontSize < 10 && r.fontSize >= 10 * FIT_LIMITS.minSizeRatio);
    assert.ok(r.fits);
  });

  test('text that cannot fit within acceptable typography is REPORTED, not mangled', () => {
    const r = fitText({ text: 'abcdefghijklmnopqrstuvwxyz', fontRecord: f, fontSize: 10, available: 20 });
    assert.equal(r.fits, false);
    assert.equal(r.strategy, 'overflow');
    assert.ok(r.overflow > 0, 'overflow amount not reported');
    // and it must not have shrunk past the floor to fake a fit
    assert.ok(r.fontSize >= 10 * FIT_LIMITS.minSizeRatio - 1e-9);
  });

  test('adjustments never exceed their typographic limits', () => {
    for (const avail of [1, 5, 10, 20, 30, 40, 45, 48, 50, 100]) {
      const r = fitText({ text: 'abcdefghij', fontRecord: f, fontSize: 10, available: avail });
      assert.ok(r.hScale >= FIT_LIMITS.minHScale - 1e-9, `hScale ${r.hScale}`);
      assert.ok(r.hScale <= 1 + 1e-9, `hScale ${r.hScale}`);
      assert.ok(r.charSpacing <= 1e-9, 'tracking must never be positive');
      assert.ok(r.charSpacing >= FIT_LIMITS.minCharSpacingEm * 10 - 1e-9);
      assert.ok(r.fontSize >= 10 * FIT_LIMITS.minSizeRatio - 1e-9, `size ${r.fontSize}`);
      assert.ok(r.fontSize <= 10 + 1e-9);
      assert.ok(Number.isFinite(r.width) && r.width >= 0);
    }
  });

  test('a fitted result genuinely fits the space it claims', () => {
    const f2 = uniform(0.62);
    for (const text of ['short', 'a somewhat longer line of text', 'x'.repeat(40)]) {
      for (const avail of [30, 60, 120, 400]) {
        const r = fitText({ text, fontRecord: f2, fontSize: 11, available: avail });
        if (r.fits) {
          const actual = measureText(text, f2, r.fontSize,
            { hScale: r.hScale, charSpacingEm: r.charSpacing / r.fontSize });
          assert.ok(actual <= avail + 1e-6,
            `claimed to fit but measures ${actual.toFixed(2)} in ${avail}`);
        }
      }
    }
  });

  test('degenerate input does not produce NaN', () => {
    for (const args of [
      { text: '', fontRecord: f, fontSize: 10, available: 10 },
      { text: 'abc', fontRecord: null, fontSize: 10, available: 10 },
      { text: 'abc', fontRecord: f, fontSize: 0, available: 10 },
      { text: 'abc', fontRecord: f, fontSize: 10, available: 0 },
    ]) {
      const r = fitText(args);
      for (const k of ['fontSize', 'hScale', 'charSpacing', 'width', 'overflow']) {
        assert.ok(Number.isFinite(r[k]), `${k} is ${r[k]}`);
      }
    }
  });
});

describe('fitting: wrapping for multi-line fields', () => {
  const f = uniform(0.5);
  test('text wraps at the given width', () => {
    const lines = wrapText('aaa bbb ccc ddd eee', f, 10, 40);
    assert.ok(lines.length > 1, 'did not wrap');
    for (const l of lines) {
      assert.ok(measureText(l, f, 10) <= 40 + 1e-6, `line too wide: ${JSON.stringify(l)}`);
    }
    assert.equal(lines.join(' ').replace(/\s+/g, ' ').trim(), 'aaa bbb ccc ddd eee');
  });
  test('empty and single-word input are handled', () => {
    assert.deepEqual(wrapText('', f, 10, 50), ['']);
    assert.deepEqual(wrapText('word', f, 10, 500), ['word']);
    assert.equal(wrapText('averylongunbreakableword', f, 10, 10).length, 1);
  });
});
