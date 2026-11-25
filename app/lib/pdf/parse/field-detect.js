/**
 * Works out where a person can type.
 *
 * Three sources, in order of authority:
 *   1. AcroForm widgets — the document declaring its own fields. Always trust these.
 *   2. Comb cells      — a row of equal, evenly spaced boxes, one character each.
 *   3. Boxes and rules — a stroked rectangle, or a long thin line under a label.
 *
 * Every field exposes a CONTENT box (the rect minus padding) and a text
 * baseline, so typed text lands optically centred rather than jammed against an
 * edge. All geometry is PDF user-space units.
 */

const num = v => (Number.isFinite(v) ? v : 0);

// Typical Latin metrics as fractions of font size.
const ASCENT = 0.75, DESCENT = 0.25;

/** Baseline that optically centres text of `size` in a box of height `h` at `y`. */
export function centeredBaseline(y, h, size) {
  return y + h / 2 - (ASCENT - (ASCENT + DESCENT) / 2) * size;
}

/** Largest font size that fits `h` with `padding` above and below. */
export function fitFontSize(h, padding = 2, max = 48) {
  return Math.max(4, Math.min(max, (h - padding * 2) / (ASCENT + DESCENT)));
}

function contentBox(rect, padding) {
  return {
    x: rect.x + padding.left,
    y: rect.y + padding.bottom,
    w: Math.max(1, rect.w - padding.left - padding.right),
    h: Math.max(1, rect.h - padding.top - padding.bottom),
  };
}

/** Padding scaled to the box: generous in big boxes, minimal in small ones. */
function paddingFor(w, h) {
  const p = Math.min(4, Math.max(1, h * 0.15));
  return { top: p, bottom: p, left: Math.min(6, Math.max(2, w * 0.02)), right: Math.min(6, Math.max(2, w * 0.02)) };
}

/** ---------- 1. AcroForm widgets ---------- */
export function fieldsFromAnnotations(annotations = []) {
  const out = [];
  for (const a of annotations) {
    if (a.subtype !== 'Widget' || a.fieldType !== 'Tx') continue;
    const [x0, y0, x1, y1] = a.rect || [];
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    const rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    const padding = paddingFor(rect.w, rect.h);
    const content = contentBox(rect, padding);
    // A declared size of 0 means "auto" in PDF; fit it to the box.
    const declared = num(a.defaultAppearanceData?.fontSize);
    const fontSize = declared > 0 && declared <= content.h / (ASCENT + DESCENT)
      ? declared
      : fitFontSize(rect.h, padding.top);
    out.push({
      kind: 'acroform',
      source: 'annotation',
      name: a.fieldName || null,
      rect, padding, content,
      multiline: !!a.multiLine,
      comb: !!a.comb,
      maxLen: num(a.maxLen) || null,
      readOnly: !!a.readOnly,
      value: a.fieldValue || '',
      fontSize,
      baseline: a.multiLine
        ? content.y + content.h - ASCENT * fontSize
        : centeredBaseline(rect.y, rect.h, fontSize),
      cells: null,
    });
  }
  return out;
}

/** ---------- 2. Comb cells ---------- */
const SAME = (a, b, tol) => Math.abs(a - b) <= tol;

