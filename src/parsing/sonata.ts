import type { GlyphPlacement, MusicGlyph } from './model';

/**
 * Legacy (pre-SMuFL) music fonts that follow the Adobe Sonata keyboard layout:
 * Sibelius' Opus / Inkpen2 / Helsinki / Reprise families and their third-party
 * replacements (Norfolk, Pori, Lelandia), plus Finale's Maestro / Petrucci /
 * Engraver / Jazz and Sonata itself. Glyphs are identified by their original
 * 8-bit code. PDF producers frequently re-encode these fonts, so the code is
 * recovered from, in order of reliability: a `uniF0XX` glyph name, a MacRoman
 * glyph name from a Differences array, a Private Use Area code point, a
 * MacRoman character, and finally the raw byte.
 *
 * Evidence: Sibelius 8 Reference Guide (Avid), whose embedded OpusStd /
 * OpusSpecialStd subsets name every glyph after the MacRoman character of its
 * original code, and the "4.12 Noteheads" catalogue on its page 365; Finale's
 * Maestro character map for the Sonata-compatible core.
 */

export type SonataVariant = 'main' | 'special' | 'specialExtra' | 'ignore';

export const MAC_ROMAN_NAMES: readonly string[] = [
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  'space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft', 'parenright',
  'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'bracketleft', 'backslash',
  'bracketright', 'asciicircum', 'underscore', 'grave', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
  'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'braceleft', 'bar', 'braceright', 'asciitilde', '',
  'Adieresis', 'Aring', 'Ccedilla', 'Eacute', 'Ntilde', 'Odieresis', 'Udieresis', 'aacute', 'agrave', 'acircumflex',
  'adieresis', 'atilde', 'aring', 'ccedilla', 'eacute', 'egrave', 'ecircumflex', 'edieresis', 'iacute', 'igrave',
  'icircumflex', 'idieresis', 'ntilde', 'oacute', 'ograve', 'ocircumflex', 'odieresis', 'otilde', 'uacute', 'ugrave',
  'ucircumflex', 'udieresis', 'dagger', 'degree', 'cent', 'sterling', 'section', 'bullet', 'paragraph', 'germandbls',
  'registered', 'copyright', 'trademark', 'acute', 'dieresis', 'notequal', 'AE', 'Oslash', 'infinity', 'plusminus',
  'lessequal', 'greaterequal', 'yen', 'mu', 'partialdiff', 'summation', 'product', 'pi', 'integral', 'ordfeminine',
  'ordmasculine', 'Omega', 'ae', 'oslash', 'questiondown', 'exclamdown', 'logicalnot', 'radical', 'florin', 'approxequal',
  'Delta', 'guillemotleft', 'guillemotright', 'ellipsis', 'space', 'Agrave', 'Atilde', 'Otilde', 'OE', 'oe', 'endash',
  'emdash', 'quotedblleft', 'quotedblright', 'quoteleft', 'quoteright', 'divide', 'lozenge', 'ydieresis', 'Ydieresis',
  'fraction', 'currency', 'guilsinglleft', 'guilsinglright', 'fi', 'fl', 'daggerdbl', 'periodcentered', 'quotesinglbase',
  'quotedblbase', 'perthousand', 'Acircumflex', 'Ecircumflex', 'Aacute', 'Edieresis', 'Egrave', 'Iacute', 'Icircumflex',
  'Idieresis', 'Igrave', 'Oacute', 'Ocircumflex', 'apple', 'Ograve', 'Uacute', 'Ucircumflex', 'Ugrave', 'dotlessi',
  'circumflex', 'tilde', 'macron', 'breve', 'dotaccent', 'ring', 'cedilla', 'hungarumlaut', 'ogonek', 'caron',
];

const MAC_ROMAN_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

const NAME_TO_CODE = new Map<string, number>();
MAC_ROMAN_NAMES.forEach((name, code) => {
  if (name && !NAME_TO_CODE.has(name)) NAME_TO_CODE.set(name, code);
});
const UNICODE_TO_CODE = new Map<number, number>();
[...MAC_ROMAN_HIGH].forEach((ch, i) => {
  if (!UNICODE_TO_CODE.has(ch.codePointAt(0)!)) UNICODE_TO_CODE.set(ch.codePointAt(0)!, 0x80 + i);
});

const FAMILY = /^(opus|inkpen2?|helsinki|reprise|norfolk|pori|lelandia|maestro|sonata|petrucci|engraver|jazz|seville|ghent|goldenage|toccata|fughetta)/;
const SUFFIXES =
  /^(?:std|specialextra|specialii|special|text|plainchords|chords|sans|condensed|percussion|metronome|figuredbass|figured|romanchords|roman|functionsymbols|function|notenames|ornaments|harp|bigtime|japanese|script|wide|fontset|tab|asc|asl|regular|bold|italic|medium|\d+)*$/;
