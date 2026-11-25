/**
 * Space-aware text fitting.
 *
 * Editing text changes its width. Replace "Debugging" with "Troubleshooting
 * Guide" and the new text runs straight through whatever sits beside it. Most
 * PDF editors simply let it collide and leave the user to notice; the result is
 * a document that is subtly wrong in a way nobody catches until it is printed.
 *
 * Three things are needed to do better, and a PDF gives us all of them:
 *
 *   1. REAL METRICS. Every glyph drawn on the page arrives with its advance
 *      width. Harvesting those gives exact measurements for the document's own
 *      font, without parsing the font program.
 *   2. THE ACTUAL AVAILABLE SPACE. Neighbouring text, form furniture and the
 *      page edge bound how far a run may grow.
 *   3. TYPOGRAPHIC HEADROOM. PDF can tighten letter spacing (Tc), condense
 *      horizontally (Tz) and change size — all natively, all reversible.
 *
 * So instead of colliding, text is fitted: tighten, then condense, then shrink,
 * each within limits a typographer would accept, and if it still will not fit,
 * say so plainly rather than producing a broken page.
 *
 * Order matters. Tracking is the least visible adjustment, condensing next,
 * changing size most visible — so they are applied in that order.
 */

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Limits beyond which the text stops looking like the document's typography. */
export const FIT_LIMITS = {
  minCharSpacingEm: -0.04,   // tracking floor, fraction of em
  minHScale: 0.88,           // horizontal condense floor
  minSizeRatio: 0.82,        // size reduction floor
};

/** Fallback advance when a glyph was never observed: the font's own average. */
function averageWidth(fontRecord) {
  const w = fontRecord?.widths;
  if (!w || w.size === 0) return 0.5;
  let sum = 0;
  for (const v of w.values()) sum += v;
  return sum / w.size;
}

/**
 * Width of `text` in PDF units, using the document's real glyph advances.
 *
 * @param {string} text
 * @param {object} fontRecord
 * @param {number} fontSize
 * @param {object} [opts] { hScale = 1, charSpacingEm = 0 }
 */
export function measureText(text, fontRecord, fontSize, opts = {}) {
  const chars = [...String(text ?? '')];
  if (!chars.length) return 0;
  const size = num(fontSize, 0);
  if (size <= 0) return 0;

  const hScale = num(opts.hScale, 1);
  const trackEm = num(opts.charSpacingEm, 0);
  const widths = fontRecord?.widths;
  const avg = averageWidth(fontRecord);

  let em = 0;
  for (const ch of chars) {
    const w = widths?.get(ch);
    em += Number.isFinite(w) ? w : (ch === ' ' ? avg * 0.5 : avg);
  }
  // tracking applies between and after glyphs, as Tc does in PDF
  em += trackEm * chars.length;
  return em * size * hScale;
}

/**
 * How much horizontal room a run actually has before it hits something.
 *
 * Looks along the run's own baseline band for the nearest obstruction to the
 * right: another text segment, a detected input field, or the page edge.
 *
 * @returns {number} available width in PDF units, from the run's left edge
 */
export function availableWidth(element, model, { margin = 2, pageMargin = 6 } = {}) {
  const left = num(element?.x);
  const baseline = num(element?.baseline);
  const size = num(element?.fontSize, 10);
  const band = Math.max(2, size * 0.55);
  const pageRight = num(model?.width, 612) - pageMargin;

  let nearest = pageRight;

  const consider = (x, yLo, yHi) => {
    if (baseline < yLo || baseline > yHi) return;      // not on this line
    if (x <= left + 0.5) return;                       // to our left, or us
    if (x < nearest) nearest = x;
  };

  for (const s of model?.segments || []) {
    if (s.id === element.id) continue;
    consider(num(s.x), num(s.baseline) - band, num(s.baseline) + band);
  }
  for (const f of model?.fields || []) {
    consider(num(f.rect?.x), num(f.rect?.y), num(f.rect?.y) + num(f.rect?.h));
  }

  return Math.max(0, nearest - left - margin);
}

