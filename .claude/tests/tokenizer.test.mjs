import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, fixtureNames, fixtureBytes, corpusFiles, contentStreams } from './_helpers.mjs';

const { tokenize, T } = await import(path.join(ROOT, 'app/lib/pdf/parse/tokenizer.js'));

/** Spans must tile the buffer exactly AND reassemble byte-for-byte. */
function assertTiles(buf, label) {
  const toks = tokenize(buf);
  let pos = 0;
  for (const t of toks) {
    assert.equal(t.start, pos, `${label}: gap/overlap at token ${t.t} (expected start ${pos}, got ${t.start})`);
    assert.ok(t.end >= t.start, `${label}: inverted span`);
    pos = t.end;
  }
  assert.equal(pos, buf.length, `${label}: spans do not reach end of buffer`);
  const rebuilt = Buffer.concat(toks.map(t => buf.subarray(t.start, t.end)));
  assert.ok(rebuilt.equals(buf), `${label}: reassembly is not byte-identical`);
  return toks;
}

describe('tokenizer: byte-exact round-trip', () => {
  for (const name of fixtureNames()) {
    test(name, async () => {
      let streams;
      try { streams = await contentStreams(fixtureBytes(name)); }
      catch { return; }                    // unopenable fixtures are covered elsewhere
      for (const [i, buf] of streams.entries()) {
        if (buf.length) assertTiles(buf, `${name}#${i}`);
      }
    });
  }

  test('real-world corpus (optional, set SMARTPDF_CORPUS)', async () => {
    const files = corpusFiles();
    if (!files.length) return;
    let streams = 0;
    for (const f of files) {
      let bufs; try { bufs = await contentStreams(f.bytes); } catch { continue; }
      for (const [i, b] of bufs.entries()) if (b.length) { assertTiles(b, `${f.name}#${i}`); streams++; }
    }
    assert.ok(streams > 0, 'corpus produced no content streams');
  });
});

describe('tokenizer: adversarial syntax', () => {
  const meaningful = buf => tokenize(buf).filter(t => t.t !== T.WS && t.t !== T.COMMENT)
                                         .map(t => (t.t === T.OP ? t.op : t.t));
  const check = (label, src, expected) => test(label, () => {
    const buf = Buffer.isBuffer(src) ? src : Buffer.from(src, 'latin1');
    assertTiles(buf, label);
    if (expected) assert.deepEqual(meaningful(buf), expected);
  });

  check('nested parens',        '(a(b)c) Tj', ['str', 'Tj']);
  check('escaped close paren',  '(a\\)b) Tj', ['str', 'Tj']);
  check('escaped backslash',    '(a\\\\) Tj', ['str', 'Tj']);
  check('empty string',         '() Tj', ['str', 'Tj']);
  check('string with newline',  '(l1\nl2) Tj', ['str', 'Tj']);
  check('comment w/ delims',    '% ( [ << /x\n0 0 m', ['num', 'num', 'm']);
  check('comment at EOF',       '0 0 m % trailing', ['num', 'num', 'm']);
  check('name hex escape',      '/A#20B gs', ['name', 'gs']);
  check('number trailing dot',  '4. 0 m', ['num', 'num', 'm']);
  check('number leading dot',   '.5 0 m', ['num', 'num', 'm']);
  check('number exponent',      '6.02E23 0 m', ['num', 'num', 'm']);
  check('hex w/ whitespace',    '<48 65 6C> Tj', ['hex', 'Tj']);
  check('hex odd length',       '<48A> Tj', ['hex', 'Tj']);
  check('nested dict',          '<</A<</B 1>>>> BDC', ['<<','name','<<','name','num','>>','>>','BDC']);
  check('quote operators',      "(hi)' (a) 1 2 \" ", ['str', "'", 'str', 'num', 'num', '"']);
  check('BX/EX compatibility',  'BX /Foo sh EX', ['BX', 'name', 'sh', 'EX']);
  check('type3 metrics',        '0 0 d0', ['num', 'num', 'd0']);
  check('CR line endings',      '0 0 m\r1 1 l\rS', ['num','num','m','num','num','l','S']);

  test('inline image: "EI" inside payload, no /L', () => {
    const buf = Buffer.concat([
      Buffer.from('q BI /W 4 /H 1 /CS /G /BPC 8 ID ', 'latin1'),
      Buffer.from([0x45, 0x49, 0x20, 0xff]),
      Buffer.from(' EI Q', 'latin1'),
    ]);
    assertTiles(buf, 'inline-no-L');
    assert.deepEqual(meaningful(buf), ['q', 'inline_img', 'Q']);
  });

  test('inline image: /L declared', () => {
    const buf = Buffer.concat([
      Buffer.from('BI /W 4 /H 1 /L 4 /CS /G /BPC 8 ID ', 'latin1'),
      Buffer.from([0x45, 0x49, 0x20, 0xff]),
      Buffer.from(' EI Q', 'latin1'),
    ]);
    assertTiles(buf, 'inline-L');
    assert.deepEqual(meaningful(buf), ['inline_img', 'Q']);
  });

  test('inline image: binary with newlines and delimiters', () => {
    const buf = Buffer.concat([
      Buffer.from('BI /W 2 /H 2 /CS /RGB /BPC 8 ID ', 'latin1'),
      Buffer.from([0x00,0x0A,0x25,0x28,0xFF,0x51,0x0D,0x71,0x42,0x54,0x00,0xFF]),
      Buffer.from('\nEI\nQ', 'latin1'),
    ]);
    assertTiles(buf, 'inline-binary');
    assert.deepEqual(meaningful(buf), ['inline_img', 'Q']);
  });

  test('two consecutive inline images', () => {
    const buf = Buffer.from('BI /W 1 /H 1 /CS /G /BPC 8 ID x EI BI /W 1 /H 1 /CS /G /BPC 8 ID y EI S', 'latin1');
    assertTiles(buf, 'inline-two');
    assert.deepEqual(meaningful(buf), ['inline_img', 'inline_img', 'S']);
  });
});
