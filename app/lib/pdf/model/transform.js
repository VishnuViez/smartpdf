/**
 * Moving and resizing elements.
 *
 * All of this is pure geometry on PDF user-space rects, deliberately kept out of
 * the pointer handlers: dragging is easy to get subtly wrong (drifting anchors,
 * inverted edges, rotation) and none of that is testable once it lives inside a
 * mousemove listener.
 *
 * A screen delta is converted through the Viewport, so a drag behaves correctly
 * on a rotated page — moving the pointer right must move the element right on
 * screen, whatever the page rotation happens to be.
 */

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Which edges each handle drives, in SCREEN terms (y grows downward). */
const EDGES = {
  nw: { top: 1, left: 1 }, n: { top: 1 }, ne: { top: 1, right: 1 },
  e: { right: 1 }, se: { bottom: 1, right: 1 }, s: { bottom: 1 },
  sw: { bottom: 1, left: 1 }, w: { left: 1 },
};

export const isCorner = h => h === 'nw' || h === 'ne' || h === 'se' || h === 'sw';

/**
 * Convert a screen-pixel delta into a PDF-space delta.
 * The viewport transform is affine, so the delta is independent of position.
 */
export function screenDeltaToPdf(viewport, dxScreen, dyScreen) {
  const origin = viewport.toPdf(0, 0);
  const moved = viewport.toPdf(num(dxScreen), num(dyScreen));
  return { dx: moved.x - origin.x, dy: moved.y - origin.y };
}

/** Move a rect. Size is never touched. */
export function translateRect(rect, dx, dy) {
  return {
    x: num(rect.x) + num(dx),
    y: num(rect.y) + num(dy),
    w: num(rect.w),
    h: num(rect.h),
  };
}

/**
 * Resize a rect by dragging `handle`.
 *
 * @param {object} rect         PDF-space rect (y = bottom edge)
 * @param {string} handle       one of HANDLES, named in SCREEN orientation
 * @param {number} dx,dy        PDF-space delta of the pointer
 * @param {object} [opts]
 * @param {number} [opts.minW]  minimum width  (PDF units)
 * @param {number} [opts.minH]  minimum height (PDF units)
 * @param {boolean} [opts.proportional] lock aspect ratio (corner handles)
 */
export function resizeRect(rect, handle, dx, dy, opts = {}) {
  const { minW = 4, minH = 4, proportional = false } = opts;
  const e = EDGES[handle];
  if (!e) return { x: num(rect.x), y: num(rect.y), w: num(rect.w), h: num(rect.h) };

  let x = num(rect.x), y = num(rect.y), w = num(rect.w), h = num(rect.h);
  let ddx = num(dx), ddy = num(dy);

  if (proportional && isCorner(handle) && w > 0 && h > 0) {
    // Drive both axes from whichever the user moved more, so the aspect holds.
    const sx = (e.left ? -ddx : ddx) / w;
    const sy = (e.bottom ? -ddy : ddy) / h;   // screen "bottom" is PDF -y
    const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    ddx = (e.left ? -1 : 1) * s * w;
    ddy = (e.bottom ? -1 : 1) * s * h;
  }

  // Screen top edge == PDF y + h ; screen bottom edge == PDF y.
  if (e.left)   { x += ddx; w -= ddx; }
  if (e.right)  { w += ddx; }
  if (e.top)    { h += ddy; }
  if (e.bottom) { y += ddy; h -= ddy; }

  // Clamp without letting the anchored edge drift.
  if (w < minW) {
    if (e.left) x -= (minW - w);
    w = minW;
  }
  if (h < minH) {
    if (e.bottom) y -= (minH - h);
    h = minH;
  }
  return { x, y, w, h };
}

/** Scale factor a resize implies, for carrying font size along with the box. */
export function scaleFactor(before, after, handle) {
  const bw = num(before.w), bh = num(before.h);
  if (bw <= 0 || bh <= 0) return 1;
  if (isCorner(handle)) {
    // geometric mean keeps growth sane when the drag isn't proportional
    return Math.sqrt((num(after.w) / bw) * (num(after.h) / bh));
  }
  if (handle === 'n' || handle === 's') return num(after.h) / bh;
  return 1;                       // horizontal-only resize must not change type size
}

/**
 * Apply a drag to an element, returning the geometry patch to store.
 * `element` supplies the ORIGINAL geometry; `base` is the geometry at drag start.
 */
export function applyDrag({ base, mode, handle, viewport, dxScreen, dyScreen, proportional, minW, minH }) {
  const { dx, dy } = screenDeltaToPdf(viewport, dxScreen, dyScreen);
  if (mode === 'move') {
    const rect = translateRect(base, dx, dy);
    return { ...rect, fontSize: num(base.fontSize, undefined) };
  }
  const rect = resizeRect(base, handle, dx, dy, { minW, minH, proportional });
  const patch = { ...rect };
  if (Number.isFinite(base.fontSize)) {
    const f = scaleFactor(base, rect, handle);
    patch.fontSize = Math.max(1, base.fontSize * f);
  }
  return patch;
}

/** Guard against a drag producing anything the renderer can't use. */
export function isValidGeometry(g) {
  return !!g &&
    Number.isFinite(g.x) && Number.isFinite(g.y) &&
    Number.isFinite(g.w) && Number.isFinite(g.h) &&
    g.w > 0 && g.h > 0 &&
    (g.fontSize === undefined || (Number.isFinite(g.fontSize) && g.fontSize > 0));
}

/**
 * Geometry for the selection frame drawn around an element.
 *
 * A text run can be 11 pixels tall. Handles cannot live inside something that
 * small — they would overlap each other and the element itself, which is why
 * the first attempt at this was unusable. So the FRAME is inflated to a size a
 * pointer can actually work with, and the handles sit OUTSIDE its edges.
 *
 * Inflation is purely visual: drag deltas are deltas, so resizing still applies
 * to the element's true rect and the maths is unaffected.
 *
 * @param {{x,y,w,h}} box     element box in SCREEN pixels
 * @param {object} [opts]
 * @param {number} [opts.minW] smallest usable frame width
 * @param {number} [opts.minH] smallest usable frame height
 * @param {number} [opts.pad]  breathing room around the element
 */
export function selectionFrame(box, { minW = 34, minH = 26, pad = 3 } = {}) {
  const x = num(box?.x), y = num(box?.y);
  const w = Math.max(0, num(box?.w)), h = Math.max(0, num(box?.h));

  const fw = Math.max(w + pad * 2, minW);
  const fh = Math.max(h + pad * 2, minH);
  return {
    x: x + w / 2 - fw / 2,      // keep it centred on the element
    y: y + h / 2 - fh / 2,
    w: fw,
    h: fh,
    inflatedX: fw - w,
    inflatedY: fh - h,
  };
}

/**
 * Which handles to offer at a given frame size. Eight grips need room; below
 * that, edge handles collide with corners and only the corners are usable.
 */
export function handlesFor(frame, { minForEdges = 44 } = {}) {
  const w = num(frame?.w), h = num(frame?.h);
  const corners = ['nw', 'ne', 'se', 'sw'];
  const out = [...corners];
  if (w >= minForEdges) out.push('n', 's');
  if (h >= minForEdges) out.push('e', 'w');
  return out;
}
