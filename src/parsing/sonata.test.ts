import { describe, expect, it } from 'vitest';
import { classifyFontFamily } from './extract';
import { classifyGlyph } from './glyphs';
import type { GlyphPlacement } from './model';
import { classifySonataCode, sonataCode, sonataFamily, sonataVariant, MAC_ROMAN_NAMES } from './sonata';

function glyph(over: Partial<GlyphPlacement>): GlyphPlacement {
  return {
    page: 0,
    fontId: 'f1',
    fontName: 'OpusStd',
    family: 'sonata',
    code: 0,
    x: 0,
    y: 0,
    advance: 5,
    size: 20,
    ...over,
  };
}

describe('font family detection for Sonata-layout fonts', () => {
  it('recognises the Sibelius families and their replacements', () => {
    for (const name of ['Opus', 'OpusStd', 'OpusSpecial', 'OpusSpecialStd', 'OpusSpecialExtraStd', 'Inkpen2Std', 'Inkpen2SpecialStd', 'HelsinkiStd', 'RepriseStd', 'NorfolkStd', 'NorfolkSpecialStd', 'PoriStd', 'LelandiaStd']) {
      expect(classifyFontFamily(name), name).toBe('sonata');
    }
  });

  it('recognises the Finale legacy fonts', () => {
    for (const name of ['Maestro', 'MaestroWide', 'Sonata', 'Petrucci', 'EngraverFontSet', 'Jazz']) expect(classifyFontFamily(name), name).toBe('sonata');
  });

  it('treats companion text/chord fonts as text and keeps SMuFL detection first', () => {
    for (const name of ['OpusTextStd', 'OpusChordsStd', 'OpusPercussionStd', 'OpusMetronomeStd', 'OpusFiguredBassStd', 'OpusRomanChordsStd', 'OpusFunctionSymbolsStd', 'OpusNoteNamesStd', 'OpusOrnamentsStd', 'NorfolkHarpStd', 'NorfolkSpecialIIStd', 'Inkpen2ChordsStd', 'RepriseScriptStd', 'JazzText']) {
      expect(classifyFontFamily(name), name).toBe('text');
    }
    expect(classifyFontFamily('FinaleMaestro')).toBe('smufl');
    expect(classifyFontFamily('Emmentaler-20')).toBe('emmentaler');
    expect(classifyFontFamily('MusiSync')).toBe('legacy-music');
  });

  it('does not mistake look-alike text fonts for music fonts', () => {
    for (const name of ['EngraversMT', 'Engravers MT', 'EngraversGothicBT', 'EngraversOldEnglishMT', 'MaestroTimes', 'RepriseTitleStd', 'RepriseStampStd', 'RepriseRehearsalStd', 'JazzCord', 'JazzPerc', 'Jazz LET', 'Sonatina', 'Opusculum']) {
      expect(sonataFamily(name), name).toBeUndefined();
      expect(classifyFontFamily(name), name).toBe('text');
    }
    expect(sonataFamily('NorfolkTabStd')).toBe('ignore');
    expect(sonataFamily('EngraverFontSet')).toBe('main');
    expect(sonataFamily('Opus-Regular')).toBe('main');
    expect(sonataFamily('Golden Age')).toBe('main');
  });

  it('picks the glyph table from the font name', () => {
    expect(sonataVariant('OpusStd')).toBe('main');
    expect(sonataVariant('Opus Special Std')).toBe('special');
    expect(sonataVariant('OpusSpecialStd')).toBe('special');
    expect(sonataVariant('OpusSpecialExtraStd')).toBe('specialExtra');
    expect(sonataVariant('NorfolkSpecialIIStd')).toBe('ignore');
    expect(sonataVariant('OpusTextStd')).toBe('ignore');
  });
});

describe('recovering the original Sonata code', () => {
  it('reads uniF0XX glyph names (Sibelius Opus Type1 subsets)', () => {
    expect(sonataCode(glyph({ code: 2, name: 'uniF0CF' }))).toBe(0xcf);
    expect(sonataCode(glyph({ code: 5, name: 'uniF026' }))).toBe(0x26);
    expect(sonataCode(glyph({ code: 9, name: 'uni00FA' }))).toBe(0xfa);
  });

  it('reads MacRoman glyph names from a re-encoded Differences array', () => {
    expect(MAC_ROMAN_NAMES[0xcf]).toBe('oe');
    expect(sonataCode(glyph({ code: 0x9c, name: 'oe', nameFromDifferences: true }))).toBe(0xcf);
    expect(sonataCode(glyph({ code: 0x1b, name: 'dotaccent', nameFromDifferences: true }))).toBe(0xfa);
    expect(sonataCode(glyph({ code: 0xbf, name: 'questiondown', nameFromDifferences: true }))).toBe(0xc0);
    expect(sonataCode(glyph({ code: 0x91, name: 'quotesinglbase', nameFromDifferences: true }))).toBe(0xe2);
    expect(sonataCode(glyph({ code: 0x02, name: 'summation', nameFromDifferences: true }))).toBe(0xb7);
    expect(sonataCode(glyph({ code: 0x23, name: 'numbersign', nameFromDifferences: true }))).toBe(0x23);
  });

  it('prefers the raw byte for symbolic TrueType fonts and PUA code points for cmap(3,0) fonts', () => {
    expect(sonataCode(glyph({ code: 0xcf, name: 'caron', fontType: 'TrueType' }))).toBe(0xcf);
    expect(sonataCode(glyph({ code: 0xcf, unicode: '', fontType: 'TrueType' }))).toBe(0xcf);
    expect(sonataCode(glyph({ code: 3, unicode: '', fontType: 'CIDFontType2' }))).toBe(0xfa);
  });

  it('falls back to MacRoman characters and then to the byte', () => {
    expect(sonataCode(glyph({ code: 7, unicode: '\u0153' }))).toBe(0xcf); // oe ligature, MacRoman 0xCF
    expect(sonataCode(glyph({ code: 7, unicode: '\u02d9' }))).toBe(0xfa); // dot above, MacRoman 0xFA
    expect(sonataCode(glyph({ code: 0x26, unicode: '&' }))).toBe(0x26);
    expect(sonataCode(glyph({ code: 0xee }))).toBe(0xee);
  });
});

