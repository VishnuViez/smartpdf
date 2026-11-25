/**
 * Harvests vector geometry (lines, rectangles) from a page's operator list.
 *
 * Forms express their input areas as graphics, not text: a blank is a long thin
 * line, a field is a stroked rectangle, a comb is a row of equal cells. To treat
 * those as editable inputs we first have to see them.
 *
 * pdf.js encodes paths as `constructPath [drawOp, Float32Array, localBBox]`
 * where the command codes are moveTo=0, lineTo=1, curveTo=2, quadraticCurveTo=3,
 * closePath=4, and coordinates are in LOCAL space — the CTM positions them.
 *
 * Output is in PDF user-space units.
 */

const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4;

function mul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
const IDENTITY = [1, 0, 0, 1, 0, 0];
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function matrixFrom(args) {
  if (!args) return null;
  if (typeof args[0] === 'number' && args.length >= 6) return [args[0], args[1], args[2], args[3], args[4], args[5]];
  const m = args[0];
  if (m && typeof m !== 'number' && m.length >= 6) return [m[0], m[1], m[2], m[3], m[4], m[5]];
  return null;
}

/** Decode a pdf.js path command buffer into a list of subpaths (point arrays). */
function decodeSubpaths(cmds) {
  const subpaths = [];
  let cur = null;
  for (let i = 0; i < cmds.length;) {
    const op = cmds[i];
    if (op === MOVE) {
      if (cur && cur.pts.length) subpaths.push(cur);
      cur = { pts: [[cmds[i + 1], cmds[i + 2]]], closed: false };
      i += 3;
    } else if (op === LINE) {
      if (!cur) cur = { pts: [], closed: false };
      cur.pts.push([cmds[i + 1], cmds[i + 2]]);
      i += 3;
    } else if (op === CURVE) {
      if (!cur) cur = { pts: [], closed: false };
      cur.pts.push([cmds[i + 5], cmds[i + 6]]);   // endpoint only
      cur.curved = true;
      i += 7;
    } else if (op === QUAD) {
      if (!cur) cur = { pts: [], closed: false };
      cur.pts.push([cmds[i + 3], cmds[i + 4]]);
      cur.curved = true;
      i += 5;
    } else if (op === CLOSE) {
      if (cur) { cur.closed = true; subpaths.push(cur); cur = null; }
      i += 1;
    } else {
      break;                                       // unknown code: stop rather than misread
    }
  }
  if (cur && cur.pts.length) subpaths.push(cur);
  return subpaths;
}

const EPS = 0.6;   // PDF units; tolerance for "axis aligned"

function classify(pts, closed, curved) {
  if (curved || pts.length < 2) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;

  // A 2-point axis-aligned segment
  if (pts.length === 2) {
    if (h <= EPS && w > EPS) return { type: 'hline', x: x0, y: y0, w, h: 0 };
    if (w <= EPS && h > EPS) return { type: 'vline', x: x0, y: y0, w: 0, h };
    return null;
  }

  // 4 or 5 points tracing an axis-aligned rectangle
  const uniq = [];
  for (const p of pts) {
    if (!uniq.some(q => Math.abs(q[0] - p[0]) < EPS && Math.abs(q[1] - p[1]) < EPS)) uniq.push(p);
  }
  if (uniq.length === 4) {
    const axisAligned = uniq.every(p =>
      (Math.abs(p[0] - x0) < EPS || Math.abs(p[0] - x1) < EPS) &&
      (Math.abs(p[1] - y0) < EPS || Math.abs(p[1] - y1) < EPS));
    if (axisAligned && w > EPS && h > EPS) return { type: 'rect', x: x0, y: y0, w, h };
  }
  // A degenerate "rectangle" that is really a rule
  if (uniq.length >= 2 && h <= EPS && w > EPS) return { type: 'hline', x: x0, y: y0, w, h: 0 };
  if (uniq.length >= 2 && w <= EPS && h > EPS) return { type: 'vline', x: x0, y: y0, w: 0, h };
  void closed;
  return null;
}

/**
 * @returns {Array<{type:'hline'|'vline'|'rect', x,y,w,h, stroked:boolean, filled:boolean, lineWidth:number}>}
 */
export function harvestShapes(opList, OPS) {
  const shapes = [];
  if (!opList?.fnArray) return shapes;

  let ctm = IDENTITY.slice();
  const stack = [];
  let lineWidth = 1;
  const lwStack = [];

  const fn = opList.fnArray, args = opList.argsArray;

  for (let i = 0; i < fn.length; i++) {
    const op = fn[i], a = args[i];
    switch (op) {
      case OPS.save: stack.push(ctm.slice()); lwStack.push(lineWidth); break;
      case OPS.restore: ctm = stack.pop() || IDENTITY.slice(); lineWidth = lwStack.pop() ?? lineWidth; break;
      case OPS.transform: { const m = matrixFrom(a); if (m) ctm = mul(m, ctm); break; }
      case OPS.setLineWidth: if (typeof a?.[0] === 'number') lineWidth = a[0]; break;

      case OPS.constructPath: {
        const drawOp = a?.[0];
        const raw = a?.[1];
        const cmds = Array.isArray(raw) ? raw[0] : raw;
        if (!cmds || typeof cmds.length !== 'number') break;

        const stroked = drawOp === OPS.stroke || drawOp === OPS.closeStroke || drawOp === OPS.fillStroke;
        const filled = drawOp === OPS.fill || drawOp === OPS.eoFill || drawOp === OPS.fillStroke;

        for (const sp of decodeSubpaths(cmds)) {
          const pts = sp.pts.map(([x, y]) => { const p = apply(ctm, x, y); return [p.x, p.y]; });
          const shape = classify(pts, sp.closed, sp.curved);
          if (!shape) continue;
          const scale = Math.hypot(ctm[0], ctm[1]) || 1;
          shapes.push({ ...shape, stroked, filled, lineWidth: lineWidth * scale });
        }
        break;
      }
      default: break;
    }
  }

  // A filled rectangle thinner than ~2 units is a rule, not a box.
  return shapes.map(s =>
    s.type === 'rect' && s.filled && !s.stroked && s.h <= 2
      ? { ...s, type: 'hline', y: s.y + s.h / 2, h: 0 }
      : s
  ).filter(s => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.w) && Number.isFinite(s.h));
}
