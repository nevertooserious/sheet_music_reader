import { describe, expect, it } from 'vitest';
import type { NoteEvent, ScoreModel } from '../core/types';
import { compareScoreToReference, lcsLength, printedOrderNotes, type Reference } from './compare';

function score(): ScoreModel {
  const notes: NoteEvent[] = [];
  const passes = [0, 6];
  let n = 0;
  for (const pass of passes) {
    for (const [midi, start, dur, measure] of [
      [60, 0, 1, 0],
      [62, 1, 1, 0],
      [64, 2, 1, 0],
      [65, 3, 3, 1],
    ] as Array<[number, number, number, number]>) {
      notes.push({ id: `t1-${n++}`, trackId: 'track-1', midi, startQn: pass + start, durationQn: dur, velocity: 0.8, measure });
    }
  }
  return {
    source: { fileName: 'x.pdf', pageCount: 1, engine: 'vector' },
    tempoBpm: 100,
    tempoMarks: [],
    timeSignatures: [{ measure: 0, beats: 3, beatType: 4 }],
    keySignatures: [{ measure: 0, fifths: 0 }],
    measures: [
      { index: 0, durationQn: 3, layout: [], firstStartQn: 0 },
      { index: 1, durationQn: 3, layout: [], firstStartQn: 3, repeatEnd: true },
    ],
    timeline: [
      { measure: 0, startQn: 0, durationQn: 3 },
      { measure: 1, startQn: 3, durationQn: 3 },
      { measure: 0, startQn: 6, durationQn: 3 },
      { measure: 1, startQn: 9, durationQn: 3 },
    ],
    tracks: [{ id: 'track-1', name: 'Staff 1', instrument: 'piano', clef: 'treble', staffIndex: 0, notes, defaultGain: 0.8 }],
    durationQn: 12,
    warnings: [],
  };
}

const printedRef: Reference = {
  ticksPerBeat: 384,
  tempoBpm: 120,
  timeSignature: { beats: 3, beatType: 4 },
  keyFifths: 0,
  tracks: [
    {
      name: 'one',
      notes: [
        { midi: 60, startQn: 0, durationQn: 1 },
        { midi: 62, startQn: 1, durationQn: 1 },
        { midi: 64, startQn: 2, durationQn: 1 },
        { midi: 65, startQn: 3, durationQn: 3 },
      ],
    },
  ],
};

describe('score comparison', () => {
  it('computes LCS length', () => {
    expect(lcsLength([1, 2, 3, 4], [2, 3, 5, 4])).toBe(3);
    expect(lcsLength([], [1])).toBe(0);
  });

  it('re-times the first occurrence of each measure to printed order', () => {
    const s = score();
    const printed = printedOrderNotes(s, s.tracks[0]);
    expect(printed).toHaveLength(4);
    expect(printed.map((n) => n.startQn)).toEqual([0, 1, 2, 3]);
  });

  it('prefers the printed-order variant against a folded reference', () => {
    const cmp = compareScoreToReference(score(), printedRef);
    expect(cmp.variant).toBe('printed');
    expect(cmp.overall.onsetPitchF1).toBe(1);
    expect(cmp.overall.pitchLcsRatio).toBe(1);
    expect(cmp.overall.durationAccuracy).toBe(1);
    expect(cmp.pass).toBe(true);
    expect(cmp.tracks[0].scoreTrackId).toBe('track-1');
  });

  it('reports missing and extra notes', () => {
    const ref: Reference = { ...printedRef, tracks: [{ name: 'one', notes: [...printedRef.tracks[0].notes, { midi: 67, startQn: 3, durationQn: 1 }] }] };
    const s = score();
    s.tracks[0].notes[2].midi = 63;
    const cmp = compareScoreToReference(s, ref);
    expect(cmp.tracks[0].missingSample.map((n) => n.midi).sort()).toEqual([64, 67]);
    expect(cmp.tracks[0].extraSample.map((n) => n.midi)).toEqual([63]);
    expect(cmp.overall.onsetPitchF1).toBeLessThan(1);
    expect(cmp.tracks[0].onsetPitchRecall).toBeCloseTo(3 / 5);
    expect(cmp.tracks[0].onsetPitchPrecision).toBeCloseTo(3 / 4);
  });
});
