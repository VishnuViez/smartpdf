/**
 * Surgery on a page's content stream.
 *
 * The rule from the start of this work: replace only the token spans that
 * changed and pass every other byte through untouched. That is what keeps a
 * dense page pixel-identical apart from the edit.
 *
 * Original glyphs are HIDDEN, not deleted. A text-show operator advances the
 * text matrix; removing one shifts everything drawn after it. Wrapping it in
 * render mode 3 makes it invisible while preserving every advance exactly.
 */

import { tokenize, T } from '../parse/tokenizer.js';

/**
 * Model runs cannot be mapped onto show operations by index: pdf.js merges
 * adjacent operations into single text items, so a page with 494 show ops may
 * report 411 items. Matching by ordinal would edit the wrong text. Each show op
 * therefore carries its own POSITION, and runs are matched geometrically.
 */
function mul(m1, m2) {
  return [
    m1[0]*m2[0] + m1[1]*m2[2], m1[0]*m2[1] + m1[1]*m2[3],
    m1[2]*m2[0] + m1[3]*m2[2], m1[2]*m2[1] + m1[3]*m2[3],
    m1[4]*m2[0] + m1[5]*m2[2] + m2[4], m1[4]*m2[1] + m1[5]*m2[3] + m2[5],
  ];
}
const IDENTITY = [1, 0, 0, 1, 0, 0];
const translate = (x, y) => [1, 0, 0, 1, x, y];

const OPERAND_TYPES = new Set([T.STR, T.HEX]);
const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * Index every text-show operation, with the graphics state in effect.
 * Order matches pdf.js's showText sequence, which is how model runs are mapped
 * back onto bytes (verified 494/494 against an independent walk).
 */
export function indexShowOps(buf) {
  const toks = tokenize(buf);
  const ops = [];
  let fontResource = null;
  let fontSize = null;
  let renderMode = 0;
  let ctm = IDENTITY.slice();
  let tm = IDENTITY.slice();
  let tlm = IDENTITY.slice();
  let leading = 0;
  const stack = [];

  const nums = (i, count) => {
    const out = [];
    for (let j = i - 1; j >= 0 && out.length < count; j--) {
      if (toks[j].t === T.NUM) out.unshift(Number(buf.toString('latin1', toks[j].start, toks[j].end)));
      else if (toks[j].t !== T.WS) break;
    }
    return out;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== T.OP) continue;

    if (t.op === 'q') { stack.push({ fontResource, fontSize, renderMode, ctm: ctm.slice() }); continue; }
    if (t.op === 'Q') {
      const s = stack.pop();
      if (s) { fontResource = s.fontResource; fontSize = s.fontSize; renderMode = s.renderMode; ctm = s.ctm; }
      continue;
    }
    if (t.op === 'cm') { const n = nums(i, 6); if (n.length === 6) ctm = mul(n, ctm); continue; }
    if (t.op === 'BT') { tm = IDENTITY.slice(); tlm = IDENTITY.slice(); continue; }
    if (t.op === 'Tm') { const n = nums(i, 6); if (n.length === 6) { tm = n.slice(); tlm = n.slice(); } continue; }
    if (t.op === 'Td') { const n = nums(i, 2); if (n.length === 2) { tlm = mul(translate(n[0], n[1]), tlm); tm = tlm.slice(); } continue; }
    if (t.op === 'TD') { const n = nums(i, 2); if (n.length === 2) { leading = -n[1]; tlm = mul(translate(n[0], n[1]), tlm); tm = tlm.slice(); } continue; }
    if (t.op === 'TL') { const n = nums(i, 1); if (n.length) leading = n[0]; continue; }
    if (t.op === 'T*') { tlm = mul(translate(0, -leading), tlm); tm = tlm.slice(); continue; }
    if (t.op === 'Tf') {
      // ... /Name size Tf
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (toks[j].t === T.NUM && fontSize === null) fontSize = Number(buf.toString('latin1', toks[j].start, toks[j].end));
        if (toks[j].t === T.NAME) { fontResource = buf.toString('latin1', toks[j].start, toks[j].end); break; }
      }
      // re-read size fresh each time
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (toks[j].t === T.NUM) { fontSize = Number(buf.toString('latin1', toks[j].start, toks[j].end)); break; }
      }
      continue;
    }
    if (t.op === 'Tr') {
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (toks[j].t === T.NUM) { renderMode = Number(buf.toString('latin1', toks[j].start, toks[j].end)); break; }
      }
      continue;
    }
    if (!SHOW_OPS.has(t.op)) continue;

    // Find where the operand begins so the whole expression can be wrapped.
    let operandStart = t.start;
    if (t.op === 'TJ') {
      let depth = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (toks[j].t === T.ARR_C) depth++;
        else if (toks[j].t === T.ARR_O) {
          if (depth === 0) { operandStart = toks[j].start; break; }
          depth--;
        }
      }
    } else {
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (OPERAND_TYPES.has(toks[j].t)) { operandStart = toks[j].start; break; }
        if (toks[j].t === T.NUM) continue;                 // ' and " take numbers first
      }
    }

    if (t.op === "'" || t.op === '"') { tlm = mul(translate(0, -leading), tlm); tm = tlm.slice(); }
    const trm = mul(mul([fontSize || 1, 0, 0, fontSize || 1, 0, 0], tm), ctm);

    ops.push({
      index: ops.length,
      op: t.op,
      start: operandStart,
      end: t.end,
      fontResource,
      fontSize,
      renderMode,
      x: trm[4],
      baseline: trm[5],
      size: Math.hypot(trm[2], trm[3]) || fontSize || 0,
    });
  }
  return ops;
}

