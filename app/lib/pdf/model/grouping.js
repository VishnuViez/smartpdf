/**
 * Groups raw text runs into the units a person actually wants to select.
 *
 * A PDF has no concept of a word. It has show-operations, which may be a whole
 * paragraph or a single glyph — some producers emit one operation per character.
 * Selecting those directly means selecting letters, which is useless.
 *
 * Three levels, built bottom-up, all in PDF user-space units:
 *   word    — glyphs with no meaningful gap between them
 *   segment — words separated only by ordinary spaces (the default click target)
 *   line    — every segment sharing a baseline
 *
 * A segment break is what keeps "Name: ____" and "Phone: ____" apart when they
 * sit on the same baseline: they are one line but two segments, because the gap
 * between them is far wider than a space.
 */

// Multiples of font size.
const WORD_GAP = 0.18;      // wider than this ends a word
const SEGMENT_GAP = 1.0;    // wider than this ends a segment
const BASELINE_TOL = 0.5;   // fraction of font size

const num = v => (Number.isFinite(v) ? v : 0);
const isBlank = r => !r.text || !r.text.trim();

/**
 * pdf.js synthesises whitespace runs that SPAN the gap they represent — between
 * "Name:" and "Phone:" it emits a single space run 227 units wide. So a gap is
 * not visible as distance between runs; it arrives as a wide blank run. Treat a
 * blank run wider than `factor` × font size as the separator it actually is.
 */
function isSeparator(r, factor) {
  if (!isBlank(r)) return false;
  const size = Math.max(num(r.fontSize), 1);
  return num(r.w) > size * factor;
}

/** Runs sharing a baseline, ordered left to right. */
export function groupIntoLines(runs) {
  const sorted = [...runs].sort((a, b) => (b.baseline - a.baseline) || (a.x - b.x));
  const lines = [];
  for (const r of sorted) {
    const tol = Math.max(1, num(r.fontSize) * BASELINE_TOL);
    const line = lines.find(l =>
      Math.abs(l.baseline - r.baseline) <= Math.max(tol, l.tol));
    if (line) {
      line.runs.push(r);
      line.tol = Math.max(line.tol, tol);
    } else {
      lines.push({ baseline: r.baseline, tol, runs: [r] });
    }
  }
  for (const l of lines) l.runs.sort((a, b) => a.x - b.x);
  return lines;
}

const gapBetween = (prev, next) => next.x - (prev.x + num(prev.w));

/**
 * Split one line's runs wherever the separation exceeds `factor` × font size.
 * Separation arrives two ways: real distance between runs, and wide blank runs
 * that pdf.js synthesised to represent the gap.
 */
function splitByGap(runs, factor) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };

  for (const r of runs) {
    if (isSeparator(r, factor)) { flush(); continue; }   // the blank IS the break
    if (!cur.length) { cur = [r]; continue; }
    const prev = cur[cur.length - 1];
    const size = Math.max(num(prev.fontSize), num(r.fontSize), 1);
    if (gapBetween(prev, r) > size * factor) { flush(); cur = [r]; }
    else cur.push(r);
  }
  flush();
  // Groups that are nothing but whitespace carry no content.
  return groups.filter(g => g.some(r => !isBlank(r)));
}

function bboxOf(runs) {
  const x = Math.min(...runs.map(r => r.x));
  const right = Math.max(...runs.map(r => r.x + num(r.w)));
  const bottom = Math.min(...runs.map(r => num(r.y)));
  const top = Math.max(...runs.map(r => num(r.y) + num(r.h)));
  return { x, y: bottom, w: right - x, h: Math.max(top - bottom, 1) };
}

/** Join run texts, inserting a space only where the gap implies one. */
function joinText(runs) {
  let out = '';
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (i > 0) {
      const prev = runs[i - 1];
      const size = Math.max(num(prev.fontSize), num(r.fontSize), 1);
      const gap = gapBetween(prev, r);
      const endsOpen = /\s$/.test(out);
      const startsSpace = /^\s/.test(r.text);
      if (!endsOpen && !startsSpace && gap > size * WORD_GAP) out += ' ';
    }
    out += r.text;
  }
  return out;
}

/**
 * @param {Array} runs raw runs from the loader (PDF units)
 * @returns {Array} segments — the default selection unit
 */
export function buildSegments(runs, { pageIndex = 0 } = {}) {
  const segments = [];
  let n = 0;

  for (const line of groupIntoLines(runs)) {
    for (const raw of splitByGap(line.runs, SEGMENT_GAP)) {
      // Drop blank runs at the edges: their width is gap, not content.
      let a = 0, b = raw.length;
      while (a < b && isBlank(raw[a])) a++;
      while (b > a && isBlank(raw[b - 1])) b--;
      const group = raw.slice(a, b);
      if (!group.length) continue;
      const words = splitByGap(group, WORD_GAP).map(wr => ({
        text: joinText(wr),
        ...bboxOf(wr),
        runIds: wr.map(r => r.id),
      })).filter(w => w.text.length);

      const box = bboxOf(group);
      const dominant = group.reduce(
        (best, r) => (num(r.w) > num(best.w) ? r : best), group[0]);

      segments.push({
        id: `seg${pageIndex}_${n++}`,
        type: 'segment',
        pageIndex,
        text: joinText(group),
        ...box,
        baseline: line.baseline,
        fontSize: dominant.fontSize,
        fontKey: dominant.fontKey,
        color: dominant.color,
        colorHex: dominant.colorHex,
        words,
        runIds: group.map(r => r.id),
        runs: group,
      });
    }
  }

  return segments.filter(s => s.text.length > 0);
}

/** Segments sharing a baseline, for line-level selection. */
export function buildLines(segments) {
  const lines = [];
  for (const s of [...segments].sort((a, b) => (b.baseline - a.baseline) || (a.x - b.x))) {
    const tol = Math.max(1, num(s.fontSize) * BASELINE_TOL);
    const line = lines.find(l => Math.abs(l.baseline - s.baseline) <= tol);
    if (line) line.segments.push(s);
    else lines.push({ id: `line_${lines.length}`, baseline: s.baseline, segments: [s] });
  }
  return lines.map(l => ({
    ...l,
    ...bboxOf(l.segments),
    text: l.segments.map(s => s.text).join('  '),
    segmentIds: l.segments.map(s => s.id),
  }));
}
