import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from './_helpers.mjs';

const { createViewport, scaleToFitWidth, scaleToFitBox, normalizeRotation } =
  await import(path.join(ROOT, 'app/lib/pdf/model/geometry.js'));

const W = 612, H = 792;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('geometry: the coordinate authority', () => {
  describe('round-trips for every rotation and scale', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const scale of [0.25, 1, 1.5, 4]) {
        test(`rot=${rotation} scale=${scale}`, () => {
          const vp = createViewport({ pageWidth: W, pageHeight: H, scale, rotation });
          for (const [x, y] of [[0,0],[W,0],[0,H],[W,H],[123.456,71.5],[W/2,H/2]]) {
            const s = vp.toScreen(x, y);
            const back = vp.toPdf(s.x, s.y);
            assert.ok(near(back.x, x), `x drifted: ${x} -> ${back.x}`);
            assert.ok(near(back.y, y), `y drifted: ${y} -> ${back.y}`);
          }
        });
      }
    }
  });

  test('screen dimensions swap on 90/270', () => {
    assert.ok(near(createViewport({ pageWidth: W, pageHeight: H, scale: 2 }).width, W * 2));
    const r90 = createViewport({ pageWidth: W, pageHeight: H, scale: 2, rotation: 90 });
    assert.ok(near(r90.width, H * 2) && near(r90.height, W * 2));
  });

  test('y axis is flipped: PDF (0,0) is screen bottom-left', () => {
    const vp = createViewport({ pageWidth: W, pageHeight: H, scale: 1 });
    const bl = vp.toScreen(0, 0), tl = vp.toScreen(0, H);
    assert.ok(near(bl.x, 0) && near(bl.y, H));
    assert.ok(near(tl.x, 0) && near(tl.y, 0));
  });

  test('rect: PDF y is bottom edge, screen y is top edge', () => {
    const vp = createViewport({ pageWidth: W, pageHeight: H, scale: 1 });
    const r = vp.rectToScreen({ x: 100, y: 700, w: 200, h: 12 });
    assert.ok(near(r.x, 100) && near(r.w, 200) && near(r.h, 12));
    assert.ok(near(r.y, H - 712), `top edge wrong: ${r.y}`);
    const back = vp.rectToPdf(r);
    assert.ok(near(back.x, 100) && near(back.y, 700));
  });

  describe('REGRESSION: font size must never collapse (the 3px bug)', () => {
    const dims = { pageWidth: 842, pageHeight: 595 };
    const TITLE_PT = 12;

    test('narrow container renders small but the MODEL value is unchanged', () => {
      const narrow = createViewport({ ...dims, scale: scaleToFitWidth(dims, 228) });
      // reproduces the original defect's on-screen size
      assert.ok(Math.abs(narrow.fontSizeToScreen(TITLE_PT) - 3.25) < 0.01);
      // ...but converting back must still yield 12pt, which is what broke before
      assert.ok(near(narrow.fontSizeToPdf(narrow.fontSizeToScreen(TITLE_PT)), TITLE_PT));
    });

    test('model value is identical at every container width', () => {
      const sizes = [228, 700, 1100, 2400].map(px => {
        const vp = createViewport({ ...dims, scale: scaleToFitWidth(dims, px) });
        return vp.fontSizeToPdf(vp.fontSizeToScreen(TITLE_PT));
      });
      for (const s of sizes) assert.ok(near(s, TITLE_PT), `container width changed the model: ${s}`);
    });

    test('zoom enlarges text rather than destroying it', () => {
      const vp = createViewport({ ...dims, scale: scaleToFitWidth(dims, 1100) });
      assert.ok(vp.withScale(2).fontSizeToScreen(TITLE_PT) > 20);
      assert.ok(vp.withScale(4).fontSizeToScreen(TITLE_PT) > vp.withScale(2).fontSizeToScreen(TITLE_PT));
    });
  });

  test('rejects degenerate input instead of producing NaN', () => {
    assert.throws(() => createViewport({ pageWidth: 0, pageHeight: 100 }));
    assert.throws(() => createViewport({ pageWidth: 10, pageHeight: 10, scale: 0 }));
    assert.throws(() => createViewport({ pageWidth: NaN, pageHeight: 10 }));
  });

  test('rotation normalisation', () => {
    assert.equal(normalizeRotation(450), 90);
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(undefined), 0);
  });

  test('fit helpers account for rotation', () => {
    const d = { pageWidth: 800, pageHeight: 400 };
    assert.ok(near(scaleToFitWidth(d, 800), 1));
    assert.ok(near(scaleToFitWidth({ ...d, rotation: 90 }, 800), 2));
    assert.ok(near(scaleToFitBox(d, 800, 200), 0.5));
  });
});
