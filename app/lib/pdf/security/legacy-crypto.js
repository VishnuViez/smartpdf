/**
 * MD5 and RC4 — needed only to OPEN documents encrypted with the older
 * standard security handler (revisions 2 through 4).
 *
 * WebCrypto deliberately omits both because neither is safe for new work. They
 * are implemented here anyway because a user who cannot open a file they own
 * has been failed by the tool, and the overwhelming majority of encrypted PDFs
 * in circulation predate AES-256.
 *
 * These are used to DECRYPT existing documents only. Nothing this project
 * writes uses them — protect.js always produces AES-256.
 */

/* ---------------- MD5 (RFC 1321) ---------------- */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

export function md5(input) {
  const msg = input;
  const bitLen = msg.length * 8;
  const withPad = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  withPad.set(msg);
  withPad[msg.length] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);

  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  o.setInt32(0, a0, true); o.setInt32(4, b0, true);
  o.setInt32(8, c0, true); o.setInt32(12, d0, true);
  return out;
}

/* ---------------- RC4 ---------------- */

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0; j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** The 32-byte padding string from the specification (Algorithm 2). */
export const PAD = new Uint8Array([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56,
  0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
  0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
]);

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const padPassword = (pw) => {
  const bytes = new Uint8Array(32);
  const n = Math.min(pw.length, 32);
  bytes.set(pw.subarray(0, n));
  bytes.set(PAD.subarray(0, 32 - n), n);
  return bytes;
};

/**
 * Algorithm 2: derive the file encryption key for revisions 2-4.
 *
 * @param {Uint8Array} password  the user password, unpadded
 * @param {Uint8Array} O         the /O entry
 * @param {number} P             the /P permissions value
 * @param {Uint8Array} id0       the first element of the document /ID
 * @param {number} revision      /R
 * @param {number} keyLength     in bytes (5 for 40-bit, 16 for 128-bit)
 * @param {boolean} encryptMetadata
 */
export function computeLegacyKey(password, O, P, id0, revision, keyLength, encryptMetadata) {
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, P | 0, true);

  const parts = [padPassword(password), O.subarray(0, 32), pBytes, id0];
  if (revision >= 4 && !encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let hash = md5(concat(...parts));

  if (revision >= 3) {
    // 50 further passes over the first keyLength bytes
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLength));
  }
  return hash.subarray(0, keyLength);
}

/** Algorithm 4/5: the /U value a correct password would produce. */
export function computeU(fileKey, id0, revision) {
  if (revision === 2) return rc4(fileKey, PAD);

  let hash = md5(concat(PAD, id0));
  let out = rc4(fileKey, hash);
  // 19 further rounds with the key bytes XORed by the round number
  for (let i = 1; i <= 19; i++) {
    const k = new Uint8Array(fileKey.length);
    for (let j = 0; j < fileKey.length; j++) k[j] = fileKey[j] ^ i;
    out = rc4(k, out);
  }
  return concat(out, new Uint8Array(16));   // padded to 32 bytes
}

/** Per-object key for revisions 2-4 (Algorithm 1). */
export function objectKey(fileKey, num, gen, isAes) {
  const extra = new Uint8Array(isAes ? 9 : 5);
  extra[0] = num & 0xff;
  extra[1] = (num >> 8) & 0xff;
  extra[2] = (num >> 16) & 0xff;
  extra[3] = gen & 0xff;
  extra[4] = (gen >> 8) & 0xff;
  if (isAes) { extra[5] = 0x73; extra[6] = 0x41; extra[7] = 0x6c; extra[8] = 0x54; }  // 'sAlT'
  const hash = md5(concat(fileKey, extra));
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}
