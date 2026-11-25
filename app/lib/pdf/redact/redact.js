/**
 * Redaction that actually removes content.
 *
 * The common implementation — in free tools and some paid ones — draws a black
 * rectangle over the text and saves. The glyphs are still in the file: select
 * the area in any reader, copy, and the "redacted" text is on the clipboard.
 * People have leaked names, addresses and case details exactly this way.
 *
 * Here the text operators inside the region are ERASED from the content stream
 * before anything is drawn over them, images that overlap are removed, and the
 * document's own metadata is stripped. The black box is cosmetic: by the time
 * it is drawn there is nothing underneath it to find.
 *
 * What this does NOT claim: vector artwork crossing the region is covered by
 * the box rather than cut out of the content stream, because splitting
 * arbitrary paths at a boundary would change the drawing in ways the user did
 * not ask for. A line or shape under a box therefore still exists in the file,
 * though its geometry carries no text. Images and text do not have this
 * caveat: both are removed outright.
 *
 * GRANULARITY. The smallest thing a content stream can erase is one show
 * operator, which is usually a whole line or word, never half of one. Two
 * consequences follow, and both are handled here rather than left to surprise
 * the user:
 *
 *   - Selection must test a run's EXTENT, not its origin. A line beginning
 *     outside the box and passing through it is still exposed. Matching on the
 *     origin (which is what the editor wants, and what `showOpsInRect` does)
 *     draws a box over text that survives in the file — the exact failure this
 *     module exists to prevent.
 *   - Because a partly-covered run is erased whole, the painted box is widened
 *     to the union of everything erased. Otherwise text vanishes with nothing
 *     over it, and the page silently loses content the user never selected.
 *     `report.boxesWidened` counts how often that happened.
 */

import {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict,
  decodePDFRawStream,
} from 'pdf-lib';
import { indexShowOps, rewriteContent, endCTM, invertMatrix } from '../rewrite/content-editor.js';
import { assertNotEncrypted } from '../security/detect.js';

/** Box growth below this many points is box-model slack, not lost content. */
const WIDENED_PT = 2;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const fmt = n => {
  const r = Math.round(num(n) * 1000) / 1000;
  return String(r);
};

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
 * Number of glyphs a show operator paints, read straight from its operand.
 * Literal strings count bytes (minus escapes), hex strings count byte pairs,
 * and the numeric kerns inside a TJ array are skipped.
 */
function glyphCount(operand) {
  let n = 0, i = 0;
  while (i < operand.length) {
    const ch = operand[i];
    if (ch === '(') {
      let depth = 1; i++;
      while (i < operand.length && depth > 0) {
        if (operand[i] === '\\') { i += 2; n++; continue; }
        if (operand[i] === '(') depth++;
        else if (operand[i] === ')') { depth--; i++; continue; }
        if (depth > 0) n++;
        i++;
      }
    } else if (ch === '<') {
      let hex = 0; i++;
      while (i < operand.length && operand[i] !== '>') {
        if (/[0-9a-fA-F]/.test(operand[i])) hex++;
        i++;
      }
      i++;
      n += Math.ceil(hex / 2);
    } else {
      i++;
    }
  }
  return n;
}

/**
 * The box a show operator paints, in page space.
 *
 * `run` is pdf.js geometry for the same operator when the caller supplied it;
 * that is exact. Without it the width is over-estimated at one em per glyph —
 * wider than any real text — so that a run crossing the region is caught. The
 * cost is erasing more than was selected, which is visible; the alternative is
 * leaving text under a black box, which is not.
 */
function opBox(op, buf, run) {
  const size = op.size || op.fontSize || 0;
  if (run) {
    // pdf.js geometry is authoritative and already allows for the descender.
    // Padding it further made every exact search hit look as though the box
    // had been widened to swallow neighbouring text, which hid the cases
    // where that genuinely happened.
    return {
      x: run.x,
      y: Number.isFinite(run.y) ? run.y : run.baseline - (run.h || size) * 0.2,
      w: run.w || 1,
      h: run.h || size || 1,
    };
  }
  const operand = buf.toString('latin1', op.start, op.end);
  const w = glyphCount(operand) * (size || 1);
  return { x: op.x, y: op.baseline - size * 0.25, w: Math.max(w, 1), h: size * 1.25 || 1 };
}

/** Pair each show operator with the pdf.js run drawn at the same origin. */
function matchRuns(ops, runs) {
  const byOp = new Map();
  if (!runs?.length) return byOp;
  const used = new Set();
  for (const op of ops) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < runs.length; i++) {
      if (used.has(i)) continue;
      const r = runs[i];
      const d = Math.abs(r.x - op.x) + Math.abs(r.baseline - op.baseline);
      if (d < bestD) { bestD = d; best = i; }
    }
    // A run and its operator share an origin exactly; anything further apart
    // is a different piece of text and must not borrow its width.
    if (best >= 0 && bestD < 0.75) { byOp.set(op.index, runs[best]); used.add(best); }
  }
  return byOp;
}

