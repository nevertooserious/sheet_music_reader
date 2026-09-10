import { describe, expect, it } from 'vitest';
import { AccidentalMemory, degreeOf, diatonicToMidi, keyAlteration, pitchLabel, stepToDiatonic, stepToMidi, yToStep } from './pitch';

describe('pitch math', () => {
  it('maps staff steps to MIDI for each clef', () => {
    expect(stepToMidi(0, 'treble', 0)).toBe(71); // B4 on the middle line
    expect(stepToMidi(-6, 'treble', 0)).toBe(60); // C4 one step below the bottom line
    expect(stepToMidi(6, 'treble', 0)).toBe(81); // A5
    expect(stepToMidi(0, 'bass', 0)).toBe(50); // D3
    expect(stepToMidi(-4, 'bass', 0)).toBe(43); // G2 bottom line
    expect(stepToMidi(0, 'alto', 0)).toBe(60); // C4
    expect(stepToMidi(0, 'tenor', 0)).toBe(57); // A3
    expect(stepToMidi(0, 'unknown', 0)).toBe(71);
  });

  it('applies octave clefs', () => {
    expect(stepToMidi(0, 'treble', 0, undefined, -1)).toBe(59);
    expect(stepToMidi(0, 'bass', 0, undefined, 1)).toBe(62);
  });

  it('applies key signatures by degree', () => {
    expect(keyAlteration(1, 3)).toBe(1); // G major: F#
    expect(keyAlteration(1, 0)).toBe(0);
    expect(keyAlteration(2, 0)).toBe(1); // D major: C#
    expect(keyAlteration(-1, 6)).toBe(-1); // F major: Bb
    expect(keyAlteration(-3, 5)).toBe(-1); // Eb major: Ab
    expect(keyAlteration(0, 3)).toBe(0);
    expect(stepToMidi(4, 'treble', 1)).toBe(78); // F#5 in G major
    expect(stepToMidi(4, 'treble', 1, 0)).toBe(77); // explicit natural wins
  });

  it('remembers explicit accidentals for the rest of the measure', () => {
    const memory = new AccidentalMemory(1);
    const f5 = stepToDiatonic(4, 'treble');
    expect(memory.resolve(f5, undefined)).toBe(1);
    expect(memory.resolve(f5, 0)).toBe(0);
    expect(memory.resolve(f5, undefined)).toBe(0);
    expect(memory.resolve(f5 - 7, undefined)).toBe(1); // other octave unaffected
    memory.startMeasure();
    expect(memory.resolve(f5, undefined)).toBe(1);
    expect(memory.resolve(stepToDiatonic(1, 'bass'), 1)).toBe(1);
  });

  it('labels pitches', () => {
    expect(pitchLabel(stepToDiatonic(4, 'treble'), 1)).toBe('F#5');
    expect(pitchLabel(stepToDiatonic(0, 'bass'), 0)).toBe('D3');
    expect(pitchLabel(stepToDiatonic(-1, 'treble'), -1)).toBe('Ab4');
    expect(degreeOf(-1)).toBe(6);
    expect(diatonicToMidi(35)).toBe(72);
  });

  it('converts y to half-space steps around the middle line', () => {
    expect(yToStep(100, 100, 6)).toBe(0);
    expect(yToStep(97, 100, 6)).toBe(1);
    expect(yToStep(106.2, 100, 6)).toBe(-2);
  });
});