const IGNORED_VARIANT =
  /specialii|text|chords|percussion|metronome|figured|roman|function|notenames|ornaments|harp|bigtime|japanese|script|tab|asc|asl/;

function normalise(fontName: string): string {
  return fontName.toLowerCase().replace(/[\s_\-.,]/g, '');
}

/**
 * The glyph table for a font of one of the Sonata-layout families, 'ignore'
 * for their text-like companions (Opus Text, Opus Chords, ...), or undefined
 * for fonts outside the families (including look-alikes such as Engravers MT,
 * Maestro Times or Reprise Title).
 */
export function sonataFamily(fontName: string): SonataVariant | undefined {
  const name = normalise(fontName);
  const m = FAMILY.exec(name);
  if (!m) return undefined;
  const rest = name.slice(m[0].length);
  if (!SUFFIXES.test(rest)) return undefined;
  return sonataVariant(rest);
}

/** Which glyph table applies, judged from the name's suffix tokens. */
export function sonataVariant(fontName: string): SonataVariant {
  const name = normalise(fontName).replace(FAMILY, '');
  if (IGNORED_VARIANT.test(name)) return 'ignore';
  if (/specialextra/.test(name)) return 'specialExtra';
  if (/special/.test(name)) return 'special';
  return 'main';
}

/** Recovers the original 8-bit Sonata-layout code of a glyph, or undefined when nothing is known. */
export function sonataCode(glyph: Pick<GlyphPlacement, 'code' | 'name' | 'unicode' | 'nameFromDifferences' | 'fontType'>): number | undefined {
  const name = glyph.name ?? '';
  const uni = /^uni(?:F0|00)?([0-9A-F]{2})$/i.exec(name);
  if (uni) return parseInt(uni[1], 16);
  const named = name ? NAME_TO_CODE.get(name) : undefined;
  if (glyph.nameFromDifferences && named !== undefined) return named;
  const cp = glyph.unicode && glyph.unicode.length ? glyph.unicode.codePointAt(0)! : -1;
  if (cp >= 0xf000 && cp <= 0xf0ff) return cp - 0xf000;
  const type = (glyph.fontType ?? '').toLowerCase();
  // Simple TrueType/OpenType fonts keep the original byte as the code; CID-keyed fonts expose glyph indices, which mean nothing here.
  const simpleTrueType = type === 'truetype' || type === 'opentype';
  const cidKeyed = type.startsWith('cid') || type.includes('type0');
  const byte = glyph.code >= 0 && glyph.code < 256 ? glyph.code : undefined;
  if (simpleTrueType && byte !== undefined) return byte;
  if (named !== undefined) return named;
  if (cp >= 0x20 && cp < 0x7f) return cp;
  const fromMac = cp >= 0 ? UNICODE_TO_CODE.get(cp) : undefined;
  if (fromMac !== undefined) return fromMac;
  return cidKeyed ? undefined : byte;
}

const black: MusicGlyph = { kind: 'notehead', head: 'black' };
const half: MusicGlyph = { kind: 'notehead', head: 'half' };
const whole: MusicGlyph = { kind: 'notehead', head: 'whole' };
const breve: MusicGlyph = { kind: 'notehead', head: 'breve' };
const other: MusicGlyph = { kind: 'other' };
const ornament: MusicGlyph = { kind: 'ornament' };
const rest = (restQn: number): MusicGlyph => ({ kind: 'rest', restQn });
const flag = (flags: number): MusicGlyph => ({ kind: 'flag', flags });
const acc = (accidental: number): MusicGlyph => ({ kind: 'accidental', accidental });
const clef = (c: MusicGlyph['clef'], clefOctave = 0): MusicGlyph => ({ kind: 'clef', clef: c, clefOctave });
const tuplet = (digit: number): MusicGlyph => ({ kind: 'tuplet', digit });

