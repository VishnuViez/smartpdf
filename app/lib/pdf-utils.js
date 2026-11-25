import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";

/**
 * Every function that REWRITES a document must refuse an encrypted one.
 * pdf-lib's `ignoreEncryption` does not decrypt — it proceeds with ciphertext,
 * so rewriting produces a corrupt file while reporting success.
 */
async function guard(arrayBuffer) {
  const { assertNotEncrypted } = await import("./pdf/security/detect.js");
  await assertNotEncrypted(arrayBuffer);
  return arrayBuffer;
}

/**
 * Merge multiple PDF files into one
 * @param {File[]} files - Array of PDF File objects
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<{blob: Blob, pageCount: number, size: number}>}
 */
export async function mergePDFs(files, onProgress = () => {}) {
  const mergedPdf = await PDFDocument.create();
  let totalPages = 0;

  for (let i = 0; i < files.length; i++) {
    const arrayBuffer = await files[i].arrayBuffer();
  await guard(arrayBuffer);
    const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
    totalPages += pages.length;
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }

  const pdfBytes = await mergedPdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: totalPages,
    size: pdfBytes.byteLength,
  };
}

/**
 * Split a PDF by page ranges
 * @param {File} file - PDF File object
 * @param {string} rangeStr - e.g. "1-3, 5, 7-10" or "all" for each page separately
 * @returns {Promise<{blobs: {blob: Blob, name: string}[], totalPages: number}>}
 */
export async function splitPDF(file, rangeStr = "all") {
  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const srcPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const totalPages = srcPdf.getPageCount();
  const results = [];

  if (rangeStr === "all") {
    // Split into individual pages
    for (let i = 0; i < totalPages; i++) {
      const newPdf = await PDFDocument.create();
      const [page] = await newPdf.copyPages(srcPdf, [i]);
      newPdf.addPage(page);
      const pdfBytes = await newPdf.save();
      results.push({
        blob: new Blob([pdfBytes], { type: "application/pdf" }),
        name: `${file.name.replace(".pdf", "")}_page_${i + 1}.pdf`,
      });
    }
  } else {
    // Parse ranges like "1-3, 5, 7-10"
    const ranges = parseRanges(rangeStr, totalPages);
    for (let idx = 0; idx < ranges.length; idx++) {
      const range = ranges[idx];
      const newPdf = await PDFDocument.create();
      const pages = await newPdf.copyPages(srcPdf, range);
      pages.forEach((page) => newPdf.addPage(page));
      const pdfBytes = await newPdf.save();
      results.push({
        blob: new Blob([pdfBytes], { type: "application/pdf" }),
        name: `${file.name.replace(".pdf", "")}_part_${idx + 1}.pdf`,
      });
    }
  }

  return { blobs: results, totalPages };
}

/**
 * Compress a PDF by reducing image quality and optimizing
 * @param {File} file - PDF File object
 * @returns {Promise<{blob: Blob, originalSize: number, compressedSize: number, pageCount: number}>}
 */
export async function compressPDF(file, options = {}) {
  const { compressPdf, createBrowserImageCodec } = await import("./pdf/optimize/compress.js");
  const arrayBuffer = await file.arrayBuffer();

  const probe = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pageCount = probe.getPageCount();

  const result = await compressPdf(arrayBuffer, {
    preset: options.preset || "balanced",
    recompressImage: options.recompressImage ?? createBrowserImageCodec(),
    onProgress: options.onProgress,
  });

  return {
    blob: new Blob([result.bytes], { type: "application/pdf" }),
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    saved: result.saved,
    ratio: result.ratio,
    unchanged: result.unchanged,
    stats: result.stats,
    pageCount,
  };
}

/**
 * Convert images to a single PDF
 * @param {File[]} imageFiles - Array of image File objects
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{blob: Blob, pageCount: number, size: number}>}
 */
export async function imagesToPDF(imageFiles, onProgress = () => {}) {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const arrayBuffer = await file.arrayBuffer();
    let image;

    if (file.type === "image/png") {
      image = await pdf.embedPng(arrayBuffer);
    } else if (file.type === "image/jpeg" || file.type === "image/jpg") {
      image = await pdf.embedJpg(arrayBuffer);
    } else {
      // Convert other formats to PNG via canvas
      const bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const pngBlob = await canvas.convertToBlob({ type: "image/png" });
      const pngBuffer = await pngBlob.arrayBuffer();
      image = await pdf.embedPng(pngBuffer);
    }

    const dims = image.scale(1);
    const page = pdf.addPage([dims.width, dims.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: dims.width,
      height: dims.height,
    });

    onProgress(Math.round(((i + 1) / imageFiles.length) * 100));
  }

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: imageFiles.length,
    size: pdfBytes.byteLength,
  };
}

