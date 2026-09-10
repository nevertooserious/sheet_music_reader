import { describe, expect, it } from 'vitest';
import type { System } from './model';
import { detectVoltas, openVoltaAtLineEnd, parseVoltaNumbers, voltaForRegion } from './repeats';
import type { HLine, VLine } from './staves';

describe('volta numbers', () => {
  it('parses the usual bracket labels', () => {
    expect(parseVoltaNumbers('1.')).toEqual([1]);
    expect(parseVoltaNumbers('2')).toEqual([2]);
    expect(parseVoltaNumbers('1.-2.')).toEqual([1, 2]);
    expect(parseVoltaNumbers('1–3')).toEqual([1, 2, 3]);
    expect(parseVoltaNumbers('1. 2.')).toEqual([1, 2]);
    expect(parseVoltaNumbers('1., 3.')).toEqual([1, 3]);
    expect(parseVoltaNumbers('3-1')).toBeUndefined();
    expect(parseVoltaNumbers('Allegro')).toBeUndefined();
    expect(parseVoltaNumbers('11')).toEqual([1]);
    expect(parseVoltaNumbers('')).toBeUndefined();
  });
});

describe('bracket detection', () => {
  const system: System = {
    index: 0,
    page: 0,
    staves: [{ page: 0, lines: [100, 105, 110, 115, 120], top: 100, bottom: 120, x1: 30, x2: 400, space: 5, index: 0, system: 0 }],
    top: 100,
    bottom: 120,
    x1: 30,
    x2: 400,
  };
  const bracket = (x1: number, x2: number, y = 80): HLine => ({ x1, x2, y, thickness: 0.5 });
  const hook = (x: number, y = 80): VLine => ({ x, y1: y, y2: y + 8, thickness: 0.5, kind: 'stroke' });

  it('needs a hook and a number at the left end', () => {
    const h = [bracket(120, 200), bracket(205, 260), bracket(300, 350)];
    const v = [hook(120), hook(205)];
    const labels = [
      { x: 122, y: 90, text: '1.' },
      { x: 207, y: 90, text: '2.' },
      { x: 302, y: 90, text: '3.' },
    ];
    const voltas = detectVoltas(h, v, labels, system);
    expect(voltas.map((b) => [b.x1, b.x2, b.numbers])).toEqual([
      [120, 200, [1]],
      [205, 260, [2]],
    ]);
    expect(voltaForRegion(voltas, 121, 199, 5)).toEqual([1]);
    expect(voltaForRegion(voltas, 210, 262, 5)).toEqual([2]);
    expect(voltaForRegion(voltas, 262, 300, 5)).toBeUndefined();
  });

  it('ignores lines inside or far above the staff and tuplet-like numbers in the middle', () => {
    const h = [bracket(120, 200, 110), bracket(120, 200, 20), bracket(120, 200)];
    const v = [hook(120, 110), hook(120, 20), hook(120)];
    expect(detectVoltas(h, v, [{ x: 160, y: 90, text: '3' }], system)).toEqual([]);
  });
});

describe('brackets continued from the previous line', () => {
  const system: System = {
    index: 1,
    page: 0,
    staves: [{ page: 0, lines: [200, 205, 210, 215, 220], top: 200, bottom: 220, x1: 30, x2: 400, space: 5, index: 0, system: 1 }],
    top: 200,
    bottom: 220,
    x1: 30,
    x2: 400,
  };
  const line = (x1: number, x2: number, y = 180): HLine => ({ x1, x2, y, thickness: 0.5 });
  const hook = (x: number, y = 180): VLine => ({ x, y1: y, y2: y + 8, thickness: 0.5, kind: 'stroke' });

  it('reports whether a bracket is closed by a right hook and whether it runs off the line', () => {
    const open = detectVoltas([line(120, 400)], [hook(120)], [{ x: 122, y: 190, text: '1.' }], system);
    expect(open.map((v) => v.closedRight)).toEqual([false]);
    expect(openVoltaAtLineEnd(open, system)).toEqual([1]);
    const closed = detectVoltas([line(120, 400)], [hook(120), hook(400)], [{ x: 122, y: 190, text: '1.' }], system);
    expect(closed.map((v) => v.closedRight)).toEqual([true]);
    expect(openVoltaAtLineEnd(closed, system)).toBeUndefined();
    expect(openVoltaAtLineEnd(detectVoltas([line(120, 300)], [hook(120)], [{ x: 122, y: 190, text: '1.' }], system), system)).toBeUndefined();
  });

  it('inherits the open ending for an unlabelled line starting at the left edge, but not when a numbered bracket sits there', () => {
    const inherited = detectVoltas([line(30, 150), line(158, 260)], [hook(158)], [{ x: 160, y: 190, text: '2.' }], system, [1]);
    expect(inherited.map((v) => [v.x1, v.x2, v.numbers, !!v.inherited])).toEqual([
      [30, 150, [1], true],
      [158, 260, [2], false],
    ]);
    expect(voltaForRegion(inherited, 30, 150, 5)).toEqual([1]);
    const numbered = detectVoltas([line(30, 150)], [hook(30)], [{ x: 32, y: 190, text: '2.' }], system, [1]);
    expect(numbered.map((v) => [v.numbers, !!v.inherited])).toEqual([[[2], false]]);
    expect(detectVoltas([line(30, 150)], [], [], system)).toEqual([]);
    expect(detectVoltas([line(60, 150)], [], [], system, [1])).toEqual([]);
  });
});
