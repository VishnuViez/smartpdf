import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from './_helpers.mjs';

const { parseFontName, stripSubsetPrefix, parseDescriptorFlags, createFontRecord, substituteStack } =
  await import(path.join(ROOT, 'app/lib/pdf/model/fonts.js'));

describe('fonts: identity recovery', () => {
  test('subset prefixes are exactly 6 uppercase letters + "+"', () => {
    assert.equal(stripSubsetPrefix('MUIQHM+Gotham-Book'), 'Gotham-Book');
    assert.equal(stripSubsetPrefix('/AAAAAB+HelveticaNeue-Bold'), 'HelveticaNeue-Bold');
    assert.equal(stripSubsetPrefix('Helvetica'), 'Helvetica');
    assert.equal(stripSubsetPrefix('ABCDE+Foo'), 'ABCDE+Foo', '5 letters is not a subset prefix');
    assert.equal(stripSubsetPrefix('abcdef+Foo'), 'abcdef+Foo', 'lowercase is not a subset prefix');
  });

  describe('names observed in real documents', () => {
    const cases = [
      ['MUIQHM+Gotham-Book',         'Gotham',          400, false],
      ['UNTEHO+Gotham-Medium',       'Gotham',          500, false],
      ['ZOYKBO+Gotham-Light',        'Gotham',          300, false],
      ['MBIPOF+Gotham-Bold',         'Gotham',          700, false],
      ['XURGBS+CenturyGothic',       'Century Gothic',  400, false],
      ['ZPDFKO+SFProText-Medium',    'SF Pro Text',     500, false],
      ['AAAAAB+HelveticaNeue-Bold',  'Helvetica Neue',  700, false],
      ['AAAAAF+HiraKakuPro-W6',      'Hira Kaku Pro',   600, false],
      ['Helvetica-BoldOblique',      'Helvetica',       700, true ],
      ['Times-BoldItalic',           'Times',           700, true ],
      ['Arial-BoldMT',               'Arial',           700, false],
      ['ArialMT',                    'Arial',           400, false],
      ['TimesNewRomanPS-ItalicMT',   'Times New Roman', 400, true ],
      ['Calibri-Light',              'Calibri',         300, false],
    ];
    for (const [raw, family, weight, italic] of cases) {
      test(raw, () => {
        const p = parseFontName(raw);
        assert.equal(p.family, family);
        assert.equal(p.weight, weight);
        assert.equal(p.italic, italic);
      });
    }
  });

  test('longest weight token wins', () => {
    assert.equal(parseFontName('Foo-SemiBold').weight, 600);
    assert.equal(parseFontName('Foo-ExtraBold').weight, 800);
    assert.equal(parseFontName('Foo-ExtraLight').weight, 200);
  });

  test('descriptor Flags bitfield', () => {
    const f = parseDescriptorFlags(0x40000 | 0x40 | 0x2);
    assert.ok(f.serif && f.italic && f.forceBold);
    assert.equal(f.script, false);
    assert.equal(parseDescriptorFlags(32).nonSymbolic, true);
    assert.equal(parseDescriptorFlags(0).italic, false);
  });

  test('descriptor outranks a name that omits the style', () => {
    const r = createFontRecord({ key: 'g_d0_f3', baseFont: 'ZOYKBO+Gotham-Light', flags: 32, italicAngle: -12 });
    assert.equal(r.italic, true, 'italicAngle must imply italic');
    assert.equal(r.isSubset, true);
    assert.equal(r.label(), 'Gotham Light Italic');
  });

  test('embedded face is preferred, substitute always stacked behind it', () => {
    const r = createFontRecord({ key: 'g_d0_f8', baseFont: 'MBIPOF+Gotham-Bold' });
    const css = r.cssFont(16);
    assert.ok(css.includes('"g_d0_f8"'), 'embedded face missing');
    assert.ok(css.includes('Montserrat'), 'metric-matched substitute missing');
    assert.ok(!r.cssFont(16, { forceSubstitute: true }).includes('g_d0_f8'));
  });

  test('cssFontParts never emits the shorthand (it resets line-height)', () => {
    const parts = createFontRecord({ key: 'k', baseFont: 'Foo-Bold' }).cssFontParts(16);
    assert.deepEqual(Object.keys(parts).sort(), ['fontFamily','fontSize','fontStyle','fontWeight']);
    assert.equal(parts.font, undefined);
    assert.equal(parts.fontWeight, 700);
  });

  describe('glyph coverage', () => {
    test('unknown coverage returns null, never a false "no"', () => {
      assert.equal(createFontRecord({ key: 'k', baseFont: 'Foo' }).canRender('Y'), null);
    });
    test('the SURGER-box case: missing glyph reports false', () => {
      const r = createFontRecord({
        key: 'k', baseFont: 'Foo',
        coverage: new Set([83, 85, 82, 71, 69]),
        toUnicode: new Map([[83,'S'],[85,'U'],[82,'R'],[71,'G'],[69,'E'],[89,'Y']]),
      });
      assert.equal(r.canRender('S'), true);
      assert.equal(r.canRender('Y'), false);
      assert.equal(r.canRender('中'), false);
    });
  });

  test('substitution stacks respect descriptor flags', () => {
    assert.match(substituteStack('Unknown', { serif: true }), /serif/);
    assert.match(substituteStack('Unknown', { fixedPitch: true }), /monospace/);
    assert.match(substituteStack('Unknown', {}), /sans-serif/);
  });
});
