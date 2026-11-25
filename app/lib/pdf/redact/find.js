/**
 * Finding every occurrence of a phrase, so none is left behind.
 *
 * Box-dragging alone is how redaction fails in practice. Someone blacks out a
 * name on page one, ships the file, and the same name is still sitting in a
 * footer on page nine. The boxes that were drawn are perfect and the document
 * still leaks. A search across the whole document is not a convenience here —
 * it is the difference between redacting a page and redacting a document.
 *
 * Matching is done on a segment's words rather than on raw pdf.js runs,
 * because runs are frequently split mid-word ("Raghu" + "nathan") and a naive
 * scan of them misses the very names it was asked to find.
 */

const norm = (s, caseSensitive) => (caseSensitive ? s : s.toLowerCase());

/**
 * Words of a segment, each with the character offset at which it starts in the
 * joined text. Joining with single spaces makes offsets predictable; the
 * original spacing is irrelevant to a phrase search.
 */
function indexWords(segment) {
  const words = segment.words?.length
    ? segment.words
    : [{ text: segment.text, x: segment.x, y: segment.y, w: segment.w, h: segment.h }];
  let joined = '';
  const placed = [];
  for (const w of words) {
    if (!w?.text) continue;
    if (joined) joined += ' ';
    placed.push({ ...w, from: joined.length, to: joined.length + w.text.length });
    joined += w.text;
  }
  return { joined, placed };
}

const unionOf = (boxes) => {
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  return {
    x, y,
    w: Math.max(...boxes.map(b => b.x + b.w)) - x,
    h: Math.max(...boxes.map(b => b.y + b.h)) - y,
  };
};

/**
 * Every occurrence of `query` among a page's segments.
 *
 * A word that the match only partly covers is returned whole. That is not
 * sloppiness: a show operator cannot be erased by halves, so selecting less
 * than a whole word would promise a precision the file format cannot deliver.
 *
 * @returns {Array<{pageIndex, x, y, w, h, text}>} rectangles in PDF user space
 */
export function findInSegments(segments, query, { caseSensitive = false, wholeWord = false } = {}) {
  const q = norm(String(query || ''), caseSensitive);
  if (!q.trim()) return [];

  const hits = [];
  for (const seg of segments || []) {
    const { joined, placed } = indexWords(seg);
    if (!joined) continue;
    const hay = norm(joined, caseSensitive);

    let at = 0;
    for (;;) {
      const i = hay.indexOf(q, at);
      if (i < 0) break;
      const end = i + q.length;
      at = i + Math.max(1, q.length);

      if (wholeWord) {
        const before = i === 0 ? ' ' : hay[i - 1];
        const after = end >= hay.length ? ' ' : hay[end];
        if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
      }

      const covered = placed.filter(w => w.from < end && w.to > i);
      if (!covered.length) continue;
      hits.push({
        pageIndex: seg.pageIndex,
        ...unionOf(covered),
        text: joined.slice(i, end),
      });
    }
  }
  return hits;
}

/** True when two rectangles describe the same area, within a point. */
export const sameRegion = (a, b) =>
  a.pageIndex === b.pageIndex &&
  Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 &&
  Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
