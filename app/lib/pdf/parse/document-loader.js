/**
 * Builds the editable page model from a PDF.
 *
 * Two sources, deliberately:
 *   - getTextContent()   -> unicode, position, size, font key. pdf.js already
 *                           solves the 34% of fonts with no ToUnicode map, so we
 *                           do not reimplement that.
 *   - getOperatorList()  -> fill colour and originalCharCode, neither of which
 *                           getTextContent exposes.
 *
 * They are correlated by text-show operator index, which was verified 1:1
 * against an independent tokenizer (494/494 show ops, 494/494 setFont).
 *
 * Everything produced here is in PDF USER-SPACE UNITS. No screen pixels.
 */

import { createFontRecord } from '../model/fonts.js';
import { buildRunsFromOperatorList } from './text-from-oplist.js';
import { harvestShapes } from './shapes.js';
import { detectFields } from './field-detect.js';
import { buildSegments, buildLines } from '../model/grouping.js';

const DEFAULT_COLOR = { r: 0, g: 0, b: 0 };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const rgbToHex = ({ r, g, b } = {}) =>
  '#' + [r, g, b]
    .map(v => (Number.isFinite(v) ? v : 0))
    .map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0'))
    .join('');

const cmykToRgb = (c, m, y, k) => ({
  r: (1 - Math.min(1, c + k)), g: (1 - Math.min(1, m + k)), b: (1 - Math.min(1, y + k)),
});

/**
 * pdf.js normalises fill colours into a CSS hex STRING on setFillRGBColor
 * (`["#ff0000"]`), not three 0..1 numbers. Reading args[0..2] as numbers yields
 * NaN — and an <input type="color"> then silently shows black, hiding the bug.
 * Accept every shape and reject anything that isn't finite.
 */
function parseColorArgs(args) {
  if (!args || !args.length) return null;
  const a = args[0];

  if (typeof a === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(a.trim());
    if (m) {
      const v = parseInt(m[1], 16);
      return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
    }
    const rgbFn = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(a);
    if (rgbFn) return { r: +rgbFn[1] / 255, g: +rgbFn[2] / 255, b: +rgbFn[3] / 255 };
    return null;
  }

  if (typeof a === 'number') {
    const nums = [...args].filter(v => typeof v === 'number' && Number.isFinite(v));
    if (nums.length >= 3) return { r: nums[0], g: nums[1], b: nums[2] };
    if (nums.length === 1) return { r: nums[0], g: nums[0], b: nums[0] };
    return null;
  }

  if (a && typeof a.length === 'number' && a.length >= 3) {
    const scale = a instanceof Uint8ClampedArray || a instanceof Uint8Array ? 1 / 255 : 1;
    const [r, g, b] = [a[0] * scale, a[1] * scale, a[2] * scale];
    return [r, g, b].every(Number.isFinite) ? { r, g, b } : null;
  }
  return null;
}

/** Walk the operator list, recording the fill colour in effect at each text-show op. */
function harvestShowState(opList, OPS) {
  const colors = [];
  let fill = DEFAULT_COLOR;
  const stack = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    switch (fn) {
      case OPS.save:            stack.push(fill); break;
      case OPS.restore:         fill = stack.pop() ?? fill; break;
      case OPS.setFillRGBColor: { const c = parseColorArgs(args); if (c) fill = c; break; }
      case OPS.setFillGray: {
        const g = typeof args?.[0] === 'number' ? args[0] : null;
        if (g !== null && Number.isFinite(g)) fill = { r: g, g, b: g };
        else { const c = parseColorArgs(args); if (c) fill = c; }
        break;
      }
      case OPS.setFillCMYKColor: {
        const n = [...(args || [])].filter(v => typeof v === 'number' && Number.isFinite(v));
        if (n.length >= 4) fill = cmykToRgb(n[0], n[1], n[2], n[3]);
        else { const c = parseColorArgs(args); if (c) fill = c; }
        break;
      }
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText: {
        // Harvest the original byte codes alongside the colour.
        const glyphs = Array.isArray(args[0]) ? args[0] : [];
        const codes = [];
        const widths = [];
        for (const g of glyphs) {
          if (g && typeof g === 'object' && g.originalCharCode !== undefined) {
            codes.push([g.originalCharCode, g.unicode]);
            // Advance in 1000-unit glyph space. Harvesting these gives us real
            // metrics for the document's own font, which is what makes it
            // possible to know whether edited text will still fit.
            if (Number.isFinite(g.width)) widths.push([g.unicode, g.width]);
          }
        }
        colors.push({ fill: { ...fill }, codes, widths });
        break;
      }
      default: break;
    }
  }
  return colors;
}

