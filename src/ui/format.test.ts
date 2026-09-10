import { describe, expect, it } from 'vitest';
import { createDemoScore } from '../core/demoScore';
import {
  activeNotes,
  clamp,
  describeKey,
  findSegmentIndex,
  fitScale,
  formatClock,
  formatDb,
  formatPosition,
  formatQnClock,
  indexTracks,
  maxDuration,
  measureUnionBox,
  nudgeByMeasure,
  onsetAnchors,
  playheadX,
  positionInfo,
  sortNotes,
  timeSignatureAt,
} from './format';

const score = createDemoScore();

describe('formatClock', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(605)).toBe('10:05');
  });

  it('treats invalid input as zero', () => {
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
  });

  it('converts quarter notes at a tempo', () => {
    expect(formatQnClock(120, 120)).toBe('1:00');
    expect(formatQnClock(48, 108)).toBe('0:26');
  });
});

describe('formatDb', () => {
  it('maps unity gain to 0 dB and silence to -inf', () => {
    expect(formatDb(1)).toBe('0.0 dB');
    expect(formatDb(0)).toBe('-inf dB');
    expect(formatDb(0.5)).toBe('-6.0 dB');
  });
});

describe('findSegmentIndex', () => {
  const timeline = score.timeline;

  it('finds the segment containing a position', () => {
    expect(findSegmentIndex(timeline, 0)).toBe(0);
    expect(findSegmentIndex(timeline, 2.99)).toBe(0);
    expect(findSegmentIndex(timeline, 3)).toBe(1);
    expect(findSegmentIndex(timeline, 7)).toBe(2);
  });

  it('maps the repeat pass to the same printed measure', () => {
    const i = findSegmentIndex(timeline, 24);
    expect(i).toBe(8);
    expect(timeline[i].measure).toBe(0);
  });

  it('clamps past the end and rejects empty timelines', () => {
    expect(findSegmentIndex(timeline, 1000)).toBe(timeline.length - 1);
    expect(findSegmentIndex([], 0)).toBe(-1);
    expect(findSegmentIndex(timeline, -1)).toBe(-1);
  });
});

describe('positionInfo / formatPosition', () => {
  it('reports bar and beat for 3/4', () => {
    expect(formatPosition(score, 0)).toBe('bar 1 · beat 1');
    expect(formatPosition(score, 1)).toBe('bar 1 · beat 2');
    expect(formatPosition(score, 2.5)).toBe('bar 1 · beat 3');
    expect(formatPosition(score, 6)).toBe('bar 3 · beat 1');
  });

  it('reports the printed bar on the repeat pass', () => {
    expect(formatPosition(score, 24 + 3 * 5 + 1)).toBe('bar 6 · beat 2');
  });

  it('computes the fraction through the measure', () => {
    expect(positionInfo(score, 1.5)?.measureFraction).toBeCloseTo(0.5);
    expect(positionInfo(score, 6)?.measureFraction).toBe(0);
  });

  it('handles a missing score', () => {
    expect(formatPosition(undefined, 4)).toBe('bar – · beat –');
  });
});

describe('timeSignatureAt', () => {
  it('returns the latest signature at or before the measure', () => {
    const sigs = [
      { measure: 0, beats: 4, beatType: 4 },
      { measure: 4, beats: 3, beatType: 8 },
    ];
    expect(timeSignatureAt(sigs, 0)?.beats).toBe(4);
    expect(timeSignatureAt(sigs, 3)?.beats).toBe(4);
    expect(timeSignatureAt(sigs, 4)?.beats).toBe(3);
    expect(timeSignatureAt(sigs, 9)?.beatType).toBe(8);
    expect(timeSignatureAt([], 2)).toBeUndefined();
  });
});

describe('nudgeByMeasure', () => {
  it('moves to the start of neighbouring segments and clamps', () => {
    expect(nudgeByMeasure(score, 4, 1)).toBe(6);
    expect(nudgeByMeasure(score, 4, -1)).toBe(0);
    expect(nudgeByMeasure(score, 0, -1)).toBe(0);
    expect(nudgeByMeasure(score, 47, 5)).toBe(45);
  });
});

