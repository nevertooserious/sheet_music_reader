import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { buildSyntheticPage } from './syntheticScene';

describe('synthetic showcase page', () => {
  const { score, debug } = analyze([buildSyntheticPage()], { fileName: 'synthetic.pdf' });

  it('reads two systems in 3/4, G major, six bars of 3 qn', () => {
    expect(score.title).toBe('Synthetic page: endings across a line break, a tie and a triplet');
    expect(debug.systems.map((s) => s.staves)).toEqual([1, 1]);
    expect(score.timeSignatures).toEqual([{ measure: 0, beats: 3, beatType: 4 }]);
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 1 }]);
    expect(score.measures.map((m) => m.durationQn)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(score.warnings).toEqual([]);
  });

  it('continues the first ending onto the second line and plays it once', () => {
    expect(debug.voltas.map((v) => [v.numbers, !!v.inherited])).toEqual([
      [[1], false],
      [[1], true],
      [[2], false],
    ]);
    expect(debug.measures.map((m) => m.volta)).toEqual([undefined, undefined, [1], [1], [2], undefined]);
    expect(score.measures.map((m) => !!m.repeatEnd)).toEqual([false, false, false, true, false, false]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 2, 3, 0, 1, 4, 5]);
    expect(score.durationQn).toBe(24);
  });

  it('merges the tie broken at the line break and applies the beamed triplet', () => {
    expect(debug.ties).toHaveLength(1);
    expect(debug.ties[0].broken).toBe(true);
    expect(debug.tuplets.map((t) => `${t.actual}:${t.normal}`)).toEqual(['3:2']);
    const printed = debug.notes.map((n) => [n.label, n.durationQn]);
    expect(printed).toEqual([
      ['B4', 1],
      ['D5', 1],
      ['G4', 1],
      ['A4', 1],
      ['B4', 1],
      ['C5', 1],
      ['G4', 2],
      ['A4', 2],
      ['B4', 2],
      ['E5', 1 / 3],
      ['D5', 1 / 3],
      ['C5', 1 / 3],
      ['B4', 1],
      ['G4', 1],
      ['F#5', 1],
      ['D5', 1],
      ['G4', 1],
    ]);
  });
});