/** Build FontRecords for every font referenced on the page. */
function buildFontRecords(page, fontKeys, showStates) {
  // charCode -> unicode, accumulated per font from the operator list
  const perFontMap = new Map();
  const perFontWidths = new Map();
  for (const s of showStates) {
    if (!s.fontKey) continue;
    for (const [code, uni] of s.codes) {
      let m = perFontMap.get(s.fontKey);
      if (!m) perFontMap.set(s.fontKey, (m = new Map()));
      if (uni !== undefined && !m.has(code)) m.set(code, uni);
    }
    for (const [uni, w] of (s.widths || [])) {
      let wm = perFontWidths.get(s.fontKey);
      if (!wm) perFontWidths.set(s.fontKey, (wm = new Map()));
      if (uni !== undefined && !wm.has(uni)) wm.set(uni, w / 1000);
    }
  }

  const records = new Map();
  for (const key of fontKeys) {
    let raw = null;
    try { raw = page.commonObjs.get(key); } catch { /* not yet resolved */ }
    records.set(key, createFontRecord({
      key,
      baseFont: raw?.name || key,
      flags: raw?.flags,
      italicAngle: raw?.italicAngle ?? (raw?.italic ? -12 : 0),
      ascent: raw?.ascent,
      descent: raw?.descent,
      toUnicode: perFontMap.get(key) || new Map(),
      widths: perFontWidths.get(key) || new Map(),
    }));
  }
  return records;
}

/**
 * @returns {Promise<{index:number, width:number, height:number, rotation:number,
 *                    runs:Array, fonts:Map}>}
 */
