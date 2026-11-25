/**
 * Where edited text goes — the single source of truth for BOTH the editor
 * preview and the exported file.
 *
 * These were previously computed in two places with two different models: the
 * preview let CSS centre text in a line box that the click-target padding had
 * inflated, while the export used the PDF baseline. The results disagreed, so
 * what the user saw was not what they downloaded.
 *
 * Everything here is PDF user-space units.
 */

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * @param {object} element  the original run/segment (x, y, w, h, baseline, fontSize)
 * @param {object} [edit]   the user's overrides (text, x, y, w, h, fontSize, colorHex)
 * @returns {{x:number, baseline:number, fontSize:number, text:string, colorHex:string}}
 */
export function resolveTextPlacement(element, edit = {}) {
  const originalH = num(element?.h);
  const baseOffset = num(element?.baseline) - num(element?.y);

  // A resized box must carry its baseline offset with it, or the text drifts
  // inside the box as it grows.
  const scaleY = edit?.h !== undefined && originalH > 0 ? num(edit.h) / originalH : 1;

  const x = edit?.x !== undefined ? num(edit.x) : num(element?.x);
  const baseline = edit?.y !== undefined
    ? num(edit.y) + baseOffset * scaleY
    : num(element?.baseline);

  return {
    x,
    baseline,
    fontSize: edit?.fontSize !== undefined ? num(edit.fontSize, 1) : num(element?.fontSize, 1),
    text: edit?.text ?? element?.text ?? '',
    colorHex: edit?.colorHex ?? element?.colorHex ?? '#000000',
  };
}

/** The rect of the ORIGINAL glyphs, which is what gets hidden or covered. */
export function originalRect(element) {
  return {
    x: num(element?.x), y: num(element?.y),
    w: num(element?.w), h: num(element?.h),
  };
}
