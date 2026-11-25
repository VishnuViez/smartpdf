import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const FIXTURES = path.join(ROOT, '.claude', 'fixtures');

export function fixtureNames() {
  if (!fs.existsSync(FIXTURES)) {
    throw new Error('Fixtures missing. Run: npm run test:fixtures');
  }
  return fs.readdirSync(FIXTURES).filter(f => f.endsWith('.pdf')).sort();
}
export const fixtureBytes = name => fs.readFileSync(path.join(FIXTURES, name));

/**
 * Optional extra corpus of real-world PDFs, for coverage fixtures can't provide
 * (embedded subset fonts, exotic producers). Never committed, never required.
 *   SMARTPDF_CORPUS=/path/to/pdfs npm test
 */
export function corpusFiles() {
  const dir = process.env.SMARTPDF_CORPUS;
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).sort()
    .map(f => ({ name: f, bytes: fs.readFileSync(path.join(dir, f)) }));
}

export async function loadPdfjs() {
  return import(path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
}

export async function openDoc(lib, bytes) {
  return lib.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: path.join(ROOT, 'public/pdfjs/cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(ROOT, 'public/pdfjs/standard_fonts') + path.sep,
  }).promise;
}

/** Decoded content streams for one page, via pdf-lib. */
export async function contentStreams(bytes) {
  const { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = [];
  for (const page of doc.getPages()) {
    const c = page.node.Contents();
    if (!c) continue;
    const ctx = page.node.context;
    const push = o => { if (o instanceof PDFRawStream) out.push(Buffer.from(decodePDFRawStream(o).decode())); };
    if (c instanceof PDFArray) for (let i = 0; i < c.size(); i++) push(ctx.lookup(c.get(i)));
    else push(c instanceof PDFRawStream ? c : ctx.lookup(c));
  }
  return out;
}

export const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${label} after ${ms}ms`)), ms))]);
