import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from './_helpers.mjs';

const { createViewport } = await import(path.join(ROOT, 'app/lib/pdf/model/geometry.js'));
const { translateRect, resizeRect, screenDeltaToPdf, scaleFactor, applyDrag, isValidGeometry, HANDLES, isCorner,
        selectionFrame, handlesFor } =
  await import(path.join(ROOT, 'app/lib/pdf/model/transform.js'));

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const RECT = { x: 100, y: 200, w: 80, h: 20 };

describe('transform: moving', () => {
  test('translation moves position and never changes size', () => {
    const r = translateRect(RECT, 15, -7);
    assert.ok(near(r.x, 115) && near(r.y, 193));
    assert.ok(near(r.w, 80) && near(r.h, 20));
  });

  test('a screen delta becomes a PDF delta with the y axis flipped', () => {
    const vp = createViewport({ pageWidth: 612, pageHeight: 792, scale: 2 });
    const d = screenDeltaToPdf(vp, 20, 10);   // 20px right, 10px DOWN on screen
    assert.ok(near(d.dx, 10), `dx ${d.dx}`);
    assert.ok(near(d.dy, -5), `dy ${d.dy} — dragging down must decrease PDF y`);
  });

  test('dragging right moves the element right on EVERY page rotation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const vp = createViewport({ pageWidth: 612, pageHeight: 792, scale: 1.5, rotation });
      const { dx, dy } = screenDeltaToPdf(vp, 30, 0);
      const moved = translateRect(RECT, dx, dy);
      // convert both back to screen and confirm it really went right
      const before = vp.rectToScreen(RECT);
      const after = vp.rectToScreen(moved);
      assert.ok(near(after.x - before.x, 30, 1e-6),
        `rot=${rotation}: expected +30px on screen, got ${after.x - before.x}`);
      assert.ok(near(after.y - before.y, 0, 1e-6), `rot=${rotation}: drifted vertically`);
    }
  });

  test('dragging down moves the element down on every rotation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const vp = createViewport({ pageWidth: 400, pageHeight: 600, scale: 1, rotation });
      const { dx, dy } = screenDeltaToPdf(vp, 0, 25);
      const after = vp.rectToScreen(translateRect(RECT, dx, dy));
      const before = vp.rectToScreen(RECT);
      assert.ok(near(after.y - before.y, 25, 1e-6),
        `rot=${rotation}: expected +25px down, got ${after.y - before.y}`);
    }
  });

  test('scale does not distort the drag', () => {
    for (const scale of [0.5, 1, 3]) {
      const vp = createViewport({ pageWidth: 612, pageHeight: 792, scale });
      const { dx } = screenDeltaToPdf(vp, 60, 0);
      assert.ok(near(dx, 60 / scale), `scale ${scale}: dx ${dx}`);
    }
  });
});