describe('activeNotes', () => {
  const rh = sortNotes(score.tracks[0].notes);
  const max = maxDuration(rh);

  it('returns the notes sounding at a position', () => {
    const first = activeNotes(rh, 0.5, max);
    expect(first.map((n) => n.midi)).toEqual([74]);
    const later = activeNotes(rh, 1.25, max);
    expect(later.map((n) => n.midi)).toEqual([67]);
  });

  it('excludes notes that end exactly at the position', () => {
    const at1 = activeNotes(rh, 1, max).map((n) => n.midi);
    expect(at1).toEqual([67]);
  });

  it('returns chords from the bass track', () => {
    const lh = sortNotes(score.tracks[1].notes);
    const chord = activeNotes(lh, 0.1, maxDuration(lh)).map((n) => n.midi).sort();
    expect(chord).toEqual([55, 59, 62]);
  });

  it('reuses the output array and handles empty input', () => {
    const out: typeof rh = [];
    expect(activeNotes([], 3, 1, out)).toBe(out);
    expect(out).toHaveLength(0);
  });
});

describe('fitScale / clamp', () => {
  it('fits a page into the available width within bounds', () => {
    expect(fitScale(595, 595)).toBe(1);
    expect(fitScale(1190, 595)).toBe(2);
    expect(fitScale(10, 595)).toBe(0.25);
    expect(fitScale(0, 595)).toBe(1);
  });

  it('clamps values and treats NaN as the lower bound', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(NaN, 2, 3)).toBe(2);
  });
});

describe('measureUnionBox', () => {
  it('covers every staff box of the measure', () => {
    const box = measureUnionBox(score.measures[0]);
    expect(box).toMatchObject({ page: 0, x: 60, y: 120 });
    expect(box?.height).toBe(200 + 40 - 120);
  });

  it('is undefined without layout', () => {
    expect(measureUnionBox({ ...score.measures[0], layout: [] })).toBeUndefined();
  });
});

describe('describeKey', () => {
  it('names major keys from fifths', () => {
    expect(describeKey(1)).toBe('G major');
    expect(describeKey(0)).toBe('C major');
    expect(describeKey(-2)).toBe('B♭ major');
    expect(describeKey(undefined)).toBe('');
  });
});

describe('onsetAnchors / playheadX', () => {
  const tracks = indexTracks(score);
  const box = measureUnionBox(score.measures[0])!;

  it('collects distinct onsets of a segment with averaged x for chords', () => {
    const anchors = onsetAnchors(tracks, score.timeline[0], 0);
    expect(anchors.map(([t]) => t)).toEqual([0, 1, 1.5, 2, 2.5]);
    expect(anchors[0][1]).toBeCloseTo(box.x + 10);
    expect(anchors[4][1]).toBeCloseTo(box.x + 10 + (2.5 / 3) * (box.width - 20));
  });

  it('uses the repeat pass notes for the second-pass segment', () => {
    const second = onsetAnchors(tracks, score.timeline[8], 0);
    expect(second).toEqual(onsetAnchors(tracks, score.timeline[0], 0));
    expect(onsetAnchors(tracks, score.timeline[0], 1)).toEqual([]);
  });

  it('interpolates between onsets and glides to the barline after the last one', () => {
    const anchors: Array<[number, number]> = [
      [0, 100],
      [2, 160],
    ];
    const b = { page: 0, x: 90, y: 0, width: 100, height: 40 };
    expect(playheadX(anchors, 0, 3, b)).toBe(100);
    expect(playheadX(anchors, 1, 3, b)).toBe(130);
    expect(playheadX(anchors, 2, 3, b)).toBe(160);
    expect(playheadX(anchors, 2.5, 3, b)).toBe(175);
    expect(playheadX(anchors, 3, 3, b)).toBe(190);
  });

  it('runs from the barline to a late first onset and falls back to proportional spacing', () => {
    const b = { page: 0, x: 0, y: 0, width: 300, height: 40 };
    expect(playheadX([[1, 60]], 0.5, 3, b)).toBe(30);
    expect(playheadX([], 1.5, 3, b)).toBe(150);
    expect(playheadX([], 5, 0, b)).toBe(0);
  });
});
