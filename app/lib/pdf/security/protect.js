/**
 * Real password protection for a PDF: AES-256, ISO 32000-2 revision 6.
 *
 * Every string and every stream in the document is encrypted with the file
 * encryption key, which is itself only recoverable from the password. A reader
 * without the password cannot render the page content at all — which is what
 * users assume "protect" already meant.
 */

import {
  PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFRawStream,
  PDFDict, PDFArray, PDFRef, PDFBool, PDFNull,
} from 'pdf-lib';
import { buildEncryptionValues, encryptObjectData, randomBytes } from './crypto.js';

/** /P permission bits (PDF 32000-1 table 22). Bit 1 is the lowest. */
export const PERMISSIONS = {
  print: 1 << 2,
  modify: 1 << 3,
  copy: 1 << 4,
  annotate: 1 << 5,
  fillForms: 1 << 8,
  extractForAccessibility: 1 << 9,
  assemble: 1 << 10,
  printHighQuality: 1 << 11,
};

const ALL_PERMISSIONS =
  PERMISSIONS.print | PERMISSIONS.modify | PERMISSIONS.copy | PERMISSIONS.annotate |
  PERMISSIONS.fillForms | PERMISSIONS.extractForAccessibility |
  PERMISSIONS.assemble | PERMISSIONS.printHighQuality;

/** Bits 7-8 and 13-32 are reserved and must be 1. */
const RESERVED = ~0 ^ 0xfff;
const buildP = allow => (
  (RESERVED | 0xc0 | (allow & ALL_PERMISSIONS)) | 0
);

const bytesOfString = s => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
const stringOfBytes = b => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {object} opts
 * @param {string} opts.userPassword    required to open the document
 * @param {string} [opts.ownerPassword] grants full permissions; defaults to the user password
 * @param {object} [opts.allow]         permission flags to grant, e.g. { print: true, copy: false }
 * @returns {Promise<{bytes: Uint8Array, permissions: number}>}
 */
export async function protectPdf(bytes, { userPassword, ownerPassword, allow = {} } = {}) {
  if (!userPassword || !String(userPassword).length) {
    throw new Error('A password is required to protect a document');
  }

  // updateMetadata:false stops pdf-lib rewriting /Producer and /ModDate, which
  // it otherwise does around save time — leaving those two strings in plain
  // text inside an otherwise encrypted document.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;

  let granted = 0;
  for (const [name, bit] of Object.entries(PERMISSIONS)) {
    // default to granting unless explicitly denied
    if (allow[name] !== false) granted |= bit;
  }
  const P = buildP(granted);

  const { fileKey, U, UE, O, OE, Perms } = await buildEncryptionValues(
    userPassword, ownerPassword, P
  );

  // The /Encrypt dictionary itself is never encrypted, so build it last and
  // keep a reference so the walk below can skip it.
  const encryptDict = ctx.obj({
    Filter: PDFName.of('Standard'),
    V: PDFNumber.of(5),
    R: PDFNumber.of(6),
    Length: PDFNumber.of(256),
    CF: ctx.obj({
      StdCF: ctx.obj({
        CFM: PDFName.of('AESV3'),
        AuthEvent: PDFName.of('DocOpen'),
        Length: PDFNumber.of(32),
      }),
    }),
    StmF: PDFName.of('StdCF'),
    StrF: PDFName.of('StdCF'),
    U: PDFHexString.of(toHex(U)),
    UE: PDFHexString.of(toHex(UE)),
    O: PDFHexString.of(toHex(O)),
    OE: PDFHexString.of(toHex(OE)),
    Perms: PDFHexString.of(toHex(Perms)),
    P: PDFNumber.of(P),
    EncryptMetadata: PDFBool.True,
  });
  const encryptRef = ctx.register(encryptDict);

  // Encrypt every string and stream reachable in the document.
  const seen = new Set();
  const pending = [];

  const visit = (obj, insideEncryptDict) => {
    if (!obj || insideEncryptDict) return obj;
    if (obj instanceof PDFRef || obj instanceof PDFName ||
        obj instanceof PDFNumber || obj instanceof PDFBool || obj === PDFNull) {
      return obj;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const replaced = visit(obj.get(i), false);
        if (replaced && replaced !== obj.get(i)) obj.set(i, replaced);
      }
      return obj;
    }
    if (obj instanceof PDFRawStream) {
      pending.push({ kind: 'stream', obj });
      visit(obj.dict, false);
      return obj;
    }
    if (obj instanceof PDFDict) {
      if (seen.has(obj)) return obj;
      seen.add(obj);
      for (const [key, value] of obj.entries()) {
        const replaced = visit(value, false);
        if (replaced && replaced !== value) obj.set(key, replaced);
      }
      return obj;
    }
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      const holder = { kind: 'string', obj, replacement: null };
      pending.push(holder);
      return obj;
    }
    return obj;
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encryptRef) continue;
    visit(obj, false);
  }

  // Strings are replaced in place, so collect their owners as we re-walk.
  await encryptPending(pending, fileKey, ctx, encryptRef);

  ctx.trailerInfo.Encrypt = encryptRef;
  // An /ID is required alongside /Encrypt.
  if (!ctx.trailerInfo.ID) {
    const id = PDFHexString.of(toHex(randomBytes(16)));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }

  // Object streams would hide strings from the walk above; keep objects plain.
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, permissions: P };
}

async function encryptPending(pending, fileKey, ctx, encryptRef) {
  for (const item of pending) {
    if (item.kind === 'stream') {
      const raw = item.obj.contents;
      if (!raw || !raw.length) continue;
      const enc = await encryptObjectData(fileKey, raw);
      item.obj.contents = enc;
      item.obj.dict.set(PDFName.of('Length'), PDFNumber.of(enc.length));
    }
  }
  // Strings: walk again now that we can replace them by key.
  const replaceStrings = async (obj, seen) => {
    if (!obj || seen.has(obj)) return;
    if (obj instanceof PDFArray) {
      seen.add(obj);
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        if (v instanceof PDFString || v instanceof PDFHexString) {
          obj.set(i, await encryptedString(v, fileKey));
        } else await replaceStrings(v, seen);
      }
      return;
    }
    if (obj instanceof PDFRawStream) { await replaceStrings(obj.dict, seen); return; }
    if (obj instanceof PDFDict) {
      seen.add(obj);
      for (const [key, v] of obj.entries()) {
        if (v instanceof PDFString || v instanceof PDFHexString) {
          obj.set(key, await encryptedString(v, fileKey));
        } else await replaceStrings(v, seen);
      }
    }
  };
  const seen = new Set();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encryptRef) continue;
    await replaceStrings(obj, seen);
  }
}

async function encryptedString(strObj, fileKey) {
  const plain = strObj instanceof PDFHexString
    ? bytesOfString(strObj.decodeText ? strObj.asString() : strObj.value)
    : bytesOfString(strObj.value ?? '');
  const enc = await encryptObjectData(fileKey, plain);
  return PDFHexString.of(toHex(enc));
}

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  return s;
}

export { stringOfBytes };
