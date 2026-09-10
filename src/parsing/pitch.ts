import type { ClefKind } from '../core/types';

const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const DEGREE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/** Diatonic number of the middle staff line: octave × 7 + degree (C = 0 … B = 6). */
export function middleLineDiatonic(clef: ClefKind, clefOctave = 0): number {
  let d: number;
  switch (clef) {
    case 'bass':
      d = 3 * 7 + 1;
      break;
    case 'alto':
      d = 4 * 7 + 0;
      break;
    case 'tenor':
      d = 3 * 7 + 5;
      break;
    default:
      d = 4 * 7 + 6;
  }
  return d + 7 * clefOctave;
}

/**
 * Step = half-spaces above the middle line (negative below). `clefShift` is how
 * many half-spaces the clef sits above its standard line (soprano, mezzo,
 * baritone, French violin, sub-bass clefs); 0 for the usual positions.
 */
export function stepToDiatonic(step: number, clef: ClefKind, clefOctave = 0, clefShift = 0): number {
  return middleLineDiatonic(clef, clefOctave) - clefShift + step;
}

export function diatonicToMidi(diatonic: number, alteration = 0): number {
  const octave = Math.floor(diatonic / 7);
  const degree = diatonic - octave * 7;
  return 12 * (octave + 1) + DEGREE_SEMITONES[degree] + alteration;
}

export function degreeOf(diatonic: number): number {
  return ((diatonic % 7) + 7) % 7;
}

/** Alteration the key signature applies to a scale degree (C = 0 … B = 6). */
export function keyAlteration(fifths: number, degree: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, Math.min(7, fifths)).includes(degree) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, Math.min(7, -fifths)).includes(degree) ? -1 : 0;
  return 0;
}

export function pitchLabel(diatonic: number, alteration: number): string {
  const octave = Math.floor(diatonic / 7);
  const acc = alteration > 0 ? '#'.repeat(alteration) : alteration < 0 ? 'b'.repeat(-alteration) : '';
  return `${DEGREE_NAMES[degreeOf(diatonic)]}${acc}${octave}`;
}

/** Vertical staff position of a point in half-spaces above the middle line. */
export function yToStep(y: number, middleY: number, space: number): number {
  return Math.round((middleY - y) / (space / 2));
}

/** Accidentals apply to the rest of the measure for the same written pitch. */
export class AccidentalMemory {
  private readonly explicit = new Map<number, number>();

  constructor(private fifths: number) {}

  setKey(fifths: number): void {
    this.fifths = fifths;
    this.explicit.clear();
  }

  startMeasure(): void {
    this.explicit.clear();
  }

  /** Resolve the alteration for a written pitch, recording an explicit accidental when given. */
  resolve(diatonic: number, explicit: number | undefined): number {
    if (explicit !== undefined) {
      this.explicit.set(diatonic, explicit);
      return explicit;
    }
    const remembered = this.explicit.get(diatonic);
    if (remembered !== undefined) return remembered;
    return keyAlteration(this.fifths, degreeOf(diatonic));
  }
}

/** Convenience for tests and labels: staff step + clef + key (+ explicit accidental) → MIDI. */
export function stepToMidi(
  step: number,
  clef: ClefKind,
  fifths: number,
  explicit?: number,
  clefOctave = 0,
): number {
  const d = stepToDiatonic(step, clef, clefOctave);
  const alt = explicit !== undefined ? explicit : keyAlteration(fifths, degreeOf(d));
  return diatonicToMidi(d, alt);
}