const unionRect = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

const intersects = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Operators that paint an opaque rectangle over a region, in page space. */
function coverOps(rect, colour, invCtm) {
  const { r = 0, g = 0, b = 0 } = colour || {};
  const lines = ['q'];
  if (invCtm) lines.push(`${invCtm.map(fmt).join(' ')} cm`);
  lines.push(
    `${fmt(r)} ${fmt(g)} ${fmt(b)} rg`,
    `${fmt(rect.x)} ${fmt(rect.y)} ${fmt(rect.w)} ${fmt(rect.h)} re`,
    'f',
    'Q',
  );
  return lines.join('\n');
}

/**
 * Remove every XObject draw whose placement overlaps a redaction region.
 * An image is positioned by the CTM in force at its `Do`, so the walk tracks
 * the transform rather than guessing from the image's own dimensions.
 */
function eraseOverlappingXObjects(buf, regions, OPS_UNUSED) {
  // Minimal, self-contained scan: track q/Q and cm, and blank out `/Name Do`
  // when the unit square it maps to overlaps a region.
  const text = buf.toString('latin1');
  const out = [];
  let cursor = 0;
  let removed = 0;

  const mul = (m1, m2) => [
    m1[0]*m2[0] + m1[1]*m2[2], m1[0]*m2[1] + m1[1]*m2[3],
    m1[2]*m2[0] + m1[3]*m2[2], m1[2]*m2[1] + m1[3]*m2[3],
    m1[4]*m2[0] + m1[5]*m2[2] + m2[4], m1[4]*m2[1] + m1[5]*m2[3] + m2[5],
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];

  // tokens we care about, in order
  const re = /(\bq\b)|(\bQ\b)|((?:-?[\d.]+\s+){6}cm\b)|(\/[^\s/<>\[\]()]+\s+Do\b)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) { stack.push(ctm.slice()); continue; }
    if (m[2]) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (m[3]) {
      const n = m[3].trim().split(/\s+/).slice(0, 6).map(Number);
      if (n.every(Number.isFinite)) ctm = mul(n, ctm);
      continue;
    }
    if (m[4]) {
      // the unit square mapped through the CTM is where the XObject lands
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ({
        x: ctm[0] * x + ctm[2] * y + ctm[4],
        y: ctm[1] * x + ctm[3] * y + ctm[5],
      }));
      const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
      const box = {
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      };
      if (regions.some(rg => intersects(box, rg))) {
        out.push(buf.subarray(cursor, m.index));
        cursor = m.index + m[4].length;
        removed++;
      }
    }
  }
  out.push(buf.subarray(cursor));
  return { buf: Buffer.concat(out), removed };
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {Array<{pageIndex:number, x:number, y:number, w:number, h:number}>} regions
 *        Rectangles in PDF user space, y measured from the bottom.
 * @param {object} [opts]
 * @param {{r:number,g:number,b:number}} [opts.colour]  box colour, default black
 * @param {boolean} [opts.stripMetadata]  also clear document info and XMP
 * @param {(pageIndex:number)=>Promise<Array<{x,baseline,w,h,fontSize}>>} [opts.pageRuns]
 *   Real glyph geometry for a page, normally from pdf.js via `loadPageModel`.
 *   Without it the extent of each run is over-estimated so that nothing is
 *   ever missed, at the cost of erasing more than was selected; the report
 *   carries an `estimated-extents` warning when that fallback is used.
 * @returns {Promise<{bytes, report}>}
 */