/**
 * Rotate pages in a PDF.
 *
 * @param {File} file
 * @param {number|Record<number, number>} angle
 *        A single angle applied to `pageIndices`, or a map of pageIndex -> angle
 *        so different pages can be turned different ways in one pass.
 * @param {number[]|null} pageIndices  which pages (null = all). Ignored when
 *        `angle` is a per-page map.
 * @returns {Promise<{blob: Blob, pageCount: number, rotated: number}>}
 */
export async function rotatePDF(file, angle = 90, pageIndices = null) {
  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pages = pdf.getPages();

  const perPage = typeof angle === "object" && angle !== null;
  const targets = perPage
    ? Object.keys(angle).map(Number)
    : (pageIndices || pages.map((_, i) => i));

  let rotated = 0;
  for (const idx of targets) {
    if (!(idx >= 0 && idx < pages.length)) continue;
    const delta = perPage ? Number(angle[idx]) || 0 : angle;
    if (!delta) continue;
    const page = pages[idx];
    const current = page.getRotation().angle;
    // PDF only stores multiples of 90, normalised to 0-359
    page.setRotation(degrees((((current + delta) % 360) + 360) % 360));
    rotated++;
  }

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pages.length,
    rotated,
  };
}

/**
 * Add page numbers to a PDF
 * @param {File} file - PDF File object
 * @param {object} options - { position, format, fontSize, startPage, color }
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function addPageNumbers(file, options = {}) {
  const {
    position = "bottom-center",
    format = "1",
    fontSize = 12,
    startPage = 0,
    color = { r: 0.4, g: 0.4, b: 0.4 },
  } = options;

  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const totalPages = pages.length;

  for (let i = startPage; i < totalPages; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const pageNum = i + 1;

    let text;
    switch (format) {
      case "Page N": text = `Page ${pageNum}`; break;
      case "N of M": text = `${pageNum} of ${totalPages}`; break;
      case "- N -": text = `- ${pageNum} -`; break;
      default: text = `${pageNum}`;
    }

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    let x, y;
    const margin = 40;

    switch (position) {
      case "bottom-left": x = margin; y = margin; break;
      case "bottom-right": x = width - textWidth - margin; y = margin; break;
      case "top-center": x = (width - textWidth) / 2; y = height - margin; break;
      default: x = (width - textWidth) / 2; y = margin; break;
    }

    page.drawText(text, {
      x, y, size: fontSize, font,
      color: rgb(color.r, color.g, color.b),
    });
  }

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: totalPages,
  };
}

/**
 * Add text watermark to a PDF
 * @param {File} file - PDF File object
 * @param {string} text - Watermark text
 * @param {object} options - { opacity, fontSize, rotation, color }
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function addWatermark(file, text, options = {}) {
  const {
    opacity = 0.15,
    fontSize = 60,
    rotation = 45,
    color = { r: 0.5, g: 0.5, b: 0.5 },
  } = options;

  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    page.drawText(text, {
      x: (width - textWidth * Math.cos((rotation * Math.PI) / 180)) / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity,
      rotate: degrees(rotation),
    });
  }

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pages.length,
  };
}

/**
 * Remove password protection from a PDF the user can open.
 *
 * This replaces an implementation that passed a `password` option to
 * pdf-lib's loader — an option pdf-lib does not have — so unlocking silently
 * did nothing. See app/lib/pdf/security/unlock.js.
 *
 * @param {File} file
 * @param {string} password
 * @returns {Promise<{blob: Blob, pageCount: number, wasEncrypted: boolean, revision: number, cipher: string}>}
 */
export async function unlockPDF(file, password) {
  const { unlockPdf } = await import("./pdf/security/unlock.js");
  const arrayBuffer = await file.arrayBuffer();
  const result = await unlockPdf(arrayBuffer, password);

  const doc = await PDFDocument.load(result.bytes, { ignoreEncryption: true });
  return {
    blob: new Blob([result.bytes], { type: "application/pdf" }),
    pageCount: doc.getPageCount(),
    wasEncrypted: result.wasEncrypted,
    revision: result.revision,
    cipher: result.cipher,
  };
}