/**
 * Fit `text` into `available` units, returning the typographic adjustments.
 *
 * @returns {{
 *   fits: boolean, fontSize: number, hScale: number, charSpacing: number,
 *   width: number, available: number, strategy: string, overflow: number
 * }}
 *   `charSpacing` is in PDF text-space units, ready for the Tc operator.
 *   `hScale` is a fraction; multiply by 100 for the Tz operator.
 */
export function fitText({ text, fontRecord, fontSize, available, limits = FIT_LIMITS }) {
  const size = num(fontSize, 0);
  const room = num(available, 0);
  const natural = measureText(text, fontRecord, size);

  const result = (strategy, fs, hs, trackEm) => {
    const width = measureText(text, fontRecord, fs, { hScale: hs, charSpacingEm: trackEm });
    return {
      fits: width <= room + 1e-6,
      fontSize: fs,
      hScale: hs,
      charSpacing: trackEm * fs,      // Tc is in text-space units, not em
      width,
      available: room,
      strategy,
      overflow: Math.max(0, width - room),
    };
  };

  if (!text || size <= 0) return result('none', size, 1, 0);
  if (room <= 0) return result('unbounded', size, 1, 0);
  if (natural <= room + 1e-6) return result('none', size, 1, 0);

  // 1. tighten tracking — least visible
  const track = result('tracked', size, 1, limits.minCharSpacingEm);
  if (track.fits) {
    // use only as much tightening as needed
    const needed = solveTracking(text, fontRecord, size, room, limits);
    return result('tracked', size, 1, needed);
  }

  // 2. condense horizontally
  const condensed = result('condensed', size, limits.minHScale, limits.minCharSpacingEm);
  if (condensed.fits) {
    const hs = solveHScale(text, fontRecord, size, room, limits);
    return result('condensed', size, hs, limits.minCharSpacingEm);
  }

  // 3. reduce size
  const smaller = size * limits.minSizeRatio;
  const shrunk = result('shrunk', smaller, limits.minHScale, limits.minCharSpacingEm);
  if (shrunk.fits) {
    const fs = solveSize(text, fontRecord, room, limits, size);
    return result('shrunk', fs, limits.minHScale, limits.minCharSpacingEm);
  }

  // 4. cannot be fitted within acceptable typography
  return { ...shrunk, fits: false, strategy: 'overflow' };
}

/** Smallest tracking adjustment that fits. */
function solveTracking(text, fontRecord, size, room, limits) {
  const n = [...String(text)].length || 1;
  const natural = measureText(text, fontRecord, size);
  const needEm = (room - natural) / (size * n);
  return Math.max(limits.minCharSpacingEm, Math.min(0, needEm));
}

/** Largest horizontal scale that fits, given tracking already at its floor. */
function solveHScale(text, fontRecord, size, room, limits) {
  const w = measureText(text, fontRecord, size, { charSpacingEm: limits.minCharSpacingEm });
  if (w <= 0) return 1;
  return Math.max(limits.minHScale, Math.min(1, room / w));
}

/** Largest size that fits, with tracking and condensing already at their floors. */
function solveSize(text, fontRecord, room, limits, originalSize) {
  const unit = measureText(text, fontRecord, 1, {
    hScale: limits.minHScale, charSpacingEm: limits.minCharSpacingEm,
  });
  if (unit <= 0) return originalSize;
  return Math.max(originalSize * limits.minSizeRatio, Math.min(originalSize, room / unit));
}

/** Wrap text to a width, for multi-line fields. */
export function wrapText(text, fontRecord, fontSize, width) {
  const words = String(text ?? '').split(/(\s+)/).filter(w => w.length);
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line + w;
    if (line && measureText(candidate, fontRecord, fontSize) > width) {
      lines.push(line.trimEnd());
      line = w.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}
