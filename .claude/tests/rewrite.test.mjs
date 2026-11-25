import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, contentStreams, loadPdfjs, openDoc } from './_helpers.mjs';

const { indexShowOps, rewriteContent, showOpsInRect } = await import(path.join(ROOT, 'app/lib/pdf/rewrite/content-editor.js'));
const { encodeText, escapeLiteral, drawTextOps } = await import(path.join(ROOT, 'app/lib/pdf/rewrite/encode.js'));
const lib = await loadPdfjs();

describe('rewrite: encoding', () => {
  test('literal escaping covers the characters that break parsers', () => {
    const s = b => String.fromCharCode(...escapeLiteral(Buffer.from(b, 'latin1')));
    assert.equal(s('a(b)c'), 'a\\(b\\)c');
    assert.equal(s('back\\slash'), 'back\\\\slash');
    assert.equal(s('line\nbreak'), 'line\\nbreak');
    assert.equal(s('\x00'), '\\000');
    assert.equal(s('plain'), 'plain');
  });

  test('text encodes through the font\'s own charCode map', () => {
    const map = new Map([['H', 72], ['i', 105], ['!', 33]]);
    const r = encodeText('Hi!', map);
    assert.equal(r.ok, true);
    assert.deepEqual(r.missing, []);
    assert.equal(r.operand, '(Hi!)');
  });

  test('THE SUBSET CASE: characters the font cannot draw are reported, not silently dropped', () => {
    const map = new Map([['S', 83], ['U', 85], ['R', 82], ['G', 71], ['E', 69]]);
    const r = encodeText('SURGERY', map, { isSubset: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['Y'], 'the missing glyph must be named');
    assert.ok(!r.operand.includes('Y'));
  });

  test('REGRESSION: a NON-subset font can draw characters the page never used', () => {
    // the observed map is what this page drew, not what Helvetica can render
    const observed = new Map([['T', 84], ['i', 105], ['m', 109], ['e', 101], ['s', 115]]);
    const r = encodeText('REPLACED', observed, { isSubset: false });
    assert.equal(r.ok, true, `wrongly rejected: ${JSON.stringify(r.missing)}`);
    assert.equal(r.operand, '(REPLACED)');
  });

  test('identity encoding does NOT imply coverage for a subset', () => {
    // subset fonts commonly map M->77 too; the subset flag is what matters
    const observed = new Map([['M', 77], ['A', 65], ['C', 67]]);
    assert.equal(encodeText('MAC', observed, { isSubset: true }).ok, true);
    assert.equal(encodeText('MACY', observed, { isSubset: true }).ok, false);
  });

  test('composite fonts encode as two-byte hex strings', () => {
    const map = new Map([['あ', 0x3042], ['A', 0x0041]]);
    const r = encodeText('あA', map);
    assert.equal(r.wide, true);
    assert.equal(r.operand, '<30420041>');
  });

  test('draw operators are balanced and absolutely positioned', () => {
    const ops = drawTextOps({ operand: '(hi)', fontResource: '/F1', fontSize: 12,
                              x: 100, y: 200, color: { r: 1, g: 0, b: 0 } });
    assert.match(ops, /^q\n/);
    assert.match(ops, /\nQ$/);
    assert.ok(ops.includes('BT') && ops.includes('ET'));
    assert.ok(ops.includes('/F1 12 Tf'));
    assert.ok(ops.includes('1 0 0 1 100 200 Tm'), ops);
    assert.ok(ops.includes('1 0 0 rg'));
    assert.equal((ops.match(/BT/g) || []).length, (ops.match(/ET/g) || []).length);
  });
});

describe('rewrite: locating text operations', () => {
  test('every fixture indexes without throwing, with sane spans', async () => {
    for (const name of fixtureNames()) {
      let streams; try { streams = await contentStreams(fixtureBytes(name)); } catch { continue; }
      for (const buf of streams) {
        if (!buf.length) continue;
        for (const op of indexShowOps(buf)) {
          assert.ok(op.start >= 0 && op.end <= buf.length, `${name}: span outside buffer`);
          assert.ok(op.end > op.start, `${name}: empty span`);
          assert.ok(['Tj', 'TJ', "'", '"'].includes(op.op));
        }
      }
    }
  });

  test('the show-op count matches pdf.js exactly', async () => {
    for (const name of ['standard14.pdf', 'colors.pdf', 'form-underlines.pdf']) {
      const doc = await openDoc(lib, fixtureBytes(name));
      const ops = await (await doc.getPage(1)).getOperatorList();
      const inv = {}; for (const k in lib.OPS) inv[lib.OPS[k]] = k;
      const pdfjsShows = ops.fnArray.filter(f =>
        ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(inv[f])).length;
      const streams = await contentStreams(fixtureBytes(name));
      const mine = streams.reduce((n, b) => n + indexShowOps(b).length, 0);
      assert.equal(mine, pdfjsShows, `${name}: ${mine} vs pdf.js ${pdfjsShows}`);
    }
  });

  test('the font resource in effect is captured for each show op', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = indexShowOps(buf);
    assert.ok(ops.length > 0);
    for (const op of ops) {
      assert.match(op.fontResource || '', /^\/\S+/, `no font resource for op ${op.index}`);
      assert.ok(op.fontSize > 0, `no font size for op ${op.index}`);
    }
  });

  test('the captured span really contains the operand and its operator', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    for (const op of indexShowOps(buf)) {
      const span = buf.toString('latin1', op.start, op.end);
      assert.ok(span.endsWith(op.op), `span does not end with ${op.op}: ${JSON.stringify(span.slice(-12))}`);
      assert.ok(/[([<]/.test(span[0]), `span does not start at an operand: ${JSON.stringify(span.slice(0, 12))}`);
    }
  });
});

describe('rewrite: surgery', () => {
  test('an empty plan returns the bytes untouched', async () => {
    for (const name of fixtureNames()) {
      let streams; try { streams = await contentStreams(fixtureBytes(name)); } catch { continue; }
      for (const buf of streams) {
        assert.ok(rewriteContent(buf, {}).equals(buf), `${name}: no-op plan changed bytes`);
      }
    }
  });

  test('hiding preserves every byte outside the touched spans', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = indexShowOps(buf);
    const target = ops[0];
    const out = rewriteContent(buf, { hide: [0] });
    assert.ok(out.subarray(0, target.start).equals(buf.subarray(0, target.start)), 'bytes before the span changed');
    const tailOriginal = buf.subarray(target.end);
    assert.ok(out.subarray(out.length - tailOriginal.length).equals(tailOriginal), 'bytes after the span changed');
  });

  test('hidden text keeps its original operators, so advances are preserved', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const target = indexShowOps(buf)[0];
    const original = buf.toString('latin1', target.start, target.end);
    const out = rewriteContent(buf, { hide: [0] }).toString('latin1');
    assert.ok(out.includes(`3 Tr ${original} 0 Tr`), 'original show op was not preserved inside the hide wrapper');
  });

  test('the rewritten stream still parses, and hidden ops survive as invisible', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const before = indexShowOps(buf).length;
    const out = rewriteContent(buf, { hide: [0, 1] });
    assert.equal(indexShowOps(out).length, before, 'reparsing lost or duplicated show ops');
  });

  test('appended operators land at the end and parse', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = drawTextOps({ operand: '(NEW)', fontResource: '/F1', fontSize: 10, x: 20, y: 30, color: {} });
    const out = rewriteContent(buf, { append: [ops] });
    assert.ok(out.length > buf.length);
    assert.ok(out.subarray(0, buf.length).equals(buf), 'append disturbed the original bytes');
    assert.equal(indexShowOps(out).length, indexShowOps(buf).length + 1, 'appended draw was not parsed');
  });

  test('hide + append compose without corrupting each other', async () => {
    const buf = (await contentStreams(fixtureBytes('colors.pdf')))[0];
    const n = indexShowOps(buf).length;
    const out = rewriteContent(buf, {
      hide: [0, 2],
      append: [drawTextOps({ operand: '(X)', fontResource: '/F1', fontSize: 9, x: 1, y: 2, color: {} })],
    });
    assert.equal(indexShowOps(out).length, n + 1);
  });

  test('out-of-range indices are ignored rather than corrupting the stream', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const out = rewriteContent(buf, { hide: [9999, -1] });
    assert.ok(out.equals(buf));
  });
});