export function detectCombs(rects, { minCells = 3 } = {}) {
  const combs = [];
  const used = new Set();
  // group by (height, y) so only cells on the same row can combine
  const rows = new Map();
  for (const r of rects) {
    const key = `${Math.round(r.y)}_${Math.round(r.h)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(r);
  }

  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    let run = [];
    const flush = () => {
      if (run.length >= minCells) {
        const first = run[0], last = run[run.length - 1];
        const rect = { x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h };
        // cells carry geometry only, not shape metadata
        const padding = paddingFor(rect.w, rect.h);
        const fontSize = fitFontSize(rect.h, padding.top);
        combs.push({
          kind: 'comb', source: 'vector', name: null,
          rect, padding, content: contentBox(rect, padding),
          multiline: false, comb: true, maxLen: run.length, readOnly: false, value: '',
          fontSize,
          baseline: centeredBaseline(rect.y, rect.h, fontSize),
          cells: run.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, centerX: c.x + c.w / 2 })),
        });
        for (const c of run) used.add(c);
      }
      run = [];
    };
    for (const r of sorted) {
      if (!run.length) { run = [r]; continue; }
      const prev = run[run.length - 1];
      const tol = Math.max(1, prev.w * 0.12);
      const adjacent = SAME(r.x, prev.x + prev.w, tol) || SAME(r.x - prev.x, prev.w, tol);
      if (SAME(r.w, prev.w, tol) && SAME(r.h, prev.h, tol) && adjacent) run.push(r);
      else { flush(); run = [r]; }
    }
    flush();
  }
  return { combs, consumed: used };
}

/** ---------- 3. Boxes and underline rules ---------- */
const overlapsText = (rect, runs, coverage = 0.35) => {
  let covered = 0;
  for (const r of runs) {
    const ox = Math.min(rect.x + rect.w, r.x + num(r.w)) - Math.max(rect.x, r.x);
    const oy = Math.min(rect.y + rect.h, num(r.y) + num(r.h)) - Math.max(rect.y, num(r.y));
    if (ox > 0 && oy > 0) covered += ox * oy;
  }
  return covered / Math.max(1, rect.w * rect.h) > coverage;
};

/**
 * An input box is an OUTLINE. A filled shape is usually artwork — a decorative
 * panel, a rule, a background. Accept a filled-only shape only when it is
 * unmistakably field-shaped: wide, short, and not a large block.
 */
function looksLikeInput(r) {
  if (r.stroked) return true;
  if (!r.filled) return false;
  const aspect = r.w / Math.max(1, r.h);
  return aspect >= 2.5 && r.h <= 40;
}

export function detectBoxes(rects, runs, { minW = 24, minH = 10, maxH = 200 } = {}) {
  return rects
    .filter(r => r.w >= minW && r.h >= minH && r.h <= maxH)
    .filter(looksLikeInput)
    .filter(r => !overlapsText(r, runs))
    .map(shape => {
      // Carry only geometry forward; shape metadata is not part of the field.
      const rect = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
      const padding = paddingFor(rect.w, rect.h);
      const content = contentBox(rect, padding);
      const multiline = rect.h > 40;
      const fontSize = Math.min(fitFontSize(rect.h, padding.top), multiline ? 12 : 48);
      return {
        kind: 'box', source: 'vector', name: null,
        rect, padding, content,
        multiline, comb: false, maxLen: null, readOnly: false, value: '',
        fontSize,
        baseline: multiline
          ? content.y + content.h - ASCENT * fontSize
          : centeredBaseline(rect.y, rect.h, fontSize),
        cells: null,
      };
    });
}

/**
 * A blank has EMPTY SPACE above it — that is the whole point of it.
 * A table rule has its row text sitting directly on top. Without this check a
 * reference table reports a hundred "fields" nobody can type into.
 */
function hasRoomAbove(line, runs, height) {
  const top = line.y + height;
  for (const r of runs) {
    if (!r.text || !r.text.trim()) continue;      // synthesised spaces are not content
    const baseline = num(r.baseline, num(r.y));
    if (baseline < line.y || baseline > top) continue;
    // Any real text whose baseline sits in the writing band, overlapping the
    // rule horizontally, means this line is underlining something — not a blank.
    const ox = Math.min(line.x + line.w, r.x + num(r.w)) - Math.max(line.x, r.x);
    if (ox > 1) return false;
  }
  return true;
}

export function detectUnderlines(hlines, runs, { minW = 30, defaultHeight = 14 } = {}) {
  return hlines
    .filter(l => l.w >= minW)
    .filter(l => hasRoomAbove(l, runs, Math.max(6, defaultHeight * 0.8)))
    .map(l => {
      // The writing area sits ABOVE the rule. Height comes from nearby text if
      // there is any, so the field matches the form's own type size.
      const near = runs.filter(r =>
        num(r.baseline) > l.y - 2 && num(r.baseline) < l.y + defaultHeight * 2 &&
        r.x + num(r.w) > l.x - 120 && r.x < l.x + l.w + 40);
      const size = near.length
        ? near.reduce((m, r) => Math.max(m, num(r.fontSize)), 0) || defaultHeight
        : defaultHeight;
      const h = size * 1.4;
      const rect = { x: l.x, y: l.y, w: l.w, h };
      const padding = { top: 1, bottom: 1, left: 2, right: 2 };
      return {
        kind: 'underline', source: 'vector', name: null,
        rect, padding, content: contentBox(rect, padding),
        multiline: false, comb: false, maxLen: null, readOnly: false, value: '',
        fontSize: size,
        // sit just above the rule, not centred on it
        baseline: l.y + Math.max(1.5, size * 0.16),
        cells: null,
        rule: { x: l.x, y: l.y, w: l.w },
      };
    });
}

/** ---------- orchestration ---------- */
export function detectFields({ annotations = [], shapes = [], runs = [] } = {}) {
  const acro = fieldsFromAnnotations(annotations);

  // A document that declares its fields has told us the answer; don't guess on top.
  if (acro.length) return dedupe(acro);

  const rects = shapes.filter(s => s.type === 'rect');
  const hlines = shapes.filter(s => s.type === 'hline');

  const { combs, consumed } = detectCombs(rects);
  const remaining = rects.filter(r => !consumed.has(r));
  const boxes = detectBoxes(remaining, runs);
  const rules = detectUnderlines(hlines, runs);

  return dedupe([...combs, ...boxes, ...rules]);
}

/** Drop fields whose rects substantially coincide, keeping the more specific kind. */
const RANK = { acroform: 3, comb: 2, box: 1, underline: 0 };
function dedupe(fields) {
  const out = [];
  for (const f of [...fields].sort((a, b) => RANK[b.kind] - RANK[a.kind])) {
    const clash = out.some(g => {
      const ox = Math.min(f.rect.x + f.rect.w, g.rect.x + g.rect.w) - Math.max(f.rect.x, g.rect.x);
      const oy = Math.min(f.rect.y + f.rect.h, g.rect.y + g.rect.h) - Math.max(f.rect.y, g.rect.y);
      if (ox <= 0 || oy <= 0) return false;
      const inter = ox * oy;
      return inter / Math.max(1, Math.min(f.rect.w * f.rect.h, g.rect.w * g.rect.h)) > 0.6;
    });
    if (!clash) out.push(f);
  }
  return out.map((f, i) => ({ ...f, id: `field_${i}` }));
}

/** Lay a string into a comb field, one character per cell, each centred. */
export function layoutComb(field, text, measure) {
  if (!field.cells?.length) return [];
  const chars = [...String(text)].slice(0, field.cells.length);
  return chars.map((ch, i) => {
    const cell = field.cells[i];
    const w = typeof measure === 'function' ? measure(ch, field.fontSize) : field.fontSize * 0.5;
    return { char: ch, x: cell.centerX - w / 2, baseline: field.baseline, cell: i };
  });
}
