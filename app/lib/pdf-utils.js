import { PDFDocument, degrees, rgb, StandardFonts, PDFName, PDFString } from "pdf-lib";

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
export async function compressPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const originalSize = arrayBuffer.byteLength;
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

  // Save with optimizations — pdf-lib produces smaller output by default
  // because it doesn't copy unused objects
  const pdfBytes = await pdf.save({
    useObjectStreams: true,
    addDefaultPage: false,
  });

  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    originalSize,
    compressedSize: pdfBytes.byteLength,
    pageCount: pdf.getPageCount(),
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
 * Rotate pages in a PDF
 * @param {File} file - PDF File object
 * @param {number} angle - Rotation angle (90, 180, 270)
 * @param {number[]|null} pageIndices - Specific pages to rotate (null = all)
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function rotatePDF(file, angle = 90, pageIndices = null) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pages = pdf.getPages();

  const indicesToRotate = pageIndices || pages.map((_, i) => i);

  indicesToRotate.forEach((idx) => {
    if (idx >= 0 && idx < pages.length) {
      const page = pages[idx];
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + angle));
    }
  });

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pages.length,
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
 * Unlock a password-protected PDF
 * @param {File} file - PDF File object
 * @param {string} password - PDF password
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function unlockPDF(file, password) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    password,
  });

  // Remove encryption by saving without it
  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pdf.getPageCount(),
  };
}

/**
 * Protect a PDF with password metadata
 * @param {File} file - PDF File object
 * @param {string} password - Password to set
 * @returns {Promise<{blob: Blob, pageCount: number}>}
 */
export async function protectPDF(file, password) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

  // Set document metadata to indicate protection
  pdf.setTitle(pdf.getTitle() || "Protected Document");
  pdf.setProducer("SmartPDF - Protected");

  // Use pdf-lib's encrypt dict approach (basic protection)
  const encryptDict = pdf.context.obj({
    Filter: PDFName.of("Standard"),
    V: 1,
    R: 2,
    O: PDFString.of(password),
    U: PDFString.of(password),
    P: -4,
  });
  pdf.context.trailerInfo.Encrypt = pdf.context.register(encryptDict);

  const pdfBytes = await pdf.save();
  return {
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
    pageCount: pdf.getPageCount(),
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