describe('rewrite: mapping model runs onto bytes', () => {
  test('show operations carry a position, not just an ordinal', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = indexShowOps(buf);
    assert.ok(ops.length > 0);
    for (const o of ops) {
      assert.ok(Number.isFinite(o.x) && Number.isFinite(o.baseline), `op ${o.index} has no position`);
      assert.ok(o.size > 0, `op ${o.index} has no size`);
    }
    assert.ok(new Set(ops.map(o => `${o.x.toFixed(1)},${o.baseline.toFixed(1)}`)).size > 1,
      'every op reported the same position — the text matrix is not being tracked');
  });

  test('positions agree with what pdf.js reports for the same page', async () => {
    const doc = await openDoc(lib, fixtureBytes('standard14.pdf'));
    const tc = await (await doc.getPage(1)).getTextContent();
    const ref = (tc.items || []).filter(i => i.str && i.str.trim() && i.transform?.length >= 6)
      .map(i => ({ x: i.transform[4], y: i.transform[5] }));
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = indexShowOps(buf);
    for (const r of ref) {
      const hit = ops.some(o => Math.hypot(o.x - r.x, o.baseline - r.y) < 0.5);
      assert.ok(hit, `no show op near pdf.js item at (${r.x.toFixed(1)}, ${r.y.toFixed(1)})`);
    }
  });

  test('a rect selects exactly the operations drawn inside it', async () => {
    const buf = (await contentStreams(fixtureBytes('standard14.pdf')))[0];
    const ops = indexShowOps(buf);
    const first = ops[0];
    const found = showOpsInRect(ops, { x: first.x - 1, y: first.baseline - 2, w: 2, h: 4 });
    assert.ok(found.some(o => o.index === first.index), 'the op at that position was not selected');
    assert.equal(showOpsInRect(ops, { x: -9999, y: -9999, w: 1, h: 1 }).length, 0,
      'an empty region selected operations');
  });

  test('REGRESSION: mapping must not assume show ops and text items are 1:1', async () => {
    // pdf.js merges adjacent show ops into single items; matching by ordinal
    // would edit the wrong text on any document where the counts differ.
    for (const name of fixtureNames()) {
      let streams; try { streams = await contentStreams(fixtureBytes(name)); } catch { continue; }
      const doc = await openDoc(lib, fixtureBytes(name)).catch(() => null);
      if (!doc) continue;
      const tc = await (await doc.getPage(1)).getTextContent().catch(() => null);
      if (!tc) continue;
      const items = (tc.items || []).filter(i => i.str && i.transform?.length >= 6).length;
      const shows = streams.reduce((n, b) => n + indexShowOps(b).length, 0);
      if (items !== shows) {
        // where they differ, geometric matching must still find the text
        const buf = streams[0];
        const ops = indexShowOps(buf);
        assert.ok(ops.every(o => Number.isFinite(o.x)),
          `${name}: counts differ (${items} vs ${shows}) and positions are unusable`);
      }
    }
  });
});
