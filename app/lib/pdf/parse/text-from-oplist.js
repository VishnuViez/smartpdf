/**
 * Build text runs from the operator list alone.
 *
 * `getTextContent()` is convenient but it is a second, higher-level pass that
 * can fail on documents the operator list handles fine. Since the operator list
 * already carries unicode, originalCharCode and glyph widths, we can reconstruct
 * runs ourselves by walking the PDF text state machine — which means a
 * getTextContent failure degrades to a slightly less polished model instead of
 * a dead screen.
 *
 * All output is in PDF user-space units, same as the primary path.
 */

/** m1 × m2, PDF 6-element matrix convention. */
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
const translate = (x, y) => [1, 0, 0, 1, x, y];

/**
 * pdf.js is inconsistent about how matrices reach the operator list:
 * `transform` spreads six numbers across args, while `setTextMatrix` passes a
 * single Float32Array as args[0]. Accept either rather than assuming one.
 */
function matrixFrom(args) {
  if (!args) return null;
  if (typeof args[0] === 'number' && args.length >= 6) {
    return [args[0], args[1], args[2], args[3], args[4], args[5]];
  }
  const m = args[0];
  if (m && typeof m !== 'number' && m.length >= 6) {
    return [m[0], m[1], m[2], m[3], m[4], m[5]];
  }
  return null;
}
const num = (args, i, dflt = 0) => {
  const v = Array.isArray(args) || args ? args[i] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
};

export function buildRunsFromOperatorList(opList, OPS, pageIndex) {
  const runs = [];
  if (!opList?.fnArray) return runs;

  let ctm = IDENTITY.slice();
  const ctmStack = [];

  // text state
  let tm = IDENTITY.slice();      // text matrix
  let tlm = IDENTITY.slice();     // text line matrix
  let fontKey = null;
  let fontSize = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
  let leading = 0;
  let rise = 0;
  let renderMode = 0;

  const fn = opList.fnArray;
  const args = opList.argsArray;

  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i];

    switch (op) {
      case OPS.save: ctmStack.push(ctm.slice()); break;
      case OPS.restore: ctm = ctmStack.pop() || IDENTITY.slice(); break;
      case OPS.transform: { const m = matrixFrom(a); if (m) ctm = mul(m, ctm); break; }

      case OPS.beginText: tm = IDENTITY.slice(); tlm = IDENTITY.slice(); break;
      case OPS.endText: break;

      case OPS.setFont: fontKey = a?.[0] ?? fontKey; fontSize = num(a, 1, fontSize); break;
      case OPS.setTextMatrix: { const m = matrixFrom(a); if (m) { tm = m; tlm = m.slice(); } break; }
      case OPS.setCharSpacing: charSpacing = num(a, 0, 0); break;
      case OPS.setWordSpacing: wordSpacing = num(a, 0, 0); break;
      case OPS.setHScale: hScale = num(a, 0, 100) / 100; break;
      case OPS.setLeading: leading = num(a, 0, 0); break;
      case OPS.setTextRise: rise = num(a, 0, 0); break;
      case OPS.setTextRenderingMode: renderMode = num(a, 0, 0); break;

      case OPS.setLeadingMoveText:
        leading = -num(a, 1, 0);
        tlm = mul(translate(num(a, 0, 0), num(a, 1, 0)), tlm); tm = tlm.slice();
        break;
      case OPS.moveText:
        tlm = mul(translate(num(a, 0, 0), num(a, 1, 0)), tlm); tm = tlm.slice();
        break;
      case OPS.nextLine:
        tlm = mul(translate(0, -leading), tlm); tm = tlm.slice();
        break;

      case OPS.nextLineShowText:
        tlm = mul(translate(0, -leading), tlm); tm = tlm.slice();
        // falls through to show
        emit(a?.[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        wordSpacing = num(a, 0, wordSpacing);
        charSpacing = num(a, 1, charSpacing);
        tlm = mul(translate(0, -leading), tlm); tm = tlm.slice();
        emit(a?.[2]);
        break;

      case OPS.showText:
      case OPS.showSpacedText:
        emit(a?.[0]);
        break;

      default: break;
    }
  }

  return runs;

  function emit(glyphs) {
    if (!Array.isArray(glyphs) || !glyphs.length) return;
    // Render mode 3 (and 7) is invisible text — the OCR layer of scanned PDFs.
    // Keep it: it is exactly the text a user wants to correct.
    const startTm = tm.slice();
    let text = '';
    const codes = [];

    for (const g of glyphs) {
      if (typeof g === 'number') {
        // TJ kerning adjustment, in thousandths of text space
        tm = mul(translate((-g / 1000) * fontSize * hScale, 0), tm);
        continue;
      }
      if (!g || typeof g !== 'object') continue;
      if (g.unicode !== undefined) text += g.unicode;
      if (g.originalCharCode !== undefined) codes.push([g.originalCharCode, g.unicode]);

      const w = (g.width ?? 0) / 1000;
      const spacing = charSpacing + (g.isSpace ? wordSpacing : 0);
      tm = mul(translate((w * fontSize + spacing) * hScale, 0), tm);
    }

    if (!text.length) return;

    const param = [fontSize * hScale, 0, 0, fontSize, 0, rise];
    const startTrm = mul(mul(param, startTm), ctm);
    const endTrm = mul(mul(param, tm), ctm);

    const size = Math.hypot(startTrm[2], startTrm[3]) || Math.abs(fontSize) || 12;
    const x = startTrm[4];
    const baseline = startTrm[5];
    const w = Math.hypot(endTrm[4] - startTrm[4], endTrm[5] - startTrm[5]);

    if (![x, baseline, w, size].every(Number.isFinite) || size <= 0) return;

    runs.push({
      x, baseline, w, size, text, codes, fontKey,
      invisible: renderMode === 3 || renderMode === 7,
    });
  }
}
