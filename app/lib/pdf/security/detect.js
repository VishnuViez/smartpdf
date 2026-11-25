/**
 * Detect encryption before any tool tries to modify a document.
 *
 * pdf-lib loads encrypted files with `ignoreEncryption: true`, which does not
 * decrypt anything — it merely proceeds with ciphertext in every stream. Any
 * tool that then rewrites those streams produces a corrupt file while reporting
 * success. The document must be unlocked first.
 */

import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

export class EncryptedDocumentError extends Error {
  constructor(detail = {}) {
    super('This PDF is password-protected. Unlock it first, then try again.');
    this.name = 'EncryptedDocumentError';
    Object.assign(this, detail);
  }
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {Promise<{encrypted:boolean, revision:number|null, version:number|null}>}
 */
export async function inspectEncryption(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return { encrypted: false, revision: null, version: null };
  }
  const ref = doc.context.trailerInfo?.Encrypt;
  if (!ref) return { encrypted: false, revision: null, version: null };

  const dict = ref instanceof PDFDict ? ref : doc.context.lookup(ref);
  if (!(dict instanceof PDFDict)) return { encrypted: false, revision: null, version: null };

  return {
    encrypted: true,
    revision: dict.get(PDFName.of('R'))?.asNumber?.() ?? null,
    version: dict.get(PDFName.of('V'))?.asNumber?.() ?? null,
  };
}

/** Throw a clear, actionable error if the document is encrypted. */
export async function assertNotEncrypted(bytes) {
  const info = await inspectEncryption(bytes);
  if (info.encrypted) throw new EncryptedDocumentError(info);
  return info;
}
