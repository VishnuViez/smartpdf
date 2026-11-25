/**
 * Remove password protection from a PDF the user can already open.
 *
 * The previous implementation passed a `password` option to pdf-lib's loader,
 * which ignores it entirely — so unlocking silently produced a file that was
 * still encrypted, or failed outright. pdf-lib has no decryption support at all.
 *
 * Both generations of the standard security handler are supported, because the
 * overwhelming majority of encrypted PDFs in circulation are the older kind:
 *
 *   revisions 2-4  RC4 or AES-128, key derived with MD5 (legacy-crypto.js)
 *   revisions 5-6  AES-256, key derived with SHA-2       (crypto.js)
 *
 * A wrong password is reported as such rather than producing a damaged file.
 */

import {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, PDFArray,
  PDFString, PDFHexString, PDFRef,
} from 'pdf-lib';
import { hash2B, preparePassword, aesCbcNoPadDecrypt, aesCbcDecrypt } from './crypto.js';
import { computeLegacyKey, computeU, objectKey, rc4 } from './legacy-crypto.js';

export class WrongPasswordError extends Error {
  constructor(message = 'That password does not open this document') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}
export class UnsupportedEncryptionError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedEncryptionError'; }
}

const bytesOf = (obj) => {
  if (obj instanceof PDFHexString) {
    const hex = obj.toString().replace(/[<>]/g, '');
    const out = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  if (obj instanceof PDFString) {
    const s = obj.asString ? obj.asString() : String(obj.value ?? '');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array(0);
};

const same = (a, b, n) => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Read the /Encrypt dictionary without needing the document to be decryptable. */
function readEncryptionInfo(ctx) {
  const ref = ctx.trailerInfo?.Encrypt;
  if (!ref) return null;
  const dict = ref instanceof PDFDict ? ref : ctx.lookup(ref);
  if (!(dict instanceof PDFDict)) return null;

  const num = k => dict.get(PDFName.of(k))?.asNumber?.() ?? null;
  const str = k => {
    const v = dict.get(PDFName.of(k));
    return v ? bytesOf(v) : new Uint8Array(0);
  };
  const filter = dict.get(PDFName.of('Filter'))?.toString() ?? '';
  const V = num('V') ?? 0;
  const R = num('R') ?? 0;

  // Which cipher the streams use
  let cfm = V >= 4 ? 'Unknown' : (V === 1 || V === 2 ? 'V2' : 'Unknown');
  if (V >= 4) {
    const cf = ctx.lookup(dict.get(PDFName.of('CF')));
    const stmF = dict.get(PDFName.of('StmF'))?.toString().replace('/', '') || 'Identity';
    if (cf instanceof PDFDict) {
      const std = ctx.lookup(cf.get(PDFName.of(stmF)));
      if (std instanceof PDFDict) cfm = std.get(PDFName.of('CFM'))?.toString().replace('/', '') || 'Unknown';
    }
    if (stmF === 'Identity') cfm = 'Identity';
  }

  const idArr = ctx.trailerInfo?.ID;
  let id0 = new Uint8Array(0);
  if (idArr) {
    const arr = idArr instanceof PDFArray ? idArr : ctx.lookup(idArr);
    if (arr instanceof PDFArray && arr.size() > 0) id0 = bytesOf(ctx.lookup(arr.get(0)));
  }

  return {
    ref, dict, filter, V, R,
    lengthBits: num('Length') ?? 40,
    O: str('O'), U: str('U'), OE: str('OE'), UE: str('UE'), Perms: str('Perms'),
    P: num('P') ?? 0,
    encryptMetadata: dict.get(PDFName.of('EncryptMetadata'))?.toString() !== 'false',
    cfm, id0,
  };
}

/** Recover the file encryption key, or throw if the password is wrong. */
async function deriveFileKey(info, password) {
  const pw = new TextEncoder().encode(String(password ?? ''));

  if (info.R >= 5) {
    const prepared = preparePassword(password);
    // user password?
    const uValidationSalt = info.U.subarray(32, 40);
    const uKeySalt = info.U.subarray(40, 48);
    const uHash = await hash2B(prepared, uValidationSalt);
    if (same(uHash, info.U, 32)) {
      const intermediate = await hash2B(prepared, uKeySalt);
      return { key: await aesCbcNoPadDecrypt(intermediate, new Uint8Array(16), info.UE), cfm: 'AESV3' };
    }
    // owner password?
    const oValidationSalt = info.O.subarray(32, 40);
    const oKeySalt = info.O.subarray(40, 48);
    const oHash = await hash2B(prepared, oValidationSalt, info.U.subarray(0, 48));
    if (same(oHash, info.O, 32)) {
      const intermediate = await hash2B(prepared, oKeySalt, info.U.subarray(0, 48));
      return { key: await aesCbcNoPadDecrypt(intermediate, new Uint8Array(16), info.OE), cfm: 'AESV3' };
    }
    throw new WrongPasswordError();
  }

  // revisions 2-4
  const keyLen = info.R === 2 ? 5 : Math.max(5, Math.floor(info.lengthBits / 8));
  const key = computeLegacyKey(pw, info.O, info.P, info.id0, info.R, keyLen, info.encryptMetadata);
  const expectedU = computeU(key, info.id0, info.R);
  const compareLen = info.R === 2 ? 32 : 16;
  if (!same(expectedU, info.U, compareLen)) throw new WrongPasswordError();
  return { key, cfm: info.cfm === 'AESV2' ? 'AESV2' : 'V2' };
}

async function decryptData(data, fileKey, cfm, num, gen) {
  if (!data?.length) return data;
  if (cfm === 'Identity') return data;
  // Producers vary in what they encrypt. A value that is not valid ciphertext
  // is far more likely to be plain text than corruption, so leave it alone
  // rather than failing the whole document over one string.
  if ((cfm === 'AESV3' || cfm === 'AESV2') && (data.length <= 16 || (data.length - 16) % 16 !== 0)) {
    return data;
  }

  if (cfm === 'AESV3') {
    try { return await aesCbcDecrypt(fileKey, data.subarray(0, 16), data.subarray(16)); }
    catch { return data; }
  }
  if (cfm === 'AESV2') {
    const k = objectKey(fileKey, num, gen, true);
    try { return await aesCbcDecrypt(k, data.subarray(0, 16), data.subarray(16)); }
    catch { return data; }
  }
  // RC4
  return rc4(objectKey(fileKey, num, gen, false), data);
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {string} password
 * @returns {Promise<{bytes: Uint8Array, wasEncrypted: boolean, revision: number, cipher: string}>}
 */
export async function unlockPdf(bytes, password) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const info = readEncryptionInfo(ctx);

  if (!info) {
    return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
             wasEncrypted: false, revision: 0, cipher: 'none' };
  }
  if (info.filter !== '/Standard') {
    throw new UnsupportedEncryptionError(
      `This document uses the ${info.filter} security handler, which this tool cannot open`);
  }
  if (info.R >= 5 && info.U.length < 48) {
    throw new UnsupportedEncryptionError('The document declares AES-256 but its /U entry is malformed');
  }

  const { key: fileKey, cfm } = await deriveFileKey(info, password);

  // Decrypt every string and stream, then drop the /Encrypt dictionary.
  const seen = new Set();
  const walk = async (obj, num, gen) => {
    if (!obj || seen.has(obj)) return;
    if (obj instanceof PDFRef || obj instanceof PDFName || obj instanceof PDFNumber) return;

    if (obj instanceof PDFArray) {
      seen.add(obj);
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        if (v instanceof PDFString || v instanceof PDFHexString) {
          const plain = await decryptData(bytesOf(v), fileKey, cfm, num, gen);
          obj.set(i, PDFHexString.of([...plain].map(b => b.toString(16).padStart(2, '0')).join('')));
        } else await walk(v, num, gen);
      }
      return;
    }
    if (obj instanceof PDFRawStream) {
      const plain = await decryptData(obj.contents, fileKey, cfm, num, gen);
      obj.contents = plain;
      obj.dict.set(PDFName.of('Length'), PDFNumber.of(plain.length));
      await walk(obj.dict, num, gen);
      return;
    }
    if (obj instanceof PDFDict) {
      seen.add(obj);
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFString || v instanceof PDFHexString) {
          const plain = await decryptData(bytesOf(v), fileKey, cfm, num, gen);
          obj.set(k, PDFHexString.of([...plain].map(b => b.toString(16).padStart(2, '0')).join('')));
        } else await walk(v, num, gen);
      }
    }
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (info.ref instanceof PDFRef && ref.objectNumber === info.ref.objectNumber) continue;
    await walk(obj, ref.objectNumber, ref.generationNumber);
  }

  delete ctx.trailerInfo.Encrypt;

  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, wasEncrypted: true, revision: info.R, cipher: cfm };
}