/**
 * Encrypt a PDF with a password (AES-256, ISO 32000-2 revision 6).
 *
 * This replaces an earlier implementation that wrote the password in PLAIN TEXT
 * into an /Encrypt dictionary with no cipher applied — the resulting file
 * opened in any reader. See app/lib/pdf/security/.
 *
 * @param {File} file
 * @param {string} password
 * @param {object} [options] { ownerPassword, allow: { print, copy, modify, ... } }
 * @returns {Promise<{blob: Blob, pageCount: number, permissions: number}>}
 */
export async function protectPDF(file, password, options = {}) {
  const { protectPdf } = await import("./pdf/security/protect.js");
  const arrayBuffer = await file.arrayBuffer();

  // page count is read before encryption, since afterwards it needs the password
  const probe = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pageCount = probe.getPageCount();

  const { bytes, permissions } = await protectPdf(arrayBuffer, {
    userPassword: password,
    ownerPassword: options.ownerPassword,
    allow: options.allow || {},
  });

  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    pageCount,
    permissions,
  };
}

/**
 * Reorganize PDF pages
 * @param {File} file - PDF File object
 * @param {number[]} pageOrder - New page order (0-indexed)
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function organizePDF(file, pageOrder) {
  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const srcPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();

  const pages = await newPdf.copyPages(srcPdf, pageOrder);
  pages.forEach((page) => newPdf.addPage(page));

  const pdfBytes = await newPdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pages.length,
  };
}

/**
 * Embed a signature image into a PDF
 * @param {File} file - PDF File object
 * @param {Uint8Array} signatureImageBytes - PNG image bytes of signature
 * @param {object} position - { x, y, width, height, pageIndex }
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function embedSignature(file, signatureImageBytes, position) {
  const { x, y, width, height, pageIndex = 0 } = position;
  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

  const sigImage = await pdf.embedPng(signatureImageBytes);
  const page = pdf.getPages()[pageIndex];

  page.drawImage(sigImage, { x, y, width, height });

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pdf.getPageCount(),
  };
}

/**
 * Add text annotation to a PDF page
 * @param {File} file - PDF File object
 * @param {Array} annotations - [{text, x, y, fontSize, color, pageIndex}]
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function editPDF(file, annotations) {
  const arrayBuffer = await file.arrayBuffer();
  await guard(arrayBuffer);
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex || 0];
    if (!page) continue;

    if (ann.type === "text") {
      page.drawText(ann.text || "", {
        x: ann.x || 0,
        y: ann.y || 0,
        size: ann.fontSize || 14,
        font,
        color: rgb(ann.color?.r ?? 0, ann.color?.g ?? 0, ann.color?.b ?? 0),
      });
    } else if (ann.type === "rectangle") {
      const drawOpts = {
        x: ann.x || 0,
        y: ann.y || 0,
        width: ann.width || 100,
        height: ann.height || 50,
      };

      if (ann.fill) {
        // Filled rectangle (used as white cover for text replacement)
        drawOpts.color = rgb(ann.color?.r ?? 1, ann.color?.g ?? 1, ann.color?.b ?? 1);
        drawOpts.borderWidth = 0;
      } else {
        // Border-only rectangle
        drawOpts.borderColor = rgb(ann.color?.r ?? 0, ann.color?.g ?? 0, ann.color?.b ?? 0);
        drawOpts.borderWidth = ann.borderWidth || 2;
      }

      page.drawRectangle(drawOpts);
    }
  }

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pages.length,
  };
}

// ===== Helper Functions =====

function parseRanges(rangeStr, totalPages) {
  const groups = rangeStr.split(",").map((s) => s.trim());
  const ranges = [];

  for (const group of groups) {
    if (group.includes("-")) {
      const [start, end] = group.split("-").map(Number);
      const indices = [];
      for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
        indices.push(i - 1); // 0-indexed
      }
      if (indices.length > 0) ranges.push(indices);
    } else {
      const page = parseInt(group);
      if (page >= 1 && page <= totalPages) {
        ranges.push([page - 1]);
      }
    }
  }

  return ranges;
}

/**
 * Format file size to human readable string
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + sizes[i];
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
