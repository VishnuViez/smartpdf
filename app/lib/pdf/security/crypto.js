/**
 * Primitives for PDF 2.0 (ISO 32000-2) AES-256 encryption, revision 6.
 *
 * The previous "protection" wrote an /Encrypt dictionary containing the
 * password in plain text with no cipher applied, so the file opened in any
 * reader. That is worse than offering nothing, because the user believes the
 * document is protected.
 *
 * Revision 6 is implemented here rather than the older RC4 revisions because it
 * needs only SHA-256/384/512 and AES-CBC — primitives WebCrypto provides — with
 * no MD5 or RC4, and because it is the only revision still considered sound.
 */

const subtle = () => {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c?.subtle) throw new Error('WebCrypto is unavailable; cannot encrypt');
  return c.subtle;
};

export const randomBytes = n => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

export const concat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const digest = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));

/**
 * AES-CBC with NO padding.
 *
 * WebCrypto always appends a PKCS#7 block. For inputs that are already a
 * multiple of the block size that extra block is exactly 16 bytes, so dropping
 * it yields the unpadded result the specification expects.
 */
export async function aesCbcNoPadEncrypt(key, iv, data) {
  if (data.length % 16 !== 0) throw new Error('AES-CBC no-pad needs a multiple of 16 bytes');
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  const full = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  return full.subarray(0, full.length - 16);
}

/** AES-CBC with the standard PKCS#7 padding, used for object encryption. */
export async function aesCbcEncrypt(key, iv, data) {
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
}

/**
 * AES-CBC decryption with NO padding.
 *
 * WebCrypto always expects a PKCS#7 block and throws without one. The trick is
 * to synthesise that block: encrypt a full padding block using the ciphertext's
 * final block as the IV, append it, and let WebCrypto strip it back off.
 */
export async function aesCbcNoPadDecrypt(key, iv, data) {
  if (data.length % 16 !== 0) throw new Error('AES-CBC no-pad needs a multiple of 16 bytes');
  if (data.length === 0) return new Uint8Array(0);
  const lastBlock = data.subarray(data.length - 16);
  const padBlock = new Uint8Array(16).fill(16);
  const tail = await aesCbcEncrypt(key, lastBlock, padBlock);   // 32 bytes: block + its own padding
  const combined = concat(data, tail.subarray(0, 16));
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['decrypt']);
  const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, combined));
  return plain.subarray(0, data.length);
}

export async function aesCbcDecrypt(key, iv, data) {
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, data));
}

/**
 * ISO 32000-2 Algorithm 2.B — the revision-6 password hash.
 *
 * Deliberately expensive: at least 64 rounds of AES plus a SHA digest whose
 * width is chosen by the data itself, so the work cannot be skipped ahead.
 */
export async function hash2B(password, salt, userData = new Uint8Array(0)) {
  let K = await digest('SHA-256', concat(password, salt, userData));
  let round = 0;
  let E = new Uint8Array(0);

  for (;;) {
    // K1 = (password || K || userData) repeated 64 times
    const unit = concat(password, K, userData);
    const K1 = new Uint8Array(unit.length * 64);
    for (let i = 0; i < 64; i++) K1.set(unit, i * unit.length);

    E = await aesCbcNoPadEncrypt(K.subarray(0, 16), K.subarray(16, 32), K1);

    // the sum of E's first 16 bytes, mod 3, selects the next digest width
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    const mod = sum % 3;
    K = await digest(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', E);

    round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
  }
  return K.subarray(0, 32);
}

const encoder = new TextEncoder();

/**
 * Passwords are SASLprep-normalised and truncated to 127 bytes per the spec.
 * Full SASLprep is not implemented; NFKC covers the cases that matter here and
 * is what most producers do in practice.
 */
export function preparePassword(password) {
  const s = String(password ?? '').normalize('NFKC');
  const bytes = encoder.encode(s);
  return bytes.length > 127 ? bytes.subarray(0, 127) : bytes;
}

/**
 * Build the values for a revision-6 /Encrypt dictionary.
 *
 * @param {string} userPassword   opens the document
 * @param {string} ownerPassword  additionally grants full permissions
 * @param {number} permissions    the /P bitfield
 * @returns {Promise<{fileKey, U, UE, O, OE, Perms, P}>}
 */
export async function buildEncryptionValues(userPassword, ownerPassword, permissions) {
  const fileKey = randomBytes(32);
  const user = preparePassword(userPassword);
  const owner = preparePassword(ownerPassword || userPassword);

  // --- user entries (Algorithm 8) ---
  const uValidationSalt = randomBytes(8);
  const uKeySalt = randomBytes(8);
  const uHash = await hash2B(user, uValidationSalt);
  const U = concat(uHash, uValidationSalt, uKeySalt);
  const uIntermediate = await hash2B(user, uKeySalt);
  const UE = await aesCbcNoPadEncrypt(uIntermediate, new Uint8Array(16), fileKey);

  // --- owner entries (Algorithm 9) — these hash over U as well ---
  const oValidationSalt = randomBytes(8);
  const oKeySalt = randomBytes(8);
  const oHash = await hash2B(owner, oValidationSalt, U);
  const O = concat(oHash, oValidationSalt, oKeySalt);
  const oIntermediate = await hash2B(owner, oKeySalt, U);
  const OE = await aesCbcNoPadEncrypt(oIntermediate, new Uint8Array(16), fileKey);

  // --- permissions (Algorithm 10) ---
  const perms = new Uint8Array(16);
  const p = permissions | 0;
  perms[0] = p & 0xff;
  perms[1] = (p >> 8) & 0xff;
  perms[2] = (p >> 16) & 0xff;
  perms[3] = (p >> 24) & 0xff;
  perms[4] = 0xff; perms[5] = 0xff; perms[6] = 0xff; perms[7] = 0xff;
  perms[8] = 0x54;                       // 'T' — metadata is encrypted
  perms[9] = 0x61; perms[10] = 0x64; perms[11] = 0x62;   // 'adb'
  perms.set(randomBytes(4), 12);
  // ECB over one block is CBC with a zero IV
  const Perms = await aesCbcNoPadEncrypt(fileKey, new Uint8Array(16), perms);

  return { fileKey, U, UE, O, OE, Perms, P: p };
}

/** Encrypt one string or stream: a random IV followed by the ciphertext. */
export async function encryptObjectData(fileKey, data) {
  const iv = randomBytes(16);
  const body = await aesCbcEncrypt(fileKey, iv, data);
  return concat(iv, body);
}