/** Sonata-layout core shared by Opus, Maestro and friends (keyed by original code). */
const MAIN: Record<number, MusicGlyph> = {
  0xcf: black, // quarter/eighth notehead (option-q)
  0xfa: half, // half notehead (option-h)
  0x77: whole, // w
  0x57: breve, // W
  0xdd: breve,
  0x71: black, // precomposed notes with stems
  0x51: black,
  0x65: black,
  0x45: black,
  0x78: black,
  0x58: black,
  0x68: half,
  0x48: half,
  0x3b: black, // grace notes
  0x3a: black,
  0xa9: black,
  0xed: black,
  0xc9: black,
  0xc0: black, // cross (non-pitched) notehead
  0xe2: black, // filled diamond
  0xe1: half, // diamond
  0x4f: black, // small white diamond (harmonic); Sibelius uses it for every duration
  0xd0: black, // filled square
  0xad: half, // square
  0xd1: black, // filled triangle
  0xe0: black, // filled inverted triangle
  0xc2: half, // inverted triangle
  0x4c: black, // left-facing triangle
  0xe7: black, // right-facing triangle
  0x59: black, // triangle / closed cymbal
  0xe3: rest(8),
  0xb7: rest(4),
  0xee: rest(2),
  0xce: rest(1),
  0xe4: rest(0.5),
  0xc5: rest(0.25),
  0xa8: rest(0.125),
  0xf4: rest(0.0625),
  0xe5: rest(0.03125),
  0x6a: flag(1), // j / J: single flag
  0x4a: flag(1),
  0x4b: flag(1), // second flag glyphs stack on the first
  0xef: flag(1),
  0xfb: flag(1),
  0xf0: flag(1),
  0x72: flag(2), // r / R: sixteenth flag pair
  0x52: flag(2),
  0x90: flag(2),
  0x23: acc(1),
  0x62: acc(-1),
  0x6e: acc(0),
  0xdc: acc(2),
  0xba: acc(-2),
  0x61: acc(1), // courtesy (parenthesised) accidentals
  0x41: acc(-1),
  0x4e: acc(0),
  0x81: acc(2),
  0x49: acc(1), // small accidentals
  0x69: acc(-1),
  0xe9: acc(0),
  0x5b: acc(1),
  0x7b: acc(-1),
  0xd2: acc(0),
  0x5d: acc(2),
  0xd3: acc(-2),
  0x26: clef('treble'),
  0xa0: clef('treble', 1),
  0x56: clef('treble', -1),
  0x42: clef('alto'),
  0x3f: clef('bass'),
  0xe6: clef('bass', 1),
  0x74: clef('bass', -1),
  0x2f: clef('percussion'),
  0xd6: clef('percussion'),
  0x63: { kind: 'timesig', timesig: [4, 4] },
  0x43: { kind: 'timesig', timesig: [2, 2] },
  0x2e: { kind: 'dot' },
  0x6b: { kind: 'dot' },
  0x5c: { kind: 'barline', barline: 'single' },
  0xf1: { kind: 'barline', barline: 'single' },
  0xc1: tuplet(1),
  0xaa: tuplet(2),
  0xa3: tuplet(3),
  0xa2: tuplet(4),
  0xb0: tuplet(5),
  0xa4: tuplet(6),
  0xa6: tuplet(7),
  0xa5: tuplet(8),
  0xbb: tuplet(9),
  0xbc: tuplet(0),
  0x54: ornament, // turn
  0x4d: ornament, // mordents
  0x6d: ornament,
  0xb5: ornament,
  0xd9: ornament, // trill
  0x7e: ornament, // trill extension
  0x55: ornament, // fermatas
  0x75: ornament,
  0x67: ornament, // arpeggio
};

/**
 * Opus Special (Sibelius): alternative notehead styles, read off the notehead
 * catalogue. Hollow shapes serve as both half and whole notes there, so they
 * are reported as 'half' and the stem logic decides the rest.
 */
const SPECIAL: Record<number, MusicGlyph> = {
  0x59: half, // cross in circle (half of styles 1 and 29)
  0x58: half, // cross with small circle (half of style 24)
  0x65: black, // small notehead (style 10)
  0x45: half,
  0x67: black, // slashed (style 11)
  0x47: half,
  0x68: black, // back-slashed (style 12)
  0x48: half,
  0x2d: black, // arrow down / inverted triangle (styles 13, 15)
  0x5f: half,
  0x31: black, // arrow up / shape-note triangle (styles 14, 16)
  0x21: half,
  0x32: black, // shape notes 17-19, 21-23
  0x40: half,
  0x33: black,
  0x23: half,
  0x34: black,
  0x24: half,
  0x36: black,
  0x29: half,
  0x37: black,
  0x26: half,
  0x38: black,
  0x2a: half,
  0x2b: half, // white diamond (beat half; large-cross half)
  0x56: other, // slash noteheads do not play back
  0x3f: other,
  0x55: other,
  0x7b: { kind: 'brace' },
  0xaa: { kind: 'dot' }, // augmentation, staccato and repeat dots
  0xdc: { kind: 'clefOctave', digit: 8 }, // the 8 of 8va / 8vb clefs, drawn separately at full size
  0xdd: { kind: 'clefOctave', digit: 15 },
};

/** Opus Special Extra: a handful of extra noteheads. */
const SPECIAL_EXTRA: Record<number, MusicGlyph> = {
  0x66: black, // ping (circle with dot)
  0xcc: other, // stick notation (headless)
};

export function classifySonataCode(code: number, variant: SonataVariant): MusicGlyph {
  if (variant === 'ignore') return other;
  if (variant === 'main') {
    if (code >= 0x30 && code <= 0x39) return { kind: 'digit', digit: code - 0x30 };
    return MAIN[code] ?? other;
  }
  const table = variant === 'special' ? SPECIAL : SPECIAL_EXTRA;
  return table[code] ?? other;
}

export function classifySonata(glyph: GlyphPlacement): MusicGlyph {
  const code = sonataCode(glyph);
  if (code === undefined) return other;
  return classifySonataCode(code, sonataVariant(glyph.fontName));
}