describe('transform: resizing', () => {
  test('each handle moves only its own edges and anchors the opposite one', () => {
    // screen "e" grows width to the right; x (left edge) must not move
    const e = resizeRect(RECT, 'e', 20, 0);
    assert.ok(near(e.x, 100) && near(e.w, 100) && near(e.y, 200) && near(e.h, 20));

    // screen "w" drags the left edge; the RIGHT edge must stay put
    const w = resizeRect(RECT, 'w', -20, 0);
    assert.ok(near(w.x, 80) && near(w.w, 100), `w -> ${JSON.stringify(w)}`);
    assert.ok(near(w.x + w.w, RECT.x + RECT.w), 'right edge drifted');

    // screen "n" is the PDF top edge (y + h); y must not move
    const n = resizeRect(RECT, 'n', 0, 10);
    assert.ok(near(n.y, 200) && near(n.h, 30), `n -> ${JSON.stringify(n)}`);

    // screen "s" is the PDF bottom edge; the TOP edge must stay put
    const s = resizeRect(RECT, 's', 0, -10);
    assert.ok(near(s.y, 190) && near(s.h, 30), `s -> ${JSON.stringify(s)}`);
    assert.ok(near(s.y + s.h, RECT.y + RECT.h), 'top edge drifted');
  });

  test('every handle keeps its anchor fixed', () => {
    for (const h of HANDLES) {
      for (const [dx, dy] of [[12, 9], [-12, -9], [7, -4]]) {
        const r = resizeRect(RECT, h, dx, dy);
        assert.ok(isValidGeometry({ ...r, fontSize: 10 }), `${h}: invalid ${JSON.stringify(r)}`);
        if (!h.includes('w')) assert.ok(near(r.x, RECT.x), `${h}: left edge moved`);
        if (!h.includes('e')) assert.ok(near(r.x + r.w, RECT.x + RECT.w, 1e-6), `${h}: right edge moved`);
        if (!h.includes('s')) assert.ok(near(r.y, RECT.y), `${h}: bottom edge moved`);
        if (!h.includes('n')) assert.ok(near(r.y + r.h, RECT.y + RECT.h, 1e-6), `${h}: top edge moved`);
      }
    }
  });

  test('minimum size is enforced without the anchored edge sliding', () => {
    const r = resizeRect(RECT, 'w', 500, 0, { minW: 6 });
    assert.ok(near(r.w, 6), `width ${r.w}`);
    assert.ok(near(r.x + r.w, RECT.x + RECT.w, 1e-6), 'right edge must stay anchored while clamping');

    const s = resizeRect(RECT, 's', 0, 500, { minH: 5 });
    assert.ok(near(s.h, 5));
    assert.ok(near(s.y + s.h, RECT.y + RECT.h, 1e-6), 'top edge must stay anchored while clamping');
  });

  test('resizing never produces a negative or zero box', () => {
    for (const h of HANDLES) {
      for (const d of [-1000, -100, 1000]) {
        const r = resizeRect(RECT, h, d, d);
        assert.ok(r.w > 0 && r.h > 0, `${h} @ ${d}: ${JSON.stringify(r)}`);
      }
    }
  });

  test('proportional corner resize preserves aspect ratio', () => {
    const aspect = RECT.w / RECT.h;
    for (const h of HANDLES.filter(isCorner)) {
      const r = resizeRect(RECT, h, 40, 3, { proportional: true });
      assert.ok(near(r.w / r.h, aspect, 1e-6), `${h}: aspect ${r.w / r.h} vs ${aspect}`);
    }
  });

  test('unknown handle is a no-op rather than a crash', () => {
    assert.deepEqual(resizeRect(RECT, 'nonsense', 10, 10), { ...RECT });
  });
});

describe('transform: font size follows the box', () => {
  test('corner resize scales type size', () => {
    const after = { x: 100, y: 200, w: 160, h: 40 };     // 2x
    assert.ok(near(scaleFactor(RECT, after, 'se'), 2));
  });

  test('horizontal-only resize must NOT change type size', () => {
    const after = { x: 100, y: 200, w: 160, h: 20 };
    assert.equal(scaleFactor(RECT, after, 'e'), 1);
    assert.equal(scaleFactor(RECT, after, 'w'), 1);
  });

  test('vertical resize scales type size', () => {
    const after = { x: 100, y: 200, w: 80, h: 10 };
    assert.ok(near(scaleFactor(RECT, after, 's'), 0.5));
  });

  test('degenerate source box does not divide by zero', () => {
    assert.equal(scaleFactor({ w: 0, h: 0 }, { w: 10, h: 10 }, 'se'), 1);
  });
});

