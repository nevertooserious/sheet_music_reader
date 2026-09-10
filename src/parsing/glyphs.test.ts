import { describe, expect, it } from 'vitest';
import { classifyEmmentaler, classifyGlyph, classifySmufl } from './glyphs';
import type { GlyphPlacement } from './model';

describe('glyph vocabulary adapters', () => {
  it('maps Emmentaler names', () => {
    expect(classifyEmmentaler('noteheads.s2')).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifyEmmentaler('noteheads.s1')).toEqual({ kind: 'notehead', head: 'half' });
    expect(classifyEmmentaler('noteheads.s0')).toEqual({ kind: 'notehead', head: 'whole' });
    expect(classifyEmmentaler('noteheads.sM1')).toEqual({ kind: 'notehead', head: 'breve' });
    expect(classifyEmmentaler('noteheads.u2')?.head).toBe('black');
    expect(classifyEmmentaler('clefs.G')).toEqual({ kind: 'clef', clef: 'treble', clefOctave: 0 });
    expect(classifyEmmentaler('clefs.F_change')?.clef).toBe('bass');
    expect(classifyEmmentaler('clefs.C')?.clef).toBe('alto');
    expect(classifyEmmentaler('clefs.percussion')?.clef).toBe('percussion');
    expect(classifyEmmentaler('accidentals.sharp')).toEqual({ kind: 'accidental', accidental: 1 });
    expect(classifyEmmentaler('accidentals.flat')?.accidental).toBe(-1);
    expect(classifyEmmentaler('accidentals.natural')?.accidental).toBe(0);
    expect(classifyEmmentaler('accidentals.doublesharp')?.accidental).toBe(2);
    expect(classifyEmmentaler('accidentals.flatflat')?.accidental).toBe(-2);
    expect(classifyEmmentaler('rests.0')).toEqual({ kind: 'rest', restQn: 4 });
    expect(classifyEmmentaler('rests.2')?.restQn).toBe(1);
    expect(classifyEmmentaler('rests.3')?.restQn).toBe(0.5);
    expect(classifyEmmentaler('rests.1o')?.restQn).toBe(2);
    expect(classifyEmmentaler('rests.M1')?.restQn).toBe(8);
    expect(classifyEmmentaler('flags.u3')).toEqual({ kind: 'flag', flags: 1 });
    expect(classifyEmmentaler('flags.d4')?.flags).toBe(2);
    expect(classifyEmmentaler('dots.dot')?.kind).toBe('dot');
    expect(classifyEmmentaler('three')).toEqual({ kind: 'digit', digit: 3 });
    expect(classifyEmmentaler('timesig.C44')?.timesig).toEqual([4, 4]);
    expect(classifyEmmentaler('scripts.mordent')?.kind).toBe('ornament');
    expect(classifyEmmentaler('brace178')?.kind).toBe('brace');
    expect(classifyEmmentaler('space')?.kind).toBe('other');
  });

  it('maps SMuFL code points', () => {
    expect(classifySmufl(0xe0a4)).toEqual({ kind: 'notehead', head: 'black' });
    expect(classifySmufl(0xe0a3)?.head).toBe('half');
    expect(classifySmufl(0xe0a2)?.head).toBe('whole');
    expect(classifySmufl(0xe050)?.clef).toBe('treble');
    expect(classifySmufl(0xe052)).toEqual({ kind: 'clef', clef: 'treble', clefOctave: -1 });
    expect(classifySmufl(0xe062)?.clef).toBe('bass');
    expect(classifySmufl(0xe262)?.accidental).toBe(1);
    expect(classifySmufl(0xe260)?.accidental).toBe(-1);
    expect(classifySmufl(0xe4e5)?.restQn).toBe(1);
    expect(classifySmufl(0xe4e6)?.restQn).toBe(0.5);
    expect(classifySmufl(0xe240)?.flags).toBe(1);
    expect(classifySmufl(0xe243)?.flags).toBe(2);
    expect(classifySmufl(0xe1e7)?.kind).toBe('dot');
    expect(classifySmufl(0xe083)).toEqual({ kind: 'digit', digit: 3 });
    expect(classifySmufl(0xe08a)?.timesig).toEqual([4, 4]);
    expect(classifySmufl(0xe041)?.barline).toBe('repeatEnd');
    expect(classifySmufl(0xe567)?.kind).toBe('ornament');
    expect(classifySmufl(0xe999)?.kind).toBe('other');
    expect(classifySmufl(0x41)).toBeUndefined();
  });

  it('classifies placements by font family', () => {
    const base: GlyphPlacement = { page: 0, fontId: 'f', fontName: 'Emmentaler-20', family: 'emmentaler', code: 1, x: 0, y: 0, advance: 5, size: 20 };
    expect(classifyGlyph({ ...base, name: 'noteheads.s2' })?.kind).toBe('notehead');
    expect(classifyGlyph({ ...base, name: undefined })?.kind).toBe('other');
    expect(classifyGlyph({ ...base, fontName: 'Bravura', family: 'smufl', unicode: '' })?.head).toBe('black');
    expect(classifyGlyph({ ...base, fontName: 'Bravura', family: 'smufl', unicode: 'x', name: 'noteheads.s1' })?.head).toBe('half');
    expect(classifyGlyph({ ...base, fontName: 'Times', family: 'text', unicode: 'A' })).toBeUndefined();
  });
});
