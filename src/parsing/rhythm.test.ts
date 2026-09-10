import { describe, expect, it } from 'vitest';
import { assembleMeasure, clusterByX, type RhythmItem } from './rhythm';

const SP = 5;
const opts = { measureQn: 3, space: SP, middleY: 100, xRange: [0, 100] as [number, number] };

function note(id: string, x: number, durationQn: number, extra: Partial<RhythmItem> = {}): RhythmItem {
  return { id, kind: 'note', x, y: 100, durationQn, ...extra };
}

function rest(id: string, x: number, durationQn: number, y = 100): RhythmItem {
  return { id, kind: 'rest', x, y, durationQn };
}

describe('rhythm assembly', () => {
  it('reads a single voice left to right', () => {
    const r = assembleMeasure([note('a', 10, 1), note('b', 40, 0.5), note('c', 55, 0.5), note('d', 70, 1)], opts);
    expect(r.method).toBe('single');
    expect(r.problem).toBeUndefined();
    expect([...r.onsets.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 1.5],
      ['d', 2],
    ]);
    expect(r.totalQn).toBe(3);
    expect(r.anchors.map((a) => a.qn)).toEqual([0, 1, 1.5, 2]);
  });

  it('groups chord heads within half a staff space and heads sharing a stem', () => {
    const clusters = clusterByX([note('a', 10, 2), note('b', 12, 2), note('c', 10.5, 2), note('d', 40, 1)], SP);
    expect(clusters.map((c) => c.items.map((i) => i.id))).toEqual([['a', 'c', 'b'], ['d']]);
    const shared = clusterByX([note('a', 10, 1, { stemId: 1 }), note('b', 20, 1, { stemId: 1 })], SP);
    expect(shared).toHaveLength(1);
    const r = assembleMeasure([note('a', 10, 2), note('b', 12, 2), note('c', 10.5, 2), note('d', 40, 1)], opts);
    expect(r.method).toBe('single');
    expect(r.onsets.get('c')).toBe(0);
    expect(r.onsets.get('d')).toBe(2);
  });

  it('splits two voices by stem direction when one voice cannot fill the measure', () => {
    // r4 d2 (stems up) against b2 b4 (stems down), as in the fixture's bar 25 left hand.
    const items = [
      rest('r', 10, 1, 90),
      note('b2', 10, 2, { stem: 'down', stemId: 1, y: 110 }),
      note('d2', 40, 2, { stem: 'up', stemId: 2, y: 80 }),
      note('b4', 70, 1, { stem: 'down', stemId: 3, y: 110 }),
    ];
    const r = assembleMeasure(items, opts);
    expect(r.method).toBe('two-voice');
    expect(r.onsets.get('r')).toBe(0);
    expect(r.onsets.get('d2')).toBe(1);
    expect(r.onsets.get('b2')).toBe(0);
    expect(r.onsets.get('b4')).toBe(2);
    expect(r.totalQn).toBe(3);
  });

  it('keeps a stem-up and a stem-down chord at the same x as one onset', () => {
    // <b d>2 (up) with g2 (down), then a4.
    const items = [
      note('b', 10, 2, { stem: 'up', stemId: 1 }),
      note('d', 10, 2, { stem: 'up', stemId: 1 }),
      note('g', 11, 2, { stem: 'down', stemId: 2 }),
      note('a', 50, 1, { stem: 'up', stemId: 3 }),
    ];
    const r = assembleMeasure(items, opts);
    expect(r.onsets.get('g')).toBe(0);
    expect(r.onsets.get('a')).toBe(2);
    expect(r.problem).toBeUndefined();
  });

  it('flags a rest coinciding with a note in a single voice as an anomaly', () => {
    const r = assembleMeasure([rest('r', 10, 1), note('a', 10, 1), note('b', 40, 1), note('c', 70, 1)], opts);
    expect(r.method).toBe('single');
    expect(r.anomalies).toBe(1);
  });

  it('accepts an incomplete measure (pickup) with a problem note', () => {
    const r = assembleMeasure([note('a', 10, 1)], opts);
    expect(r.method).toBe('single');
    expect(r.totalQn).toBe(1);
    expect(r.problem).toMatch(/fill 1 of 3/);
  });

  it('falls back to alignment with the other staff when durations overrun', () => {
    const items = [note('a', 10, 2), note('b', 40, 2), note('c', 70, 2)];
    const anchors = [
      { x: 10, qn: 0 },
      { x: 40, qn: 1 },
      { x: 70, qn: 2 },
    ];
    const r = assembleMeasure(items, { ...opts, anchors });
    expect(r.method).toBe('aligned');
    expect(r.onsets.get('b')).toBe(1);
    expect(r.onsets.get('c')).toBe(2);
    expect(r.problem).toBeDefined();
    const p = assembleMeasure(items, opts);
    expect(p.method).toBe('proportional');
    expect(p.onsets.get('a')).toBe(0.25);
  });

  it('accepts any total when the measure length is unknown', () => {
    const r = assembleMeasure([note('a', 10, 2), note('b', 40, 2)], { ...opts, measureQn: undefined });
    expect(r.method).toBe('single');
    expect(r.totalQn).toBe(4);
  });

  it('returns empty for no items', () => {
    expect(assembleMeasure([], opts).method).toBe('empty');
  });
});

describe('stemless chords', () => {
  it('clusters a displaced second of a whole-note chord into one onset', () => {
    const items = [note('c', 10, 4, { y: 100 }), note('d', 10 + 1.3 * SP, 4, { y: 97.5 })];
    expect(clusterByX(items, SP)).toHaveLength(1);
    const r = assembleMeasure(items, { ...opts, measureQn: 4 });
    expect(r.method).toBe('single');
    expect(r.onsets.get('d')).toBe(0);
    // Two stemless whole notes a head width apart but a third apart are still two onsets.
    expect(clusterByX([note('c', 10, 4, { y: 100 }), note('e', 10 + 1.3 * SP, 4, { y: 95 })], SP)).toHaveLength(2);
  });
});
