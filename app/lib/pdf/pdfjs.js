/**
 * The single place pdf.js is loaded.
 *
 * Six tools previously fetched the worker from unpkg.com at runtime. That broke
 * the app offline, made a third party a hard dependency of opening a local
 * file, and contradicted the promise on the home page that documents never
 * leave the user's device. Bundling it is not an optimisation — it is the
 * difference between the privacy claim being true and being marketing.
 *
 * Everything that touches pdf.js goes through here so it cannot drift again.
 */

let cached = null;

export async function loadPdfjs() {
  if (cached) return cached;
  const pdfjsLib = await import('pdfjs-dist');
  // Bundled by the build, not fetched from a CDN.
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  cached = pdfjsLib;
  return pdfjsLib;
}

/** Character maps and standard fonts, served from /public by scripts/sync-pdfjs-assets.mjs */
export const PDFJS_ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
};

/**
 * Open a document with the asset paths every tool needs.
 * Without cMapUrl, CJK documents render as blanks; without standardFontDataUrl,
 * documents relying on the standard 14 fonts lose their text.
 */
export async function openDocument(data, extra = {}) {
  const pdfjsLib = await loadPdfjs();
  return pdfjsLib.getDocument({ data, ...PDFJS_ASSETS, ...extra }).promise;
}
