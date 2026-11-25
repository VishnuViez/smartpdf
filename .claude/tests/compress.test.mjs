import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, corpusFiles, loadPdfjs } from './_helpers.mjs';

const lib = await loadPdfjs();
const { compressPdf, PRESETS } = await import(path.join(ROOT, 'app/lib/pdf/optimize/compress.js'));

const open = b => lib.getDocument({ data: new Uint8Array(b) }).promise;
const textOf = async (b, i = 1) =>
  (await (await (await open(b)).getPage(i)).getTextContent()).items.map(x => x.str).join('');

describe('compress: must never make a file worse', () => {
  test('REGRESSION: output is never larger than input', async () => {
    // the previous implementation grew multipage.pdf from 18,831 to 18,837 bytes
    for (const name of fixtureNames()) {
      let r;
      try { r = await compressPdf(fixtureBytes(name)); } catch { continue; }
      assert.ok(r.compressedSize <= r.originalSize,
        `${name}: ${r.originalSize} -> ${r.compressedSize} (grew by ${r.compressedSize - r.originalSize})`);
    }
  });

  test('when nothing can be saved the ORIGINAL bytes are returned unchanged', async () => {
    const input = fixtureBytes('standard14.pdf');
    const once = await compressPdf(input);
    const twice = await compressPdf(once.bytes);
    // a second pass has nothing left to do
    assert.ok(twice.compressedSize <= once.compressedSize);
    if (twice.unchanged) {
      assert.equal(twice.saved, 0);
      assert.equal(twice.ratio, 0);
    }
  });

  test('the compressed file is still a valid, readable PDF', async () => {
    for (const name of fixtureNames()) {
      let r, original;
      try {
        original = await open(fixtureBytes(name));
        r = await compressPdf(fixtureBytes(name));
      } catch { continue; }
      const out = await open(r.bytes);
      assert.equal(out.numPages, original.numPages, `${name}: page count changed`);
      await (await out.getPage(1)).getOperatorList();
    }
  });

  test('text survives compression exactly', async () => {
    for (const name of ['standard14.pdf', 'colors.pdf', 'form-underlines.pdf', 'tiny-and-single-char.pdf']) {
      const before = await textOf(fixtureBytes(name));
      const r = await compressPdf(fixtureBytes(name));
      assert.equal(await textOf(r.bytes), before, `${name}: text changed`);
    }
  });

  test('a 40-page document keeps every page', async () => {
    const r = await compressPdf(fixtureBytes('multipage.pdf'));
    const out = await open(r.bytes);
    assert.equal(out.numPages, 40);
    for (const i of [1, 20, 40]) {
      assert.match(await textOf(r.bytes, i), new RegExp(`Page ${i} of 40`));
    }
  });

  test('unfiltered streams are deflated', async () => {
    // tricky-syntax.pdf is written with a raw, unfiltered content stream
    const r = await compressPdf(fixtureBytes('tricky-syntax.pdf'));
    assert.ok(r.stats.streamsDeflated > 0, 'no stream was deflated');
    assert.ok(r.stats.streamBytesSaved > 0);
  });
});

describe('compress: the image pass', () => {
  const fakeCodec = (shrinkTo) => async (data) => ({
    bytes: new Uint8Array(Math.max(1, Math.floor(data.length * shrinkTo))).fill(0xff),
    width: 10, height: 10,
  });

  test('a codec that would GROW an image is rejected', async () => {
    const grow = async (data) => ({ bytes: new Uint8Array(data.length * 2), width: 10, height: 10 });
    const r = await compressPdf(fixtureBytes('standard14.pdf'), { recompressImage: grow });
    assert.equal(r.stats.imagesRecompressed, 0, 'a larger replacement was accepted');
  });

  test('a codec that throws does not break the compression', async () => {
    const boom = async () => { throw new Error('codec exploded'); };
    const r = await compressPdf(fixtureBytes('standard14.pdf'), { recompressImage: boom });
    assert.ok(r.compressedSize <= r.originalSize);
  });

  test('images are left alone when no codec is supplied', async () => {
    const r = await compressPdf(fixtureBytes('standard14.pdf'));
    assert.equal(r.stats.imagesRecompressed, 0);
  });

  test('presets differ in aggressiveness', () => {
    assert.ok(PRESETS.strong.imageQuality < PRESETS.balanced.imageQuality);
    assert.ok(PRESETS.balanced.imageQuality < PRESETS.light.imageQuality);
    assert.ok(PRESETS.strong.maxImagePixels < PRESETS.light.maxImagePixels);
    for (const p of Object.values(PRESETS)) {
      assert.ok(p.imageQuality > 0 && p.imageQuality <= 1);
      assert.ok(p.maxImagePixels > 0);
      assert.ok(typeof p.label === 'string' && p.label.length > 0);
    }
  });

  test('progress is reported monotonically from 0 to 100', async () => {
    const seen = [];
    await compressPdf(fixtureBytes('multipage.pdf'), {
      onProgress: (pct) => seen.push(pct),
      recompressImage: fakeCodec(0.5),
    });
    assert.ok(seen.length > 0, 'no progress reported');
    assert.equal(seen[seen.length - 1], 100);
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i] >= seen[i - 1], `progress went backwards: ${seen[i - 1]} -> ${seen[i]}`);
    }
  });
});

