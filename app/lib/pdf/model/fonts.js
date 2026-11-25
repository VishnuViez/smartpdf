/**
 * Font identity.
 *
 * A PDF never embeds "Arial" — it embeds `ABCDEF+ArialMT`, a SUBSET containing
 * only the glyphs that document happens to use. Recovering usable identity from
 * that means three separate jobs:
 *
 *   1. strip the subset prefix and parse family / weight / style from the name
 *   2. read the descriptor Flags bitfield for serif / script / fixed-pitch truth
 *   3. know which glyphs the subset actually HAS, so we can tell when a typed
 *      character needs a metric-matched substitute
 *
 * Coverage is never measured with canvas measureText — the browser silently
 * falls back per character, so measuring reports success for glyphs the font
 * does not contain. Coverage comes from the font's cmap or the PDF encoding.
 */

/** `ABCDEF+ArialMT` -> `ArialMT`. Subset prefixes are exactly 6 uppercase letters + '+'. */
export function stripSubsetPrefix(baseFont) {
  if (!baseFont) return '';
  const n = String(baseFont).replace(/^\//, '');
  return /^[A-Z]{6}\+/.test(n) ? n.slice(7) : n;
}

export function isSubsetName(baseFont) {
  return /^\/?[A-Z]{6}\+/.test(String(baseFont || ''));
}

// Longest-first so "ExtraBold" wins over "Bold", "SemiBold" over "Bold".
const WEIGHTS = [
  ['extrablack', 950], ['ultrablack', 950],
  ['extrabold', 800], ['ultrabold', 800],
  ['semibold', 600], ['demibold', 600], ['demi', 600],
  ['extralight', 200], ['ultralight', 200],
  ['black', 900], ['heavy', 900],
  ['bold', 700],
  ['medium', 500],
  ['light', 300],
  ['thin', 100],
  ['book', 400], ['regular', 400], ['normal', 400], ['roman', 400],
];

const ITALIC = ['italic', 'oblique', 'it'];

// Foundry noise that is not part of the family name.
const NOISE = /\b(mt|ps|lt|osf|sc|com|ce|we|cyr|greek)\b/gi;

/**
 * Parse a PostScript font name into family / weight / style.
 * Handles `Gotham-Book`, `HelveticaNeue-BoldItalic`, `TimesNewRomanPS-ItalicMT`,
 * `Arial-BoldMT`, `HiraKakuPro-W6`, and bare `CenturyGothic`.
 */
export function parseFontName(rawName) {
  const name = stripSubsetPrefix(rawName);
  if (!name) return { family: 'Helvetica', weight: 400, italic: false, raw: '' };

  // Split at the LAST hyphen: family on the left, style descriptor on the right.
  const dash = name.lastIndexOf('-');
  let familyPart = dash > 0 ? name.slice(0, dash) : name;
  let stylePart = dash > 0 ? name.slice(dash + 1) : '';

  // Weight/italic can also be glued onto the family with no separator.
  const probe = (stylePart || name).toLowerCase();

  let weight = null;
  for (const [token, w] of WEIGHTS) {
    if (probe.includes(token)) { weight = w; break; }
  }
  // Japanese/CJK weight convention: W0..W9
  const wNum = probe.match(/\bw([0-9])\b/) || probe.match(/^w([0-9])$/);
  if (weight === null && wNum) weight = Math.min(900, Math.max(100, Number(wNum[1]) * 100));

  const italic = ITALIC.some(t => probe.includes(t));

  // If the style part was purely descriptive, it isn't part of the family.
  // If the name had no hyphen, strip a trailing glued descriptor instead.
  if (!dash) {
    familyPart = name
      .replace(/(extrablack|ultrablack|extrabold|ultrabold|semibold|demibold|extralight|ultralight|black|heavy|bold|medium|light|thin|book|regular|normal|italic|oblique)+$/i, '')
      || name;
  }

  // Order matters: split camelCase FIRST, so \b in NOISE can actually match
  // the glued foundry suffixes (ArialMT, TimesNewRomanPS).
  const family = familyPart
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // SFProText   -> SF ProText
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')     // ProText     -> Pro Text
    .replace(NOISE, '')                         // Arial MT    -> Arial
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Helvetica';

  return { family, weight: weight ?? 400, italic, raw: name };
}

/** PDF font descriptor /Flags bitfield (PDF 32000-1 table 123). Bits are 1-indexed. */
export function parseDescriptorFlags(flags) {
  const f = Number(flags) || 0;
  const bit = n => !!(f & (1 << (n - 1)));
  return {
    fixedPitch: bit(1),
    serif: bit(2),
    symbolic: bit(3),
    script: bit(4),
    nonSymbolic: bit(6),
    italic: bit(7),
    allCap: bit(17),
    smallCap: bit(18),
    forceBold: bit(19),
  };
}

/**
 * Bundled metric-compatible substitutes, used when the embedded subset lacks a
 * glyph the user typed. Deliberately open/system families — nothing fetched
 * from a third party, per the standalone rule.
 */
const SUBSTITUTES = [
  { match: /^(helvetica|arial|liberation sans|nimbus sans|freesans)/i, css: 'Helvetica, Arial, "Liberation Sans", sans-serif' },
  { match: /^(times|times new roman|liberation serif|nimbus roman)/i,  css: '"Times New Roman", Times, "Liberation Serif", serif' },
  { match: /^(courier|liberation mono|nimbus mono)/i,                  css: '"Courier New", Courier, "Liberation Mono", monospace' },
  { match: /^(georgia)/i,      css: 'Georgia, serif' },
  { match: /^(garamond)/i,     css: 'Garamond, Georgia, serif' },
  { match: /^(cambria)/i,      css: 'Cambria, Georgia, serif' },
  { match: /^(calibri)/i,      css: 'Calibri, Carlito, sans-serif' },
  { match: /^(verdana|dejavu sans)/i, css: 'Verdana, "DejaVu Sans", sans-serif' },
  { match: /^(tahoma)/i,       css: 'Tahoma, Verdana, sans-serif' },
  { match: /^(gotham|montserrat|proxima)/i, css: 'Montserrat, "Helvetica Neue", Helvetica, sans-serif' },
  { match: /^(century gothic|futura)/i, css: '"Century Gothic", Futura, "Trebuchet MS", sans-serif' },
  { match: /^(sf pro|sf ?pro ?text|-apple-system)/i, css: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' },
  { match: /^(hira|noto sans (jp|cjk)|yu gothic|ms gothic)/i, css: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif' },
];

/** Best CSS font stack for a parsed family, falling back on descriptor flags. */
export function substituteStack(family, flags = {}) {
  for (const s of SUBSTITUTES) if (s.match.test(family)) return s.css;
  if (flags.fixedPitch) return '"Courier New", Courier, monospace';
  if (flags.script)     return 'cursive';
  if (flags.serif)      return 'Georgia, "Times New Roman", serif';
  return 'Helvetica, Arial, sans-serif';
}

/**
 * A FontRecord is the model's complete answer to "what font is this, and can it
 * render what the user just typed".
 *
 * @param {object} o
 * @param {string} o.key          pdf.js loadedName, e.g. "g_d0_f3"
 * @param {string} o.baseFont     raw /BaseFont, e.g. "ZOYKBO+Gotham-Light"
 * @param {number} [o.flags]      descriptor /Flags
 * @param {number} [o.italicAngle]
 * @param {Set<number>} [o.coverage]  char codes the embedded program can render
 * @param {Map<number,string>} [o.toUnicode] charCode -> unicode
 */
export function createFontRecord({ key, baseFont, flags, italicAngle, ascent, descent, coverage, toUnicode, widths }) {
  const parsed = parseFontName(baseFont);
  const flagBits = parseDescriptorFlags(flags);

  // Descriptor flags and the italic angle outrank a name that forgot to say so.
  const italic = parsed.italic || flagBits.italic || (Number(italicAngle) || 0) !== 0;
  const weight = flagBits.forceBold && parsed.weight < 700 ? 700 : parsed.weight;

  const charToUnicode = toUnicode instanceof Map ? toUnicode : new Map();
  const unicodeToChar = new Map();
  for (const [code, u] of charToUnicode) if (!unicodeToChar.has(u)) unicodeToChar.set(u, code);

  return {
    key,
    baseFont: String(baseFont || ''),
    family: parsed.family,
    weight,
    italic,
    isSubset: isSubsetName(baseFont),
    flags: flagBits,
    ascent: Number(ascent) || null,
    descent: Number(descent) || null,

    /** The embedded face pdf.js registered — exact on-screen fidelity. */
    embeddedCss: key ? `"${key}"` : null,
    /** Metric-matched fallback for glyphs the subset lacks. */
    substituteCss: substituteStack(parsed.family, flagBits),

    coverage: coverage instanceof Set ? coverage : null,
    charToUnicode,
    unicodeToChar,

    /**
     * Real glyph advances (fractions of em) observed in the document.
     * These are the ACTUAL metrics of the embedded font, which is what lets us
     * predict whether edited text will still fit its space.
     */
    widths: widths instanceof Map ? widths : new Map(),

    /** Can the ORIGINAL embedded program draw this character? */
    canRender(ch) {
      if (!this.coverage) return null;             // unknown, not "no"
      const code = this.unicodeToChar.get(ch);
      return code === undefined ? false : this.coverage.has(code);
    },

    /** Font stack: genuine embedded face first, metric-matched substitute behind it. */
    stack({ forceSubstitute = false } = {}) {
      return forceSubstitute || !this.embeddedCss
        ? this.substituteCss
        : `${this.embeddedCss}, ${this.substituteCss}`;
    },

    /** CSS font shorthand. Do NOT combine with a separate lineHeight — the
     *  shorthand resets line-height, and React warns about the conflict. */
    cssFont(sizePx, opts = {}) {
      return `${this.italic ? 'italic ' : ''}${this.weight} ${sizePx}px ${this.stack(opts)}`;
    },

    /** Longhand properties, safe to combine with lineHeight. */
    cssFontParts(sizePx, opts = {}) {
      return {
        fontFamily: this.stack(opts),
        fontSize: `${sizePx}px`,
        fontWeight: this.weight,
        fontStyle: this.italic ? 'italic' : 'normal',
      };
    },

    /** Human-readable label for the inspector panel. */
    label() {
      const parts = [this.family];
      const wname = { 100:'Thin',200:'ExtraLight',300:'Light',400:'',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold',900:'Black',950:'ExtraBlack' }[this.weight];
      if (wname) parts.push(wname);
      if (this.italic) parts.push('Italic');
      return parts.join(' ');
    },
  };
}

/**
 * The standard-14 stand-in used when a font cannot draw what was typed.
 *
 * Returned as BOTH a pdf-lib StandardFonts key and a CSS family so the editor
 * preview and the exported file agree. If the preview shows the document's
 * embedded face while the export writes Helvetica, what you see is not what you
 * get — the widths differ by roughly 8% and the text lands somewhere else.
 */
export function standardSubstitute(fontRecord) {
  const bold = (fontRecord?.weight ?? 400) >= 600;
  const italic = !!fontRecord?.italic;
  const flags = fontRecord?.flags || {};

  if (flags.fixedPitch) {
    return {
      std: bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold' : italic ? 'CourierOblique' : 'Courier',
      css: '"Courier New", Courier, monospace',
      weight: bold ? 700 : 400, italic,
    };
  }
  if (flags.serif) {
    return {
      std: bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold' : italic ? 'TimesRomanItalic' : 'TimesRoman',
      css: '"Times New Roman", Times, "Liberation Serif", serif',
      weight: bold ? 700 : 400, italic,
    };
  }
  return {
    std: bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold' : italic ? 'HelveticaOblique' : 'Helvetica',
    css: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    weight: bold ? 700 : 400, italic,
  };
}
