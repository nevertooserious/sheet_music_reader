import type { ClefKind } from '../core/types';
import type { ClassifiedGlyph, GlyphPlacement, MusicGlyph } from './model';
import { classifySonata } from './sonata';

const DIGIT_NAMES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

function clefFromLetter(letter: string): ClefKind {
  switch (letter) {
    case 'G':
    case 'GG':
    case 'tenorG':
      return 'treble';
    case 'F':
      return 'bass';
    case 'C':
    case 'varC':
      return 'alto';
    case 'percussion':
    case 'varpercussion':
    case 'tab':
      return 'percussion';
    default:
      return 'unknown';
  }
}

/** Emmentaler / Feta glyph names (LilyPond, Gonville). */
export function classifyEmmentaler(name: string): MusicGlyph | undefined {
  let m = /^noteheads\.([sud])(M?\d)/.exec(name);
  if (m) {
    const code = m[2];
    if (code.startsWith('M')) return { kind: 'notehead', head: 'breve' };
    const n = Number(code);
    return { kind: 'notehead', head: n === 0 ? 'whole' : n === 1 ? 'half' : 'black' };
  }
  m = /^clefs\.([A-Za-z]+?)(_change)?$/.exec(name);
  if (m) return { kind: 'clef', clef: clefFromLetter(m[1]), clefOctave: 0 };
  if (name.startsWith('accidentals.')) {
    const rest = name.slice('accidentals.'.length);
    if (/paren/.test(rest)) return { kind: 'other' };
    if (rest.startsWith('doublesharp')) return { kind: 'accidental', accidental: 2 };
    if (rest.startsWith('flatflat')) return { kind: 'accidental', accidental: -2 };
    if (rest.startsWith('sharp')) return { kind: 'accidental', accidental: 1 };
    if (rest.startsWith('flat')) return { kind: 'accidental', accidental: -1 };
    if (rest.startsWith('natural')) return { kind: 'accidental', accidental: 0 };
    return { kind: 'other' };
  }
  m = /^rests\.(M?\d)o?$/.exec(name);
  if (m) {
    const code = m[1];
    const restQn = code.startsWith('M') ? 4 * Math.pow(2, Number(code.slice(1))) : 4 / Math.pow(2, Number(code));
    return { kind: 'rest', restQn };
  }
  m = /^flags\.([ud])(\d)$/.exec(name);
  if (m) return { kind: 'flag', flags: Math.max(1, Number(m[2]) - 2) };
  if (name.startsWith('flags.')) return { kind: 'other' };
  if (name === 'dots.dot') return { kind: 'dot' };
  if (name in DIGIT_NAMES) return { kind: 'digit', digit: DIGIT_NAMES[name] };
  m = /^timesig\.C(\d)(\d)$/.exec(name);
  if (m) return { kind: 'timesig', timesig: [Number(m[1]), Number(m[2])] };
  if (name.startsWith('scripts.')) return { kind: 'ornament' };
  if (name.startsWith('brace')) return { kind: 'brace' };
  return { kind: 'other' };
}

const SMUFL: Record<number, MusicGlyph> = {
  0xe000: { kind: 'brace' },
  0xe002: { kind: 'brace' },
  0xe030: { kind: 'barline', barline: 'single' },
  0xe031: { kind: 'barline', barline: 'double' },
  0xe032: { kind: 'barline', barline: 'final' },
  0xe040: { kind: 'barline', barline: 'repeatStart' },
  0xe041: { kind: 'barline', barline: 'repeatEnd' },
  0xe042: { kind: 'barline', barline: 'repeatBoth' },
  0xe043: { kind: 'dot' },
  0xe044: { kind: 'dot' },
  0xe050: { kind: 'clef', clef: 'treble', clefOctave: 0 },
  0xe051: { kind: 'clef', clef: 'treble', clefOctave: -2 },
  0xe052: { kind: 'clef', clef: 'treble', clefOctave: -1 },
  0xe053: { kind: 'clef', clef: 'treble', clefOctave: 1 },
  0xe054: { kind: 'clef', clef: 'treble', clefOctave: 2 },
  0xe05c: { kind: 'clef', clef: 'alto', clefOctave: 0 },
  0xe05d: { kind: 'clef', clef: 'alto', clefOctave: -1 },
  0xe062: { kind: 'clef', clef: 'bass', clefOctave: 0 },
  0xe063: { kind: 'clef', clef: 'bass', clefOctave: -2 },
  0xe064: { kind: 'clef', clef: 'bass', clefOctave: -1 },
  0xe065: { kind: 'clef', clef: 'bass', clefOctave: 1 },
  0xe066: { kind: 'clef', clef: 'bass', clefOctave: 2 },
  0xe069: { kind: 'clef', clef: 'percussion', clefOctave: 0 },
  0xe06a: { kind: 'clef', clef: 'percussion', clefOctave: 0 },
  0xe07a: { kind: 'clef', clef: 'treble', clefOctave: 0 },
  0xe07b: { kind: 'clef', clef: 'alto', clefOctave: 0 },
  0xe07c: { kind: 'clef', clef: 'bass', clefOctave: 0 },
  0xe08a: { kind: 'timesig', timesig: [4, 4] },
  0xe08b: { kind: 'timesig', timesig: [2, 2] },
  0xe0a0: { kind: 'notehead', head: 'breve' },
  0xe0a1: { kind: 'notehead', head: 'breve' },
  0xe0a2: { kind: 'notehead', head: 'whole' },
  0xe0a3: { kind: 'notehead', head: 'half' },
  0xe0a4: { kind: 'notehead', head: 'black' },
  0xe0a9: { kind: 'notehead', head: 'black' },
  0xe0d9: { kind: 'notehead', head: 'black' },
  0xe0db: { kind: 'notehead', head: 'half' },
  0xe0dc: { kind: 'notehead', head: 'whole' },
  0xe1e7: { kind: 'dot' },
  0xe240: { kind: 'flag', flags: 1 },
  0xe241: { kind: 'flag', flags: 1 },
  0xe242: { kind: 'flag', flags: 2 },
  0xe243: { kind: 'flag', flags: 2 },
  0xe244: { kind: 'flag', flags: 3 },
  0xe245: { kind: 'flag', flags: 3 },
  0xe246: { kind: 'flag', flags: 4 },
  0xe247: { kind: 'flag', flags: 4 },
  0xe248: { kind: 'flag', flags: 5 },
  0xe249: { kind: 'flag', flags: 5 },
  0xe260: { kind: 'accidental', accidental: -1 },
  0xe261: { kind: 'accidental', accidental: 0 },
  0xe262: { kind: 'accidental', accidental: 1 },
  0xe263: { kind: 'accidental', accidental: 2 },
  0xe264: { kind: 'accidental', accidental: -2 },
  0xe265: { kind: 'accidental', accidental: 3 },
  0xe266: { kind: 'accidental', accidental: -3 },
  0xe267: { kind: 'accidental', accidental: -1 },
  0xe268: { kind: 'accidental', accidental: 1 },
  0xe269: { kind: 'accidental', accidental: 2 },
  0xe4e2: { kind: 'rest', restQn: 8 },
  0xe4e3: { kind: 'rest', restQn: 4 },
  0xe4e4: { kind: 'rest', restQn: 2 },
  0xe4e5: { kind: 'rest', restQn: 1 },
  0xe4e6: { kind: 'rest', restQn: 0.5 },
  0xe4e7: { kind: 'rest', restQn: 0.25 },
  0xe4e8: { kind: 'rest', restQn: 0.125 },
  0xe4e9: { kind: 'rest', restQn: 0.0625 },
  0xe4ea: { kind: 'rest', restQn: 0.03125 },
};