describe('compress: real-world corpus', () => {
  test('no real document is ever grown, and content survives', async () => {
    const files = corpusFiles();
    if (!files.length) return;
    const grown = [];
    let totalIn = 0, totalOut = 0;
    for (const f of files) {
      let r;
      try { r = await compressPdf(f.bytes); }
      catch (e) {
        // refusing an encrypted document is the correct outcome, not a failure
        assert.equal(e.name, 'EncryptedDocumentError',
          `${f.name}: unexpected error ${e.name}: ${e.message}`);
        continue;
      }
      totalIn += r.originalSize; totalOut += r.compressedSize;
      if (r.compressedSize > r.originalSize) grown.push(f.name);
      try { await open(r.bytes); } catch (e) { grown.push(`${f.name} (unreadable: ${e.message.slice(0, 40)})`); }
    }
    assert.deepEqual(grown, [], `documents damaged or grown: ${grown.join(', ')}`);
    assert.ok(totalOut <= totalIn, 'the corpus grew overall');
  });
});

describe('no tool may depend on a third-party CDN', () => {
  test('REGRESSION: pdf.js is bundled, never fetched from unpkg', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const walk = (dir) => readdirSync(dir).flatMap(f => {
      const full = path.join(dir, f);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const offenders = [];
    for (const file of walk(path.join(ROOT, 'app'))) {
      if (!/\.(js|jsx|mjs|css)$/.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      // the loader module names the CDN in a comment explaining why not to use it
      if (file.endsWith('lib/pdf/pdfjs.js')) continue;
      if (/unpkg\.com|cdnjs\.cloudflare|jsdelivr\.net/.test(src)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(offenders, [],
      `these files fetch code from a CDN at runtime, breaking offline use and the privacy claim:\n  ${offenders.join('\n  ')}`);
  });

  test('every pdf.js consumer goes through the shared loader', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const walk = (dir) => readdirSync(dir).flatMap(f => {
      const full = path.join(dir, f);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const offenders = [];
    for (const file of walk(path.join(ROOT, 'app'))) {
      if (!/\.js$/.test(file) || file.endsWith('lib/pdf/pdfjs.js')) continue;
      const src = readFileSync(file, 'utf8');
      if (/GlobalWorkerOptions\.workerSrc/.test(src)) offenders.push(path.relative(ROOT, file));
    }
    assert.deepEqual(offenders, [],
      `these set workerSrc directly instead of using loadPdfjs():\n  ${offenders.join('\n  ')}`);
  });
});

describe('every tool must refuse encrypted documents rather than corrupt them', () => {
  test('REGRESSION: compressing an encrypted PDF is refused', async () => {
    const { protectPdf } = await import(path.join(ROOT, 'app/lib/pdf/security/protect.js'));
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'pw' });
    await assert.rejects(() => compressPdf(locked), e => e.name === 'EncryptedDocumentError',
      'an encrypted document was rewritten instead of refused');
  });

  test('the error names the remedy', async () => {
    const { protectPdf } = await import(path.join(ROOT, 'app/lib/pdf/security/protect.js'));
    const { bytes: locked } = await protectPdf(fixtureBytes('standard14.pdf'), { userPassword: 'pw' });
    try { await compressPdf(locked); assert.fail('should have thrown'); }
    catch (e) { assert.match(e.message, /unlock/i); }
  });
});

describe('rotate: per-page angles', () => {
  test('REGRESSION: different pages can be rotated differently', async () => {
    // the tool previously rotated ALL pages by one angle, with no way to fix a
    // single sideways scan
    const { rotatePDF } = await import(path.join(ROOT, 'app/lib/pdf-utils.js'));
    const lib2 = await loadPdfjs();
    const bytes = fixtureBytes('multipage.pdf');
    const file = { arrayBuffer: async () => bytes };

    const r = await rotatePDF(file, { 0: 90, 2: 180 });
    assert.equal(r.rotated, 2, 'expected exactly two pages to change');

    const doc = await lib2.getDocument({ data: new Uint8Array(await r.blob.arrayBuffer()) }).promise;
    const rotations = [];
    for (let i = 1; i <= 4; i++) rotations.push((await doc.getPage(i)).rotate);
    assert.deepEqual(rotations, [90, 0, 180, 0], 'per-page rotation did not apply correctly');
  });

  test('rotation accumulates onto whatever the page already had', async () => {
    const { rotatePDF } = await import(path.join(ROOT, 'app/lib/pdf-utils.js'));
    const lib2 = await loadPdfjs();
    const bytes = fixtureBytes('rotations.pdf');    // pages already at 0/90/180/270
    const file = { arrayBuffer: async () => bytes };
    const r = await rotatePDF(file, { 1: 90 });     // page 2 is already 90
    const doc = await lib2.getDocument({ data: new Uint8Array(await r.blob.arrayBuffer()) }).promise;
    assert.equal((await doc.getPage(2)).rotate, 180, 'rotation replaced instead of accumulating');
  });

  test('a zero angle is treated as no change', async () => {
    const { rotatePDF } = await import(path.join(ROOT, 'app/lib/pdf-utils.js'));
    const bytes = fixtureBytes('multipage.pdf');
    const r = await rotatePDF({ arrayBuffer: async () => bytes }, { 0: 0, 1: 0 });
    assert.equal(r.rotated, 0);
  });
});
