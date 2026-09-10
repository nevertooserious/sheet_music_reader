import { describe, expect, it } from 'vitest';
import { buildTimeline, extendEndings, timelineDuration, type RepeatMeasure } from './timeline';

const bars = (n: number): RepeatMeasure[] => Array.from({ length: n }, () => ({ durationQn: 3 }));

describe('timeline unfolding', () => {
  it('plays straight through without repeats', () => {
    const t = buildTimeline(bars(4));
    expect(t.map((s) => s.measure)).toEqual([0, 1, 2, 3]);
    expect(t.map((s) => s.startQn)).toEqual([0, 3, 6, 9]);
    expect(timelineDuration(t)).toBe(12);
  });

  it('repeats from the beginning to a repeat end', () => {
    const m = bars(4);
    m[1].repeatEnd = true;
    const t = buildTimeline(m);
    expect(t.map((s) => s.measure)).toEqual([0, 1, 0, 1, 2, 3]);
    expect(t[2].startQn).toBe(6);
  });

  it('handles back-to-back volta sections like the fixture (:|.|: then :|.)', () => {
    const m = bars(32);
    m[15].repeatEnd = true;
    m[16].repeatStart = true;
    m[31].repeatEnd = true;
    const t = buildTimeline(m);
    expect(t).toHaveLength(64);
    expect(t.map((s) => s.measure).slice(14, 20)).toEqual([14, 15, 0, 1, 2, 3]);
    expect(t.map((s) => s.measure).slice(46, 50)).toEqual([30, 31, 16, 17]);
    expect(timelineDuration(t)).toBe(192);
  });

  it('starts a section at an explicit repeat start', () => {
    const m = bars(5);
    m[2].repeatStart = true;
    m[3].repeatEnd = true;
    expect(buildTimeline(m).map((s) => s.measure)).toEqual([0, 1, 2, 3, 2, 3, 4]);
  });

  it('can leave repeats folded', () => {
    const m = bars(3);
    m[2].repeatEnd = true;
    expect(buildTimeline(m, false).map((s) => s.measure)).toEqual([0, 1, 2]);
  });
});

describe('volta brackets', () => {
  it('skips the first ending on the second pass', () => {
    const m = bars(4);
    m[0].repeatStart = true;
    m[1].volta = [1];
    m[1].repeatEnd = true;
    m[2].volta = [2];
    const t = buildTimeline(m);
    expect(t.map((s) => s.measure)).toEqual([0, 1, 0, 2, 3]);
    expect(t.map((s) => s.startQn)).toEqual([0, 3, 6, 9, 12]);
  });

  it('plays a "1.-2." ending twice before the third ending', () => {
    const m = bars(4);
    m[1].volta = [1, 2];
    m[1].repeatEnd = true;
    m[2].volta = [3];
    expect(buildTimeline(m).map((s) => s.measure)).toEqual([0, 1, 0, 1, 0, 2, 3]);
  });

  it('handles two-measure endings and a repeat that starts right after them', () => {
    const m = bars(7);
    m[1].volta = [1];
    m[2].volta = [1];
    m[2].repeatEnd = true;
    m[3].volta = [2];
    m[4].volta = [2];
    m[5].repeatEnd = true;
    expect(buildTimeline(m).map((s) => s.measure)).toEqual([0, 1, 2, 0, 3, 4, 5, 5, 6]);
  });

  it('lists every measure once when repeats stay folded', () => {
    const m = bars(4);
    m[1].volta = [1];
    m[1].repeatEnd = true;
    m[2].volta = [2];
    expect(buildTimeline(m, false).map((s) => s.measure)).toEqual([0, 1, 2, 3]);
  });
});

describe('endings broken across a line', () => {
  it('extends a first ending over its unnumbered continuation up to the repeat barline', () => {
    const m = bars(5);
    m[1].volta = [1];
    m[2].repeatEnd = true;
    m[3].volta = [2];
    expect(extendEndings(m).map((x) => x.volta)).toEqual([undefined, [1], [1], [2], undefined]);
    expect(buildTimeline(m).map((s) => s.measure)).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it('does not extend the last ending over the plain measures that follow it', () => {
    // |: A :| [1] [2] then B :| — the measures after the 2nd ending form their own repeated section.
    const m = bars(7);
    m[1].volta = [1];
    m[1].repeatEnd = true;
    m[2].volta = [2];
    m[5].repeatEnd = true;
    expect(extendEndings(m).map((x) => x.volta)).toEqual([undefined, [1], [2], undefined, undefined, undefined, undefined]);
    expect(buildTimeline(m).map((s) => s.measure)).toEqual([0, 1, 0, 2, 3, 4, 5, 3, 4, 5, 6]);
  });

  it('does not extend across a repeat start or when the ending after the repeat overlaps in passes', () => {
    const m = bars(5);
    m[1].volta = [1];
    m[2].repeatStart = true;
    m[2].repeatEnd = true;
    m[3].volta = [2];
    expect(extendEndings(m).map((x) => x.volta)).toEqual([undefined, [1], undefined, [2], undefined]);
    const n = bars(5);
    n[1].volta = [1, 2];
    n[2].repeatEnd = true;
    n[3].volta = [2];
    expect(extendEndings(n).map((x) => x.volta)).toEqual([undefined, [1, 2], undefined, [2], undefined]);
  });
});