/**
 * Unclosed `q` operators at the end of a content stream.
 *
 * Converter-produced PDFs routinely open the page with something like
 * `q  .24 0 0 -.24 0 792 cm` — a device-space transform with a Y flip — and
 * never close it, or close it in a later content stream. Anything appended
 * afterwards inherits that transform, so text written at (204, 562) lands at
 * (49, 657) at a quarter of its size.
 *
 * PDF has no operator to reset the CTM, so the only way to append in page
 * space is to unwind the stack first.
 */
export function invertMatrix(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) return null;
  return [
    d / det, -b / det,
    -c / det, a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

const IDENTITY_M = [1, 0, 0, 1, 0, 0];
const isIdentity = m => m.every((v, i) => Math.abs(v - IDENTITY_M[i]) < 1e-9);

/**
 * The CTM in effect at the END of a content stream.
 *
 * Converter-produced PDFs commonly open the page with a device-space transform
 * such as `q .24 0 0 -.24 0 792 cm` and never unwind it before the stream ends.
 * Anything appended then inherits it: text written at (204, 562) at 12pt lands
 * at (49, 657) at 2.88pt. Rather than trying to balance the stack — which
 * depends on how the producer nested things — measure the transform and cancel
 * it with its own inverse.
 */
export function endCTM(buf) {
  let ctm = IDENTITY_M.slice();
  const stack = [];
  const toks = tokenize(buf);
  const nums = (i, count) => {
    const out = [];
    for (let j = i - 1; j >= 0 && out.length < count; j--) {
      if (toks[j].t === T.NUM) out.unshift(Number(buf.toString('latin1', toks[j].start, toks[j].end)));
      else if (toks[j].t !== T.WS) break;
    }
    return out;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== T.OP) continue;
    if (t.op === 'q') stack.push(ctm.slice());
    else if (t.op === 'Q') ctm = stack.pop() || IDENTITY_M.slice();
    else if (t.op === 'cm') { const n = nums(i, 6); if (n.length === 6) ctm = mulM(n, ctm); }
  }
  return ctm;
}

function mulM(m1, m2) {
  return [
    m1[0]*m2[0] + m1[1]*m2[2], m1[0]*m2[1] + m1[1]*m2[3],
    m1[2]*m2[0] + m1[3]*m2[2], m1[2]*m2[1] + m1[3]*m2[3],
    m1[4]*m2[0] + m1[5]*m2[2] + m2[4], m1[4]*m2[1] + m1[5]*m2[3] + m2[5],
  ];
}

