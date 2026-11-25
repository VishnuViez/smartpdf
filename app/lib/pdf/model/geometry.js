/**
 * The single authority for coordinate conversion.
 *
 * RULE: the document model stores PDF user-space units and NOTHING else.
 *   - PDF space   : origin bottom-left, y grows upward, 1 unit = 1/72 inch
 *   - Screen space: origin top-left,    y grows downward, units = CSS pixels
 *
 * Screen coordinates exist at exactly two boundaries: pointer input coming in,
 * and rendering going out. Every conversion happens here and nowhere else.
 *
 * This is what makes resize, zoom and page rotation structurally incapable of
 * corrupting geometry, rather than merely unlikely to.
 */

const ROTATIONS = [0, 90, 180, 270];

export function normalizeRotation(deg) {
  const r = ((Math.round((deg || 0) / 90) * 90) % 360 + 360) % 360;
  return ROTATIONS.includes(r) ? r : 0;
}

/**
 * @param {object} o
 * @param {number} o.pageWidth   page width  in PDF units
 * @param {number} o.pageHeight  page height in PDF units
 * @param {number} [o.scale]     CSS pixels per PDF unit
 * @param {number} [o.rotation]  0 | 90 | 180 | 270, clockwise, as PDF /Rotate
 */
export function createViewport({ pageWidth, pageHeight, scale = 1, rotation = 0 }) {
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    throw new Error(`createViewport: bad page size ${pageWidth}x${pageHeight}`);
  }
  if (!(scale > 0)) throw new Error(`createViewport: bad scale ${scale}`);

  const W = pageWidth, H = pageHeight, s = scale;
  const rot = normalizeRotation(rotation);
  const swap = rot === 90 || rot === 270;

  const width  = (swap ? H : W) * s;   // on-screen size in CSS px
  const height = (swap ? W : H) * s;

  function toScreen(x, y) {
    switch (rot) {
      case 90:  return { x: y * s,       y: x * s };
      case 180: return { x: (W - x) * s, y: y * s };
      case 270: return { x: (H - y) * s, y: (W - x) * s };
      default:  return { x: x * s,       y: (H - y) * s };
    }
  }

  function toPdf(sx, sy) {
    switch (rot) {
      case 90:  return { x: sy / s,       y: sx / s };
      case 180: return { x: W - sx / s,   y: sy / s };
      case 270: return { x: W - sy / s,   y: H - sx / s };
      default:  return { x: sx / s,       y: H - sy / s };
    }
  }

  /** PDF rect {x,y,w,h} (y = BOTTOM edge) -> screen rect {x,y,w,h} (y = TOP edge) */
  function rectToScreen({ x, y, w, h }) {
    const a = toScreen(x, y);            // bottom-left in PDF terms
    const b = toScreen(x + w, y + h);    // top-right
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }

  /** screen rect -> PDF rect */
  function rectToPdf({ x, y, w, h }) {
    const a = toPdf(x, y);
    const b = toPdf(x + w, y + h);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }

  // Font sizes are a scalar magnitude: they scale, they never translate or flip.
  const fontSizeToScreen = pt => pt * s;
  const fontSizeToPdf    = px => px / s;

  return {
    pageWidth: W, pageHeight: H, scale: s, rotation: rot,
    width, height,
    toScreen, toPdf, rectToScreen, rectToPdf,
    fontSizeToScreen, fontSizeToPdf,
    /** derive a new viewport at a different zoom, same page */
    withScale: ns => createViewport({ pageWidth: W, pageHeight: H, scale: ns, rotation: rot }),
    withRotation: nr => createViewport({ pageWidth: W, pageHeight: H, scale: s, rotation: nr }),
  };
}

/** Scale needed to fit the page into `availablePx` of width, honouring rotation. */
export function scaleToFitWidth({ pageWidth, pageHeight, rotation = 0 }, availablePx) {
  const swap = normalizeRotation(rotation) === 90 || normalizeRotation(rotation) === 270;
  return availablePx / (swap ? pageHeight : pageWidth);
}

/** Scale needed to fit the whole page inside a box. */
export function scaleToFitBox({ pageWidth, pageHeight, rotation = 0 }, boxW, boxH) {
  const swap = normalizeRotation(rotation) === 90 || normalizeRotation(rotation) === 270;
  const w = swap ? pageHeight : pageWidth;
  const h = swap ? pageWidth : pageHeight;
  return Math.min(boxW / w, boxH / h);
}