export async function redactPdf(bytes, regions, opts = {}) {
  const colour = opts.colour || { r: 0, g: 0, b: 0 };
  const stripMetadata = opts.stripMetadata !== false;

  await assertNotEncrypted(bytes);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  const byPage = new Map();
  for (const r of regions || []) {
    if (!Number.isFinite(r?.pageIndex)) continue;
    if (!(r.w > 0 && r.h > 0)) continue;
    if (!byPage.has(r.pageIndex)) byPage.set(r.pageIndex, []);
    byPage.get(r.pageIndex).push({ x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) });
  }

  const report = {
    regions: regions?.length || 0,
    pages: 0,
    textOpsErased: 0,
    imagesRemoved: 0,
    boxesWidened: 0,
    metadataStripped: false,
    warnings: [],
  };

  for (const [pageIndex, rects] of byPage) {
    const page = doc.getPages()[pageIndex];
    if (!page) { report.warnings.push({ pageIndex, reason: 'no such page' }); continue; }

    const streams = contentStreamsOf(page);
    if (!streams.length) { report.warnings.push({ pageIndex, reason: 'page has no content stream' }); continue; }

    let decoded;
    try {
      decoded = streams.map(st => Buffer.from(decodePDFRawStream(st).decode()));
    } catch (err) {
      // Never half-redact. If the content cannot be read it cannot be proven
      // clean, so the page is refused rather than covered with a box that
      // hides nothing.
      report.warnings.push({
        pageIndex, kind: 'unreadable',
        reason: `content stream could not be decoded (${err?.message || err}); this page was NOT redacted`,
      });
      continue;
    }
    let buf = Buffer.concat(decoded.flatMap((b, i) => (i ? [Buffer.from('\n'), b] : [b])));

    // 1. erase the text
    //
    // Selection is by OVERLAP of the run's painted extent. Testing the origin
    // instead — which is what the editor wants from `showOpsInRect` — misses
    // every line that starts to the left of the box and runs through it, and
    // a missed line is one sitting intact underneath a black rectangle.
    const ops = indexShowOps(buf);
    let runs = null;
    if (typeof opts.pageRuns === 'function') {
      try {
        runs = await opts.pageRuns(pageIndex);
      } catch (err) {
        report.warnings.push({
          pageIndex, kind: 'estimated-extents',
          reason: `glyph geometry unavailable (${err?.message || err}); run widths were over-estimated, so more text may have been erased than was selected`,
        });
      }
    }
    if (!runs) {
      report.warnings.push({
        pageIndex, kind: 'estimated-extents',
        reason: 'run widths were over-estimated because no glyph geometry was supplied; more text may have been erased than was selected',
      });
    }
    const runFor = matchRuns(ops, runs);

    const erase = new Set();
    // Each rectangle grows to cover everything it caused to be erased, so the
    // page never loses text without showing a box where it was.
    const painted = rects.map(rect => {
      let box = { ...rect };
      for (const op of ops) {
        if (!Number.isFinite(op.x) || !Number.isFinite(op.baseline)) continue;
        const ob = opBox(op, buf, runFor.get(op.index));
        if (!intersects(ob, rect)) continue;
        erase.add(op.index);
        box = unionRect(box, ob);
      }
      // Only growth the reader would notice counts. An operator's box is
      // reckoned a fraction of a point taller than the glyph box a search
      // returns, so a tolerance of nothing reported every exact hit as
      // "widened" and made the warning meaningless.
      if (box.w > rect.w + WIDENED_PT || box.h > rect.h + WIDENED_PT) report.boxesWidened++;
      return box;
    });
    report.textOpsErased += erase.size;

    // 2. remove overlapping images
    const imgPass = eraseOverlappingXObjects(buf, rects);
    const imagesRemoved = imgPass.removed;
    report.imagesRemoved += imagesRemoved;
    if (imagesRemoved) buf = imgPass.buf;

    // 3. paint the boxes, in page space regardless of any leftover transform
    const ctm = endCTM(buf);
    const identity = ctm.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-9);
    const inv = identity ? null : invertMatrix(ctm);
    const append = painted.map(rect => coverOps(rect, colour, inv));

    const out = rewriteContent(buf, { erase, append });

    const first = streams[0];
    first.dict.delete(PDFName.of('Filter'));
    first.dict.delete(PDFName.of('DecodeParms'));
    first.dict.set(PDFName.of('Length'), PDFNumber.of(out.length));
    first.contents = new Uint8Array(out);
    for (const st of streams.slice(1)) {
      st.dict.delete(PDFName.of('Filter'));
      st.dict.delete(PDFName.of('DecodeParms'));
      st.dict.set(PDFName.of('Length'), PDFNumber.of(0));
      st.contents = new Uint8Array(0);
    }

    // 4. annotations sitting over the region would survive the content rewrite
    try {
      const annots = page.node.context.lookup(page.node.get(PDFName.of('Annots')));
      if (annots instanceof PDFArray) {
        for (let i = annots.size() - 1; i >= 0; i--) {
          const a = page.node.context.lookup(annots.get(i));
          if (!(a instanceof PDFDict)) continue;
          const r = a.get(PDFName.of('Rect'));
          const vals = r instanceof PDFArray ? r.asArray().map(v => v?.asNumber?.() ?? NaN) : [];
          if (vals.length !== 4 || vals.some(v => !Number.isFinite(v))) continue;
          const box = {
            x: Math.min(vals[0], vals[2]), y: Math.min(vals[1], vals[3]),
            w: Math.abs(vals[2] - vals[0]), h: Math.abs(vals[3] - vals[1]),
          };
          if (rects.some(rg => intersects(box, rg))) annots.remove(i);
        }
      }
    } catch { /* no annotations to prune */ }

    report.pages++;
  }

  // 5. metadata can carry the very text that was just removed
  if (stripMetadata) {
    try {
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
      doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
      const cat = doc.catalog;
      cat.delete(PDFName.of('Metadata'));
      report.metadataStripped = true;
    } catch (err) {
      report.warnings.push({ reason: `metadata could not be cleared: ${err?.message || err}` });
    }
  }

  const outBytes = await doc.save({ useObjectStreams: false });
  return { bytes: outBytes, report };
}
