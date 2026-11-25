/**
 * Decides which font the EDITOR should draw edited text with.
 *
 * This must make the identical call to the exporter. If the preview shows the
 * document's embedded face while the export writes a standard substitute, the
 * widths differ by roughly 8% and the text lands somewhere else in the file —
 * which defeats the point of an editor.
 *
 * Kept in a plain module rather than inside the canvas component so it can be
 * tested directly; component files carry JSX and the test runner has no
 * transform for it.
 */
import { standardSubstitute } from './fonts.js';
import { encodeText } from '../rewrite/encode.js';

/**
 * @param {string} text        the replacement text
 * @param {object} fontRecord  the run's FontRecord
 * @param {number} sizePx      on-screen size
 * @returns {{css:string, substituted:boolean, missing?:string[]}}
 */
export function resolvePreviewFont(text, fontRecord, sizePx) {
  if (!fontRecord) {
    return { css: `${sizePx}px Helvetica, Arial, sans-serif`, substituted: true, missing: [] };
  }

  const enc = encodeText(text, fontRecord.unicodeToChar, { isSubset: !!fontRecord.isSubset });
  if (enc.ok) {
    return {
      css: `${fontRecord.italic ? 'italic ' : ''}${fontRecord.weight} ${sizePx}px ${fontRecord.stack()}`,
      substituted: false,
      missing: [],
    };
  }

  const sub = standardSubstitute(fontRecord);
  return {
    css: `${sub.italic ? 'italic ' : ''}${sub.weight} ${sizePx}px ${sub.css}`,
    substituted: true,
    missing: [...new Set(enc.missing)],
  };
}