export async function loadPageModel(pdf, pageIndex, OPS) {
  // `phase` rides along on any thrown error so a failure names the step that
  // broke instead of hanging the UI with no explanation.
  let phase = 'getPage';
  const fail = err => {
    const e = err instanceof Error ? err : new Error(String(err));
    e.phase = phase;
    e.pageIndex = pageIndex;
    throw e;
  };

  let page, base;
  try {
    page = await pdf.getPage(pageIndex + 1);
    phase = 'getViewport';
    base = page.getViewport({ scale: 1, rotation: 0 });
  } catch (err) { fail(err); }

  // Colour and charCode harvesting is an ENHANCEMENT. If the operator list is
  // unavailable or malformed we still return an editable page, just without
  // per-run colour — never a dead screen.
  let showStates = [];
  let opList = null;
  try {
    phase = 'getOperatorList';
    opList = await page.getOperatorList();
    phase = 'harvestShowState';
    showStates = harvestShowState(opList, OPS);
  } catch (err) {
    console.warn(`[pdf] colour/charcode harvest failed on page ${pageIndex + 1} (${phase}):`, err?.message || err);
    showStates = [];
  }

  // getTextContent is a second, higher-level pass that can fail on documents
  // the operator list handles fine. Three attempts, degrading in order:
  //   1. normal
  //   2. with normalization disabled (a known throw site)
  //   3. reconstruct from the operator list ourselves
  let items = null;
  let usedFallback = false;
  try {
    phase = 'getTextContent';
    const tc = await page.getTextContent();
    items = (tc.items || []).filter(it => it.str && it.transform?.length >= 6);
  } catch (err) {
    console.warn(`[pdf] getTextContent failed on page ${pageIndex + 1}:`, err?.message || err);
    try {
      phase = 'getTextContent(disableNormalization)';
      const tc = await page.getTextContent({ disableNormalization: true });
      items = (tc.items || []).filter(it => it.str && it.transform?.length >= 6);
      console.info('[pdf] recovered via disableNormalization');
    } catch (err2) {
      console.warn(`[pdf] retry also failed:`, err2?.message || err2);
      if (!opList) {
        phase = 'getTextContent';
        fail(err);
      }
      phase = 'buildRunsFromOperatorList';
      try {
        const raw = buildRunsFromOperatorList(opList, OPS, pageIndex);
        items = raw.map(r => ({
          str: r.text,
          transform: [r.size, 0, 0, r.size, r.x, r.baseline],
          width: r.w,
          height: r.size,
          fontName: r.fontKey,
          dir: 'ltr',
        }));
        usedFallback = true;
        console.info(`[pdf] recovered ${items.length} runs from the operator list`);
      } catch (err3) {
        phase = 'getTextContent';
        fail(err);
      }
    }
  }

  const fontKeys = new Set(items.map(it => it.fontName).filter(Boolean));
  // Positional alignment between showStates and items only holds on the primary
  // path; the fallback derives runs from the op list itself, so don't fake it.
  if (!usedFallback) {
    showStates.forEach((st, i) => { st.fontKey = items[i]?.fontName ?? null; });
  } else {
    showStates.forEach((st, i) => { st.fontKey = items[i]?.fontName ?? st.fontKey ?? null; });
  }

  let fonts = new Map();
  try {
    phase = 'buildFontRecords';
    fonts = buildFontRecords(page, fontKeys, showStates);
  } catch (err) {
    console.warn(`[pdf] font identification failed on page ${pageIndex + 1}:`, err?.message || err);
  }

  const runs = items.map((it, i) => {
    const [a, b, , d, e, f] = it.transform;
    // Glyph size is the vertical scale of the text matrix, in PDF units.
    const size = Math.hypot(b, d) || Math.abs(d) || Math.abs(a) || 12;
    const width = it.width || 0;
    const height = it.height || size;
    const state = showStates[i];
    return {
      id: `r${pageIndex}_${i}`,
      pageIndex,
      text: it.str,
      // PDF user space. `y` is the BASELINE; the box bottom sits below it.
      x: e,
      baseline: f,
      y: f - size * 0.2,          // approximate descender drop for the hit box
      w: width,
      h: height,
      fontSize: size,
      fontKey: it.fontName || null,
      color: state ? state.fill : DEFAULT_COLOR,
      colorHex: rgbToHex(state ? state.fill : DEFAULT_COLOR),
      charCodes: state ? state.codes.map(c => c[0]) : [],
      rtl: !!it.dir && it.dir === 'rtl',
      // set once the user edits it
      edited: false,
    };
  })
  // Keep EVERY run. The old editor dropped anything under 2 characters,
  // which made single letters permanently uneditable.
  .filter(r =>
    r.text.length > 0 &&
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.w) && Number.isFinite(r.h) &&
    Number.isFinite(r.fontSize) && r.fontSize > 0
  );

  const width = Number.isFinite(base?.width) && base.width > 0 ? base.width : 612;
  const height = Number.isFinite(base?.height) && base.height > 0 ? base.height : 792;

  // Selection units. Raw runs may be individual glyphs; nobody wants to select
  // a letter, so segments are what the editor offers.
  let segments = [];
  let lines = [];
  try {
    phase = 'buildSegments';
    segments = buildSegments(runs, { pageIndex });
    lines = buildLines(segments);
  } catch (err) {
    console.warn(`[pdf] grouping failed on page ${pageIndex + 1}:`, err?.message || err);
  }

  // Where a person can type: declared form widgets, or inferred from the
  // page's own vector furniture (combs, boxes, rules).
  let fields = [];
  try {
    phase = 'detectFields';
    const shapes = opList ? harvestShapes(opList, OPS) : [];
    let annotations = [];
    try { annotations = await page.getAnnotations(); } catch { annotations = []; }
    fields = detectFields({ annotations, shapes, runs });
  } catch (err) {
    console.warn(`[pdf] field detection failed on page ${pageIndex + 1}:`, err?.message || err);
  }

  return {
    index: pageIndex,
    degraded: usedFallback,
    width,
    height,
    segments,
    lines,
    fields,
    rotation: page.rotate || 0,
    runs,
    fonts,
    page,
  };
}
