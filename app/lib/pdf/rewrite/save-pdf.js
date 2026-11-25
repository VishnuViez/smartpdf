/**
 * Writes model edits back into a real PDF.
 *
 * Strategy, unchanged from the spike that proved it: rewrite only the token
 * spans that changed, pass every other byte through untouched. Original glyphs
 * are hidden rather than deleted so text advances survive, and replacement text
 * is drawn with the PAGE'S OWN font resource — not a substitute we embed — so
 * the typography is identical rather than merely similar.
 */

import {
  PDFDocument, PDFArray, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, StandardFonts,
} from 'pdf-lib';
import { indexShowOps, rewriteContent, showOpsInRect } from './content-editor.js';
import { standardSubstitute } from '../model/fonts.js';
import { resolveTextPlacement, originalRect } from '../model/placement.js';
import { availableWidth, fitText } from '../model/fitting.js';
import { encodeText, drawTextOps } from './encode.js';

const hexToRgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const v = parseInt(m[1], 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
};

/**
 * A standard-14 stand-in for a font that cannot draw what the user typed.
 *
 * An embedded subset carries only the glyphs its document used, so typing a "Q"
 * into text that never contained one leaves nothing to draw. Previously that
 * silently dropped the character — "REPLACED" came out as "EE" — which looks
 * exactly like text going missing or landing in the wrong place.
 *
 * The substitute is chosen from the original's own descriptor flags so the
 * result stays close: serif stays serif, monospace stays monospace, weight and
 * slope are carried across.
 */
const substituteFontFor = fontRecord => StandardFonts[standardSubstitute(fontRecord).std];

/** Embed a substitute once per document and register it on the page. */
async function fallbackResource(doc, page, fontRecord, cache) {
  const std = substituteFontFor(fontRecord);
  if (!cache.fonts.has(std)) cache.fonts.set(std, await doc.embedFont(std));
  const font = cache.fonts.get(std);

  const key = `${page.ref.tag}:${std}`;
  if (!cache.resources.has(key)) {
    const name = page.node.newFontDictionary(`SPDF-${std}`, font.ref);
    cache.resources.set(key, name.toString());
  }
  return { font, resource: cache.resources.get(key) };
}

function contentStreamsOf(page) {
  const ctx = page.node.context;
  const c = page.node.Contents();
  const out = [];
  if (!c) return out;
  if (c instanceof PDFArray) {
    for (let i = 0; i < c.size(); i++) {
      const o = ctx.lookup(c.get(i));
      if (o instanceof PDFRawStream) out.push(o);
    }
  } else {
    const o = c instanceof PDFRawStream ? c : ctx.lookup(c);
    if (o instanceof PDFRawStream) out.push(o);
  }
  return out;
}

/**
 * @param {ArrayBuffer|Uint8Array} originalBytes
 * @param {Array} pages  [{ pageIndex, model, edits: Map, fieldValues: Map }]
 * @returns {Promise<{bytes:Uint8Array, warnings:Array, changed:number}>}
 */