/**
 * SMuFL reserves U+F400-U+F8FF for glyphs each font defines itself, so a code
 * in it only means something once the font is known. Dorico's Bravura exports
 * report every notehead here rather than at its canonical U+E0Ax code, which
 * otherwise leaves a score with no noteheads at all. Identified from the
 * advances Bravura gives these three glyphs (1.32 staff spaces for the black
 * and half heads, 1.84 for the wider whole head).
 */
const OPTIONAL_BY_FONT: Array<{ font: RegExp; codes: Record<number, MusicGlyph> }> = [
  {
    font: /^bravura/i,
    codes: {
      0xf4bc: { kind: 'notehead', head: 'whole' },
      0xf4bd: { kind: 'notehead', head: 'half' },
      0xf4be: { kind: 'notehead', head: 'black' },
    },
  },
];

/** A font-specific meaning for a code in SMuFL's optional-glyph area, if we know one. */
export function classifyOptional(fontName: string, codePoint: number): MusicGlyph | undefined {
  if (codePoint < 0xf400 || codePoint > 0xf8ff) return undefined;
  for (const entry of OPTIONAL_BY_FONT) if (entry.font.test(fontName)) return entry.codes[codePoint];
  return undefined;
}

/** SMuFL code points (Bravura, Leland, MScore, Petaluma, ...). */
export function classifySmufl(codePoint: number): MusicGlyph | undefined {
  if (codePoint >= 0xe080 && codePoint <= 0xe089) return { kind: 'digit', digit: codePoint - 0xe080 };
  if (codePoint >= 0xe880 && codePoint <= 0xe889) return { kind: 'tuplet', digit: codePoint - 0xe880 };
  if (codePoint >= 0xe566 && codePoint <= 0xe5ff) return { kind: 'ornament' };
  if (codePoint >= 0xe0a0 && codePoint <= 0xe0ff && !SMUFL[codePoint]) return { kind: 'notehead', head: 'black' };
  const hit = SMUFL[codePoint];
  if (hit) return hit;
  if (codePoint >= 0xe000 && codePoint <= 0xf8ff) return { kind: 'other' };
  return undefined;
}

export function classifyGlyph(glyph: GlyphPlacement): MusicGlyph | undefined {
  if (glyph.family === 'sonata') return classifySonata(glyph);
  if (glyph.family === 'emmentaler') {
    if (glyph.name) return classifyEmmentaler(glyph.name);
    return { kind: 'other' };
  }
  if (glyph.family === 'smufl' || glyph.family === 'legacy-music') {
    const cp = glyph.unicode && glyph.unicode.length ? glyph.unicode.codePointAt(0)! : -1;
    const optional = cp >= 0 ? classifyOptional(glyph.fontName, cp) : undefined;
    if (optional) return optional;
    const fromCode = cp >= 0 ? classifySmufl(cp) : undefined;
    if (fromCode) return fromCode;
    if (glyph.name) {
      const byName = classifyEmmentaler(glyph.name);
      if (byName && byName.kind !== 'other') return byName;
    }
    return { kind: 'other' };
  }
  return undefined;
}

export function classifyGlyphs(glyphs: GlyphPlacement[]): ClassifiedGlyph[] {
  const out: ClassifiedGlyph[] = [];
  for (const g of glyphs) {
    const music = classifyGlyph(g);
    if (music) out.push({ ...g, music });
  }
  return out;
}