export function graphicsDepth(buf) {
  let depth = 0;
  for (const t of tokenize(buf)) {
    if (t.t !== T.OP) continue;
    if (t.op === 'q') depth++;
    else if (t.op === 'Q' && depth > 0) depth--;
  }
  return depth;
}

/**
 * @param {Buffer} buf                original decoded content stream
 * @param {object} plan
 * @param {Set<number>|number[]} [plan.hide]     show-op indices to make INVISIBLE
 * @param {Set<number>|number[]} [plan.erase]    show-op indices to DELETE outright
 * @param {string[]} [plan.append]               operator strings appended at the end
 * @returns {Buffer}
 *
 * `hide` and `erase` are different operations and must not be confused.
 *
 *   hide  — wraps the operator in render mode 3. The glyphs stop being drawn
 *           but remain in the file, so text extraction still finds them and
 *           every advance is preserved. Correct for editing, where following
 *           text must not shift.
 *
 *   erase — replaces the string operand with an empty one. The glyphs are gone
 *           from the file and cannot be recovered by copy-paste, text
 *           extraction or a hex editor. Correct for redaction, where leaving
 *           recoverable text would defeat the entire point.
 */
export function rewriteContent(buf, plan = {}) {
  const hide = plan.hide instanceof Set ? plan.hide : new Set(plan.hide || []);
  const erase = plan.erase instanceof Set ? plan.erase : new Set(plan.erase || []);
  const append = plan.append || [];
  if (!hide.size && !erase.size && !append.length) return Buffer.from(buf);

  const ops = indexShowOps(buf);
  const targets = ops
    .filter(o => hide.has(o.index) || erase.has(o.index))
    .sort((a, b) => a.start - b.start);

  const pieces = [];
  let cursor = 0;
  for (const t of targets) {
    if (t.start < cursor) continue;                        // overlapping; skip defensively
    pieces.push(buf.subarray(cursor, t.start));
    if (erase.has(t.index)) {
      // The glyphs are REMOVED, not concealed. An empty operand keeps the
      // operator well formed while leaving nothing to extract.
      const empty = t.op === 'TJ' ? '[]' : '()';
      pieces.push(Buffer.from(`${empty} ${t.op}`, 'latin1'));
    } else {
      const original = buf.toString('latin1', t.start, t.end);
      pieces.push(Buffer.from(`3 Tr ${original} ${t.renderMode} Tr`, 'latin1'));
    }
    cursor = t.end;
  }
  pieces.push(buf.subarray(cursor));

  if (append.length) {
    const body = Buffer.concat(pieces);

    // Cancel whatever transform the page left in effect, so appended content is
    // positioned in PAGE space rather than the producer's device space.
    const ctm = endCTM(body);
    let prefix = '\n';
    let suffix = '';
    if (!isIdentity(ctm)) {
      const inv = invertMatrix(ctm);
      if (inv) {
        const n = v => (Math.round(v * 1e6) / 1e6);
        prefix = `\nq\n${inv.map(n).join(' ')} cm\n`;
        suffix = 'Q\n';
      }
    }
    return Buffer.concat([
      body,
      Buffer.from(prefix, 'latin1'),
      Buffer.from(append.join('\n') + '\n' + suffix, 'latin1'),
    ]);
  }
  return Buffer.concat(pieces);
}


/**
 * Show operations whose origin falls inside `rect` (PDF units).
 * Geometric, not ordinal — see the note on indexShowOps.
 */
export function showOpsInRect(ops, rect, { padX = 1.5, padY = 3 } = {}) {
  if (!rect) return [];
  const x0 = rect.x - padX, x1 = rect.x + rect.w + padX;
  const y0 = rect.y - padY, y1 = rect.y + rect.h + padY;
  return ops.filter(o =>
    Number.isFinite(o.x) && Number.isFinite(o.baseline) &&
    o.x >= x0 && o.x <= x1 && o.baseline >= y0 && o.baseline <= y1
  );
}