describe('Sonata / Opus main table', () => {
  it('maps the core notation glyphs', () => {
    expect(classifySonataCode(0xcf, 'main')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0xfa, 'main')).toEqual({ kind: 'notehead', head: 'half' });
    expect(classifySonataCode(0x77, 'main')).toEqual({ kind: 'notehead', head: 'whole' });
    expect(classifySonataCode(0x57, 'main')).toEqual({ kind: 'notehead', head: 'breve' });
    expect(classifySonataCode(0x26, 'main')).toEqual({ kind: 'clef', clef: 'treble', clefOctave: 0 });
    expect(classifySonataCode(0x3f, 'main')).toEqual({ kind: 'clef', clef: 'bass', clefOctave: 0 });
    expect(classifySonataCode(0x42, 'main')).toEqual({ kind: 'clef', clef: 'alto', clefOctave: 0 });
    expect(classifySonataCode(0x56, 'main')).toEqual({ kind: 'clef', clef: 'treble', clefOctave: -1 });
    expect(classifySonataCode(0x23, 'main')).toEqual({ kind: 'accidental', accidental: 1 });
    expect(classifySonataCode(0x62, 'main')).toEqual({ kind: 'accidental', accidental: -1 });
    expect(classifySonataCode(0x6e, 'main')).toEqual({ kind: 'accidental', accidental: 0 });
    expect(classifySonataCode(0xdc, 'main')).toEqual({ kind: 'accidental', accidental: 2 });
    expect(classifySonataCode(0xba, 'main')).toEqual({ kind: 'accidental', accidental: -2 });
    expect(classifySonataCode(0xb7, 'main')).toEqual({ kind: 'rest', restQn: 4 });
    expect(classifySonataCode(0xee, 'main')).toEqual({ kind: 'rest', restQn: 2 });
    expect(classifySonataCode(0xce, 'main')).toEqual({ kind: 'rest', restQn: 1 });
    expect(classifySonataCode(0xe4, 'main')).toEqual({ kind: 'rest', restQn: 0.5 });
    expect(classifySonataCode(0xc5, 'main')).toEqual({ kind: 'rest', restQn: 0.25 });
    expect(classifySonataCode(0x6a, 'main')).toEqual({ kind: 'flag', flags: 1 });
    expect(classifySonataCode(0x4a, 'main')).toEqual({ kind: 'flag', flags: 1 });
    expect(classifySonataCode(0x72, 'main')).toEqual({ kind: 'flag', flags: 2 });
    expect(classifySonataCode(0x2e, 'main')).toEqual({ kind: 'dot' });
    expect(classifySonataCode(0x34, 'main')).toEqual({ kind: 'digit', digit: 4 });
    expect(classifySonataCode(0x63, 'main')).toEqual({ kind: 'timesig', timesig: [4, 4] });
    expect(classifySonataCode(0xa3, 'main')).toEqual({ kind: 'tuplet', digit: 3 });
    expect(classifySonataCode(0xc0, 'main')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0x66, 'main')).toEqual({ kind: 'other' });
  });

  it('maps Opus Special notehead styles', () => {
    expect(classifySonataCode(0x65, 'special')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0x45, 'special')).toEqual({ kind: 'notehead', head: 'half' });
    expect(classifySonataCode(0x67, 'special')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0x31, 'special')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0x21, 'special')).toEqual({ kind: 'notehead', head: 'half' });
    expect(classifySonataCode(0x59, 'special')).toEqual({ kind: 'notehead', head: 'half' });
    expect(classifySonataCode(0x7b, 'special')).toEqual({ kind: 'brace' });
    expect(classifySonataCode(0xaa, 'special')).toEqual({ kind: 'dot' });
    expect(classifySonataCode(0xdc, 'special')).toEqual({ kind: 'clefOctave', digit: 8 });
    expect(classifySonataCode(0xdd, 'special')).toEqual({ kind: 'clefOctave', digit: 15 });
    expect(classifySonataCode(0x56, 'special')).toEqual({ kind: 'other' });
    expect(classifySonataCode(0x3f, 'special')).toEqual({ kind: 'other' });
    expect(classifySonataCode(0x66, 'specialExtra')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySonataCode(0xcf, 'ignore')).toEqual({ kind: 'other' });
  });

  it('classifies whole glyph placements through classifyGlyph', () => {
    expect(classifyGlyph(glyph({ fontName: 'OpusStd', code: 0x9c, name: 'oe', nameFromDifferences: true, fontType: 'Type1' }))).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifyGlyph(glyph({ fontName: 'OpusSpecialStd', code: 0x65, name: 'e', nameFromDifferences: true, fontType: 'Type1' }))).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifyGlyph(glyph({ fontName: 'Maestro', code: 0xce, fontType: 'TrueType' }))).toEqual({ kind: 'rest', restQn: 1 });
    expect(classifyGlyph(glyph({ fontName: 'Inkpen2Std', code: 0x26, unicode: '&', fontType: 'Type1' }))).toEqual({ kind: 'clef', clef: 'treble', clefOctave: 0 });
  });
});
