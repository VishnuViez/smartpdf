import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, loadPdfjs } from './_helpers.mjs';

const lib = await loadPdfjs();
const { protectPdf, PERMISSIONS } = await import(path.join(ROOT, 'app/lib/pdf/security/protect.js'));
const { hash2B, preparePassword, buildEncryptionValues, aesCbcNoPadEncrypt } =
  await import(path.join(ROOT, 'app/lib/pdf/security/crypto.js'));

const openWith = (bytes, password) =>
  lib.getDocument({ data: new Uint8Array(bytes), password }).promise;

describe('protect: the document is genuinely encrypted', () => {
  test('REGRESSION: the password is NOT recoverable from the file', async () => {
    // The previous implementation wrote the password in plain text inside
    // /Encrypt, so the "protected" file opened in any reader.
    const pw = 'correct horse battery staple';
    const { bytes } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: pw });
    const raw = Buffer.from(bytes);
    assert.ok(!raw.includes(pw), 'the password appears verbatim in the output');
    assert.ok(!raw.includes(Buffer.from(pw, 'latin1')), 'the password bytes appear in the output');
  });

  test('opening without a password is refused', async () => {
    const { bytes } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'secret' });
    await assert.rejects(() => openWith(bytes), e => e.name === 'PasswordException',
      'the document opened with no password');
  });

  test('the wrong password is refused', async () => {
    const { bytes } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'secret' });
    await assert.rejects(() => openWith(bytes, 'not-it'), e => e.name === 'PasswordException');
  });

  test('the right password opens it and the content is intact', async () => {
    const before = await lib.getDocument({ data: new Uint8Array(fixtureBytes('standard14.pdf')) }).promise;
    const originalText = (await (await before.getPage(1)).getTextContent())
      .items.map(i => i.str).join('');

    const { bytes } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'secret' });
    const after = await openWith(bytes, 'secret');
    const text = (await (await after.getPage(1)).getTextContent()).items.map(i => i.str).join('');
    assert.equal(text, originalText, 'content changed during encryption');
  });

  test('the owner password also opens the document', async () => {
    const { bytes } = await protectPdf(fixtureBytes('standard14.pdf'), {
      userPassword: 'user-pw', ownerPassword: 'owner-pw',
    });
    const doc = await openWith(bytes, 'owner-pw');
    assert.equal(doc.numPages, 1);
  });

  test('page content really is ciphertext, not just a flag', async () => {
    const plain = fixtureBytes('standard14.pdf');
    const { bytes } = await protectPdf(plain, { userPassword: 'secret' });
    const raw = Buffer.from(bytes).toString('latin1');
    // the original stream drew this text; it must not survive in the clear
    assert.ok(!raw.includes('Helvetica heading'), 'page text is readable without the password');
    assert.ok(!raw.includes('Times body text'), 'page text is readable without the password');
  });

  test('every fixture survives a protect / open round trip', async () => {
    for (const name of fixtureNames()) {
      let original;
      try { original = await lib.getDocument({ data: new Uint8Array(fixtureBytes(name)) }).promise; }
      catch { continue; }                       // unopenable fixtures are covered elsewhere
      let out;
      try { out = await protectPdf(fixtureBytes(name), { userPassword: 'pw' }); }
      catch (err) { assert.fail(`${name}: protect threw — ${err.message}`); }
      const doc = await openWith(out.bytes, 'pw');
      assert.equal(doc.numPages, original.numPages, `${name}: page count changed`);
      await (await doc.getPage(1)).getOperatorList();      // must render
    }
  });

  test('multi-page documents encrypt every page', async () => {
    const { bytes } = await protectPdf(fixtureBytes('multipage.pdf'), { userPassword: 'pw' });
    const doc = await openWith(bytes, 'pw');
    assert.equal(doc.numPages, 40);
    for (const i of [1, 20, 40]) {
      const tc = await (await doc.getPage(i)).getTextContent();
      assert.match(tc.items.map(x => x.str).join(''), new RegExp(`Page ${i} of 40`));
    }
  });

  test('an empty password is refused rather than producing a fake lock', async () => {
    await assert.rejects(() => protectPdf(fixtureBytes('standard14.pdf'), { userPassword: '' }));
    await assert.rejects(() => protectPdf(fixtureBytes('standard14.pdf'), {}));
  });
});

describe('protect: permissions', () => {
  test('denied permissions are recorded in /P', async () => {
    const open = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'pw' });
    const locked = await protectPdf(fixtureBytes('standard14.pdf'), {
      userPassword: 'pw', allow: { copy: false, modify: false },
    });
    assert.notEqual(open.permissions, locked.permissions, '/P did not change');
    assert.equal(locked.permissions & PERMISSIONS.copy, 0, 'copy was not denied');
    assert.equal(locked.permissions & PERMISSIONS.modify, 0, 'modify was not denied');
    assert.ok(locked.permissions & PERMISSIONS.print, 'printing was denied when it should not be');
  });
});

describe('protect: the crypto primitives', () => {
  test('AES-CBC without padding returns exactly the input length', async () => {
    const key = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(16);
    for (const len of [16, 32, 64]) {
      const out = await aesCbcNoPadEncrypt(key, iv, new Uint8Array(len).fill(3));
      assert.equal(out.length, len, `no-pad encrypt returned ${out.length} for ${len}`);
    }
    await assert.rejects(() => aesCbcNoPadEncrypt(key, iv, new Uint8Array(17)));
  });

  test('the revision-6 hash is deterministic and 32 bytes', async () => {
    const pw = preparePassword('hello');
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = await hash2B(pw, salt);
    const b = await hash2B(pw, salt);
    assert.equal(a.length, 32);
    assert.deepEqual([...a], [...b], 'the hash is not deterministic');
    const different = await hash2B(preparePassword('hellp'), salt);
    assert.notDeepEqual([...a], [...different], 'a different password produced the same hash');
  });

  test('salts make every encryption of the same password unique', async () => {
    const a = await buildEncryptionValues('same', 'same', -4);
    const b = await buildEncryptionValues('same', 'same', -4);
    assert.notDeepEqual([...a.U], [...b.U], 'U is not salted');
    assert.notDeepEqual([...a.fileKey], [...b.fileKey], 'the file key is not random');
  });

  test('passwords are normalised and length-capped per the spec', () => {
    assert.ok(preparePassword('x'.repeat(300)).length <= 127);
    assert.deepEqual([...preparePassword('café')], [...preparePassword('café')],
      'NFKC normalisation was not applied');
  });
});