export async function savePdf(originalBytes, pages) {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const warnings = [];
  const cache = { fonts: new Map(), resources: new Map() };
  let changed = 0;

  for (const spec of pages) {
    const { pageIndex, model } = spec;
    const edits = spec.edits instanceof Map ? spec.edits : new Map();
    const fieldValues = spec.fieldValues instanceof Map ? spec.fieldValues : new Map();
    if (!edits.size && !fieldValues.size) continue;

    const page = doc.getPages()[pageIndex];
    if (!page) continue;

    const streams = contentStreamsOf(page);
    if (!streams.length) { warnings.push({ pageIndex, reason: 'page has no content stream' }); continue; }

    // If a content stream cannot be decoded we do NOT know what the page
    // contains. Rewriting it would replace the original with only our additions
    // — silently destroying the document. Refuse the page instead.
    let decoded;
    try {
      decoded = streams.map(st => Buffer.from(decodePDFRawStream(st).decode()));
    } catch (err) {
      warnings.push({
        pageIndex, kind: 'unreadable',
        reason: `page ${pageIndex + 1} uses a content stream this build cannot decode (${err?.message || err}); it was left unchanged rather than risk losing it`,
      });
      continue;
    }
    if (decoded.some(b => !b || b.length === 0)) {
      warnings.push({
        pageIndex, kind: 'unreadable',
        reason: `page ${pageIndex + 1} has an empty or unreadable content stream; it was left unchanged`,
      });
      continue;
    }
    const buf = Buffer.concat(decoded.flatMap((b, i) => (i ? [Buffer.from('\n'), b] : [b])));
    const ops = indexShowOps(buf);

    const hide = new Set();
    const append = [];

    // ---- edited text ----
    for (const [id, edit] of edits) {
      const element = (model.segments || []).find(s => s.id === id)
                   || (model.runs || []).find(r => r.id === id);
      if (!element) continue;

      // Locate the original glyphs geometrically at their ORIGINAL rect.
      const covered = showOpsInRect(ops, originalRect(element));

      // Identical placement to the editor preview — one function, both sides.
      const place = resolveTextPlacement(element, edit);
      const text = place.text;
      if (!text) {
        // Explicit deletion: hiding with nothing drawn is the intent.
        for (const o of covered) hide.add(o.index);
        changed++;
        continue;
      }

      const fontRecord = model.fonts?.get(edit.fontKey ?? element.fontKey);
      const enc = encodeText(text, fontRecord?.unicodeToChar, { isSubset: !!fontRecord?.isSubset });

      let operand = enc.operand;
      let resource = covered[0]?.fontResource;

      // Never write partial text. If the page's own font cannot draw every
      // character, substitute a metric-matched standard font for the whole run.
      if (!enc.ok || !resource) {
        const fb = await fallbackResource(doc, page, fontRecord, cache);
        try {
          operand = fb.font.encodeText(text).toString();
          resource = fb.resource;
          warnings.push({
            pageIndex, id, kind: 'substituted',
            reason: enc.ok
              ? 'the original font resource could not be located; a standard font was used'
              : `the document's font cannot draw ${[...new Set(enc.missing)].join(' ')} — substituted a matching standard font`,
            missing: [...new Set(enc.missing)],
          });
        } catch (err) {
          // Even the substitute cannot represent this text (CJK in a Latin
          // standard font, say). Leave the ORIGINAL alone rather than hiding
          // text we cannot replace — a wrong glyph is bad, a blank is worse.
          warnings.push({
            pageIndex, id, kind: 'skipped',
            reason: `cannot write this text with any available font (${err?.message || err}); the original was left unchanged`,
            missing: [...new Set(enc.missing)],
          });
          continue;
        }
      }
      if (!operand || operand === '()' || operand === '<>') {
        warnings.push({ pageIndex, id, kind: 'skipped',
          reason: 'nothing could be encoded for this text; the original was left unchanged' });
        continue;
      }

      // Text dragged outside the page would silently disappear on export.
      const { width: pw, height: ph } = page.getSize();
      if (place.x < -place.fontSize || place.x > pw + place.fontSize ||
          place.baseline < -place.fontSize || place.baseline > ph + place.fontSize) {
        warnings.push({ pageIndex, id, kind: 'offpage',
          reason: `this element sits outside the page (${place.x.toFixed(0)}, ${place.baseline.toFixed(0)}) and would not be visible` });
      }

      // Only now that a replacement is guaranteed may the original be hidden.
      for (const o of covered) hide.add(o.index);


      // Fit the new text into the space it actually has, rather than letting it
      // run through whatever sits beside it.
      const room = availableWidth({ ...element, x: place.x, baseline: place.baseline }, model);
      const fit = fitText({ text, fontRecord, fontSize: place.fontSize, available: room });
      if (!fit.fits) {
        warnings.push({
          pageIndex, id, kind: 'overflow',
          reason: `this text is ${fit.overflow.toFixed(1)}pt wider than the space available and will overlap what follows`,
        });
      }

      append.push(drawTextOps({
        operand,
        fontResource: resource,
        fontSize: fit.fontSize,
        x: place.x,
        y: place.baseline,
        color: hexToRgb(place.colorHex),
        charSpacing: fit.charSpacing,
        hScale: fit.hScale,
      }));
      changed++;
    }

    // ---- form field values ----
    for (const [id, value] of fieldValues) {
      if (!value) continue;
      const field = (model.fields || []).find(f => f.id === id);
      if (!field) continue;

      const near = showOpsInRect(ops, {
        x: field.rect.x - 60, y: field.rect.y - 4, w: field.rect.w + 120, h: field.rect.h + 8,
      });
      const resource = near[0]?.fontResource || ops[0]?.fontResource;
      if (!resource) { warnings.push({ pageIndex, id, reason: 'no font resource available for this field' }); continue; }

      const fontRecord = [...(model.fonts?.values() || [])][0];
      const enc = encodeText(value, fontRecord?.unicodeToChar, { isSubset: !!fontRecord?.isSubset });

      let fieldOperand = enc.operand;
      let fieldResource = resource;
      let fallbackFont = null;
      if (!enc.ok || !fieldResource) {
        const fb = await fallbackResource(doc, page, fontRecord, cache);
        try {
          fieldOperand = fb.font.encodeText(value).toString();
          fieldResource = fb.resource;
          fallbackFont = fb.font;
          warnings.push({ pageIndex, id, kind: 'substituted',
            reason: 'field text used a substituted standard font' });
        } catch (err) {
          warnings.push({ pageIndex, id, kind: 'skipped',
            reason: `cannot write this field value with any available font (${err?.message || err})` });
          continue;
        }
      }
      if (!fieldOperand || fieldOperand === '()' || fieldOperand === '<>') continue;

      if (field.comb && field.cells?.length) {
        // one character per cell, centred
        const chars = [...value].slice(0, field.cells.length);
        chars.forEach((ch, i) => {
          const one = encodeText(ch, fontRecord?.unicodeToChar, { isSubset: !!fontRecord?.isSubset });
          const oneOperand = (!one.ok && fallbackFont) ? fallbackFont.encodeText(ch).toString() : one.operand;
          if (!oneOperand || oneOperand === '()') return;
          const advance = fallbackFont
            ? fallbackFont.widthOfTextAtSize(ch, field.fontSize)
            : field.fontSize * 0.5;
          append.push(drawTextOps({
            operand: oneOperand, fontResource: fieldResource, fontSize: field.fontSize,
            x: field.cells[i].centerX - advance / 2, y: field.baseline, color: { r: 0, g: 0, b: 0 },
          }));
        });
      } else {
        append.push(drawTextOps({
          operand: fieldOperand, fontResource: fieldResource, fontSize: field.fontSize,
          x: field.content.x, y: field.baseline, color: { r: 0, g: 0, b: 0 },
        }));
      }
      changed++;
    }

    if (!hide.size && !append.length) continue;

    const out = rewriteContent(buf, { hide, append });

    // Write back as ONE uncompressed stream; drop filters so Length stays honest.
    const first = streams[0];
    first.dict.delete(PDFName.of('Filter'));
    first.dict.delete(PDFName.of('DecodeParms'));
    first.dict.set(PDFName.of('Length'), PDFNumber.of(out.length));
    first.contents = new Uint8Array(out);

    if (streams.length > 1) {
      // Everything now lives in the first stream; blank the rest.
      for (const s of streams.slice(1)) {
        s.dict.delete(PDFName.of('Filter'));
        s.dict.delete(PDFName.of('DecodeParms'));
        s.dict.set(PDFName.of('Length'), PDFNumber.of(0));
        s.contents = new Uint8Array(0);
      }
    }
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, warnings, changed };
}
