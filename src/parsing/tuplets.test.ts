import { describe, expect, it } from 'vitest';
import type { Staff } from './model';
import { detectTuplets, parseTupletText, tupletNormal, type TupletItem, type TupletLabel } from './tuplets';

const staff: Staff = { page: 0, lines: [100, 105, 110, 115, 120], top: 100, bottom: 120, x1: 30, x2: 400, space: 5, index: 0, system: 0 };

describe('tuplet arithmetic', () => {
  it('derives the normal count from the printed number', () => {
    expect(tupletNormal(3)).toBe(2);
    expect(tupletNormal(5)).toBe(4);
    expect(tupletNormal(6)).toBe(4);
    expect(tupletNormal(7)).toBe(4);
    expect(tupletNormal(9)).toBe(8);
    expect(tupletNormal(2)).toBe(3);
    expect(tupletNormal(4)).toBe(3);
    expect(tupletNormal(5, 3)).toBe(3);
  });

  it('parses tuplet labels', () => {
    expect(parseTupletText('3')).toEqual({ actual: 3, normal: undefined });
    expect(parseTupletText(' 5:4 ')).toEqual({ actual: 5, normal: 4 });
    expect(parseTupletText('6')).toEqual({ actual: 6, normal: undefined });
    expect(parseTupletText('2.')).toBeUndefined();
    expect(parseTupletText('1')).toBeUndefined();
    expect(parseTupletText('12 ')).toEqual({ actual: 12, normal: undefined });
    expect(parseTupletText('3 4')).toBeUndefined();
    expect(parseTupletText('mf')).toBeUndefined();
  });
});

describe('tuplet grouping', () => {
  const items: TupletItem[] = [
    { id: 'a', cx: 100, y: 110, stemId: 1 },
    { id: 'b', cx: 115, y: 110, stemId: 2 },
    { id: 'c', cx: 130, y: 110, stemId: 3 },
    { id: 'd', cx: 200, y: 110, stemId: 4 },
    { id: 'g', cx: 122, y: 110, grace: true },
  ];

  it('takes the notes under the beam the number is centred over', () => {
    const label: TupletLabel = { cx: 117.5, y: 80, size: 10, actual: 3 };
    const groups = detectTuplets([label], items, [{ minX: 102, maxX: 133, minY: 86, maxY: 88 }], [], staff);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds).toEqual(['a', 'b', 'c']);
    expect(groups[0].ratio).toBeCloseTo(2 / 3);
  });

  it('takes the notes under a bracket broken around the number', () => {
    const label: TupletLabel = { cx: 115, y: 82, size: 10, actual: 3 };
    const brackets = [
      { x1: 97, x2: 111, y: 78, thickness: 0.5 },
      { x1: 119, x2: 133, y: 78, thickness: 0.5 },
    ];
    const groups = detectTuplets([label], items, [], brackets, staff);
    expect(groups[0]?.itemIds).toEqual(['a', 'b', 'c']);
  });

  it('ignores a number with neither beam nor bracket, and a beam it is not centred on', () => {
    const label: TupletLabel = { cx: 104, y: 80, size: 10, actual: 3 };
    expect(detectTuplets([label], items, [{ minX: 102, maxX: 133, minY: 86, maxY: 88 }], [], staff)).toEqual([]);
    expect(detectTuplets([{ ...label, cx: 117.5 }], items, [], [], staff)).toEqual([]);
  });

  it('treats a digit over one head of a four-note beam (a fingering) as off-centre', () => {
    const beam = [{ minX: 102, maxX: 157, minY: 86, maxY: 88 }];
    const four = [...items.filter((i) => !i.grace), { id: 'e', cx: 145, y: 110, stemId: 5 }];
    expect(detectTuplets([{ cx: 134, y: 80, size: 10, actual: 3 }], four, beam, [], staff)).toEqual([]);
    expect(detectTuplets([{ cx: 133, y: 80, size: 10, actual: 3 }], four, beam, [], staff)).toEqual([]);
    const centred = detectTuplets([{ cx: 129.5, y: 80, size: 10, actual: 3 }], four, beam, [], staff);
    expect(centred.map((g) => [g.source, g.itemIds])).toEqual([['beam', ['a', 'b', 'c', 'e']]]);
  });

  it('labels bracketed groups as such', () => {
    const label: TupletLabel = { cx: 115, y: 82, size: 10, actual: 3 };
    const brackets = [
      { x1: 97, x2: 111, y: 78, thickness: 0.5 },
      { x1: 119, x2: 133, y: 78, thickness: 0.5 },
    ];
    expect(detectTuplets([label], items, [], brackets, staff)[0]?.source).toBe('bracket');
  });
});
