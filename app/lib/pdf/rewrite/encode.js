/**
 * Encoding replacement text back into a PDF content stream.
 *
 * We do NOT embed a new font. The page already carries the font that drew the
 * original text, so the replacement is written using that same resource — which
 * means the typography is not "matched", it is literally the same font.
 *
 * The cost is that we can only write characters the font can encode. That is
 * the subset problem: a document that never used a "Q" may have no glyph for
 * one. Callers get told exactly which characters failed so they can decide.
 */

/** Escape a byte string for a PDF literal `( ... )`. */
export function escapeLiteral(bytes) {
  const out = [];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c, b);   // ( ) \
    else if (b === 0x0a) out.push(0x5c, 0x6e);                        // \n
    else if (b === 0x0d) out.push(0x5c, 0x72);                        // \r
    else if (b === 0x09) out.push(0x5c, 0x74);                        // \t
    else if (b < 32 || b > 126) {
      const oct = b.toString(8).padStart(3, '0');
      out.push(0x5c, oct.charCodeAt(0), oct.charCodeAt(1), oct.charCodeAt(2));
    } else out.push(b);
  }
  return out;
}

const hex = n => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * Encode text for a specific font.
 *
 * IMPORTANT distinction, easy to get wrong: the map harvested from a page tells
 * us which characters that page HAPPENED to draw — it is an observation, not a
 * statement of what the font can render. Treating it as coverage means editing
 * "Times body text" into "REPLACED" reports R, E, P, L, A, C and D as
 * impossible, which is nonsense for a full Helvetica.
 *
 * What actually limits us is whether the font is an embedded SUBSET. A subset
 * carries only the glyphs the document used, so anything else really is
 * undrawable (this is the `SURGER▯` case). A non-subset font uses a standard
 * encoding and can draw the Latin-1 range.
 *
 * Note that identity encoding does NOT imply coverage: subset fonts commonly
 * map 'M' to 77 as well. The subset flag is the discriminator, not the mapping.
 *
 * @param {string} text
 * @param {Map<string,number>} unicodeToChar   observed mappings (authoritative when present)
 * @param {object} [opts]
 * @param {boolean} [opts.isSubset]  true when the font is an embedded subset
 * @returns {{ok:boolean, operand:string, missing:string[], wide:boolean}}
 */
export function encodeText(text, unicodeToChar, { isSubset = false } = {}) {
  const chars = [...String(text ?? '')];
  const missing = [];
  const codes = [];

  for (const ch of chars) {
    let code = unicodeToChar?.get(ch);
    if (code === undefined && !isSubset && ch.charCodeAt(0) < 256) {
      code = ch.charCodeAt(0);          // standard encoding covers Latin-1
    }
    if (code === undefined) { missing.push(ch); continue; }
    codes.push(code);
  }

  const wide = codes.some(c => c > 255);
  if (wide) {
    return {
      ok: missing.length === 0,
      operand: '<' + codes.map(c => hex((c >> 8) & 0xff) + hex(c & 0xff)).join('') + '>',
      missing, wide: true,
    };
  }
  const escaped = escapeLiteral(codes);
  return {
    ok: missing.length === 0,
    operand: '(' + String.fromCharCode(...escaped) + ')',
    missing, wide: false,
  };
}

const fmt = n => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
};

/**
 * Content-stream operators that draw one run of replacement text.
 * Absolute positioning via Tm, so it does not depend on preceding state.
 */
export function drawTextOps({
  operand, fontResource, fontSize, x, y, color,
  charSpacing = 0, hScale = 1,
}) {
  const { r = 0, g = 0, b = 0 } = color || {};
  const tz = Number.isFinite(hScale) && Math.abs(hScale - 1) > 1e-6;
  return [
    'q',
    'BT',
    `${fontResource} ${fmt(fontSize)} Tf`,
    `${fmt(r)} ${fmt(g)} ${fmt(b)} rg`,
    // Tc and Tz are how PDF expresses tracking and condensing natively, so a
    // fitted run stays a single text object rather than being faked with
    // per-glyph positioning.
    charSpacing ? `${fmt(charSpacing)} Tc` : null,
    tz ? `${fmt(hScale * 100)} Tz` : null,
    `1 0 0 1 ${fmt(x)} ${fmt(y)} Tm`,
    `${operand} Tj`,
    'ET',
    'Q',
  ].filter(Boolean).join('\n');
}

/** Hide the original glyphs without disturbing anything else. */
export function hideOps(originalSpanText, previousRenderMode = 0) {
  return `3 Tr ${originalSpanText} ${fmt(previousRenderMode)} Tr`;
}