describe('transform: applyDrag end to end', () => {
  const vp = createViewport({ pageWidth: 612, pageHeight: 792, scale: 2 });
  const base = { ...RECT, fontSize: 12 };

  test('move keeps size and font, changes position', () => {
    const p = applyDrag({ base, mode: 'move', viewport: vp, dxScreen: 40, dyScreen: 20 });
    assert.ok(near(p.x, 120) && near(p.y, 190));
    assert.ok(near(p.w, 80) && near(p.h, 20));
    assert.equal(p.fontSize, 12);
  });

  test('corner resize scales the font with the box', () => {
    const p = applyDrag({ base, mode: 'resize', handle: 'se', viewport: vp,
                          dxScreen: 160, dyScreen: 40, proportional: true });
    assert.ok(p.fontSize > 12, `font did not grow: ${p.fontSize}`);
    assert.ok(isValidGeometry(p));
  });

  test('side resize leaves the font alone', () => {
    const p = applyDrag({ base, mode: 'resize', handle: 'e', viewport: vp, dxScreen: 100, dyScreen: 0 });
    assert.ok(near(p.fontSize, 12), `font changed on a horizontal drag: ${p.fontSize}`);
    assert.ok(p.w > base.w);
  });

  test('font size can never reach zero or go negative', () => {
    const p = applyDrag({ base, mode: 'resize', handle: 'se', viewport: vp,
                          dxScreen: -10000, dyScreen: -10000, proportional: true, minW: 2, minH: 2 });
    assert.ok(p.fontSize > 0, `fontSize ${p.fontSize}`);
    assert.ok(isValidGeometry(p));
  });

  test('every drag on every rotation yields valid geometry', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const v = createViewport({ pageWidth: 612, pageHeight: 792, scale: 1.25, rotation });
      for (const handle of HANDLES) {
        for (const [dx, dy] of [[30, 20], [-30, -20], [0, 0], [200, -200]]) {
          const p = applyDrag({ base, mode: 'resize', handle, viewport: v, dxScreen: dx, dyScreen: dy });
          assert.ok(isValidGeometry(p), `rot=${rotation} ${handle} (${dx},${dy}) -> ${JSON.stringify(p)}`);
        }
      }
    }
  });

  test('rejects garbage input instead of emitting NaN', () => {
    const p = applyDrag({ base, mode: 'move', viewport: vp, dxScreen: NaN, dyScreen: undefined });
    assert.ok(isValidGeometry(p), `NaN leaked: ${JSON.stringify(p)}`);
    assert.equal(isValidGeometry(null), false);
    assert.equal(isValidGeometry({ x: 0, y: 0, w: 0, h: 5 }), false);
  });
});

describe('transform: the selection frame must be usable', () => {
  test('REGRESSION: a tiny element still gets a grabbable frame', () => {
    // the real failure: a 57.9 x 11 px run had three 9px grips stacked 4.5px apart
    const f = selectionFrame({ x: 400, y: 110, w: 57.9, h: 11 });
    assert.ok(f.h >= 26, `frame only ${f.h}px tall — still ungrabbable`);
    assert.ok(f.w >= 57.9, 'frame narrower than the element');
  });

  test('the frame stays centred on the element it describes', () => {
    const box = { x: 400, y: 110, w: 57.9, h: 11 };
    const f = selectionFrame(box);
    assert.ok(Math.abs((f.x + f.w / 2) - (box.x + box.w / 2)) < 1e-9, 'x drifted');
    assert.ok(Math.abs((f.y + f.h / 2) - (box.y + box.h / 2)) < 1e-9, 'y drifted');
  });

  test('a large element is padded, not shrunk', () => {
    const f = selectionFrame({ x: 0, y: 0, w: 300, h: 200 });
    assert.ok(f.w > 300 && f.w < 320);
    assert.ok(f.h > 200 && f.h < 220);
  });

  test('corner handles on a small frame; edges only when there is room', () => {
    const small = selectionFrame({ x: 0, y: 0, w: 20, h: 8 });
    const hs = handlesFor(small);
    assert.deepEqual([...hs].sort(), ['ne', 'nw', 'se', 'sw']);

    const wide = selectionFrame({ x: 0, y: 0, w: 300, h: 8 });
    assert.ok(handlesFor(wide).includes('n'), 'wide frame should offer top/bottom grips');
    assert.ok(!handlesFor(wide).includes('e'), 'short frame must not offer side grips');

    const big = selectionFrame({ x: 0, y: 0, w: 300, h: 200 });
    assert.equal(handlesFor(big).length, 8);
  });

  test('handles never sit closer together than a pointer can resolve', () => {
    const f = selectionFrame({ x: 400, y: 110, w: 57.9, h: 11 });
    const hs = handlesFor(f);
    // corner grips are placed at frame corners; check the vertical separation
    assert.ok(f.h >= 24, `corners only ${f.h}px apart vertically`);
    assert.ok(hs.length >= 4);
  });

  test('degenerate boxes do not produce NaN frames', () => {
    for (const box of [null, undefined, {}, { x: NaN, y: 1, w: 2, h: 3 }, { x: 0, y: 0, w: 0, h: 0 }]) {
      const f = selectionFrame(box);
      assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && f.w > 0 && f.h > 0,
        `bad frame for ${JSON.stringify(box)}: ${JSON.stringify(f)}`);
    }
  });
});
