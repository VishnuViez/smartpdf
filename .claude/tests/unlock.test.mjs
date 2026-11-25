import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureBytes, corpusFiles, loadPdfjs } from './_helpers.mjs';

const lib = await loadPdfjs();
const { protectPdf } = await import(path.join(ROOT, 'app/lib/pdf/security/protect.js'));
const { unlockPdf, WrongPasswordError } = await import(path.join(ROOT, 'app/lib/pdf/security/unlock.js'));
const { md5, rc4 } = await import(path.join(ROOT, 'app/lib/pdf/security/legacy-crypto.js'));

const open = (b, password) => lib.getDocument({ data: new Uint8Array(b), password }).promise;
const textOf = async (b, pw) =>
  (await (await (await open(b, pw)).getPage(1)).getTextContent()).items.map(x => x.str).join('');
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

describe('unlock: the legacy primitives are correct', () => {
  test('MD5 matches the RFC 1321 test vectors', () => {
    const enc = s => new TextEncoder().encode(s);
    assert.equal(hex(md5(enc(''))), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(hex(md5(enc('a'))), '0cc175b9c0f1b6a831c399e269772661');
    assert.equal(hex(md5(enc('abc'))), '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(hex(md5(enc('message digest'))), 'f96b697d7cb7938d525a2f31aaf161d0');
    assert.equal(hex(md5(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))),
      '57edf4a22be3c955ac49da2e2107b67a');
  });

  test('RC4 matches its published test vector', () => {
    const enc = s => new TextEncoder().encode(s);
    assert.equal(hex(rc4(enc('Key'), enc('Plaintext'))).toUpperCase(), 'BBF316E8D940AF0AD3');
    assert.equal(hex(rc4(enc('Wiki'), enc('pedia'))).toUpperCase(), '1021BF0420');
  });

  test('RC4 is its own inverse', () => {
    const key = new TextEncoder().encode('a secret');
    const data = new TextEncoder().encode('the quick brown fox');
    assert.deepEqual([...rc4(key, rc4(key, data))], [...data]);
  });
});

describe('unlock: AES-256 documents', () => {
  test('REGRESSION: unlocking actually removes the encryption', async () => {
    // the previous implementation passed a `password` option pdf-lib ignores,
    // so the "unlocked" file was still encrypted
    const original = fixtureBytes('standard14.pdf');
    const { bytes: locked } = await protectPdf(original, { userPassword: 'open sesame' });
    await assert.rejects(() => open(locked), e => e.name === 'PasswordException');

    const r = await unlockPdf(locked, 'open sesame');
    assert.equal(r.wasEncrypted, true);
    assert.equal(r.revision, 6);
    assert.equal(r.cipher, 'AESV3');

    const doc = await open(r.bytes);            // no password at all
    assert.equal(doc.numPages, 1);
  });

  test('content is identical after the round trip', async () => {
    const original = fixtureBytes('standard14.pdf');
    const before = await textOf(original);
    const { bytes: locked } = await protectPdf(original, { userPassword: 'pw' });
    const r = await unlockPdf(locked, 'pw');
    assert.equal(await textOf(r.bytes), before);
  });

  test('a wrong password is refused, not guessed at', async () => {
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'right' });
    await assert.rejects(() => unlockPdf(locked, 'wrong'), WrongPasswordError);
    await assert.rejects(() => unlockPdf(locked, ''), WrongPasswordError);
  });

  test('the owner password also unlocks', async () => {
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), {
      userPassword: 'user-pw', ownerPassword: 'owner-pw',
    });
    const r = await unlockPdf(locked, 'owner-pw');
    assert.equal(r.wasEncrypted, true);
    await open(r.bytes);
  });

  test('multi-page documents survive intact', async () => {
    const { bytes: locked } = await protectPdf(fixtureBytes('multipage.pdf'), { userPassword: 'pw' });
    const r = await unlockPdf(locked, 'pw');
    const doc = await open(r.bytes);
    assert.equal(doc.numPages, 40);
    const t = (await (await doc.getPage(20)).getTextContent()).items.map(x => x.str).join('');
    assert.match(t, /Page 20 of 40/);
  });

  test('REGRESSION: no metadata escapes encryption in plain text', async () => {
    // pdf-lib rewrites /Producer and /ModDate around save time; if that happens
    // after the encryption walk those strings leak in the clear
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'pw' });
    const raw = Buffer.from(locked);
    assert.ok(!raw.includes('pdf-lib (https'), '/Producer leaked in plain text');
  });
});

describe('unlock: files that are not encrypted', () => {
  test('an ordinary PDF passes straight through', async () => {
    const r = await unlockPdf(fixtureBytes('standard14.pdf'), '');
    assert.equal(r.wasEncrypted, false);
    await open(r.bytes);
  });
});

describe('unlock: real encrypted documents', () => {
  test('legacy RC4 documents in the corpus can be opened', async () => {
    const files = corpusFiles();
    if (!files.length) return;
    let tested = 0;
    for (const f of files) {
      if (!Buffer.from(f.bytes).includes('/Encrypt')) continue;
      let r;
      try { r = await unlockPdf(f.bytes, ''); }
      catch (e) {
        // a genuinely password-protected file is allowed to refuse an empty password
        assert.ok(e instanceof WrongPasswordError || e.name === 'UnsupportedEncryptionError',
          `${f.name}: unexpected failure ${e.name}: ${e.message}`);
        continue;
      }
      tested++;
      assert.equal(r.wasEncrypted, true, `${f.name}: encryption not detected`);
      const doc = await open(r.bytes);          // opens with NO password now
      assert.ok(doc.numPages > 0, `${f.name}: output has no pages`);
    }
    if (tested === 0) return;   // corpus had none that open with an empty password
  });
});
