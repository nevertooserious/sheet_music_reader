import { describe, expect, it } from 'vitest';
import type { ClassifiedGlyph, PathShape } from './model';
import { detectBarlines, detectStaves, groupSystems, horizontalLines, measureRegions, mergeCollinear, verticalLines } from './staves';

function hline(x1: number, x2: number, y: number, lineWidth = 0.5): PathShape {
  return { page: 0, kind: 'stroke', subpaths: [[{ x: x1, y }, { x: x2, y }]], bbox: { minX: x1, maxX: x2, minY: y, maxY: y }, lineWidth, hasCurves: false };
}

function vline(x: number, y1: number, y2: number, lineWidth = 1): PathShape {
  return { page: 0, kind: 'stroke', subpaths: [[{ x, y: y1 }, { x, y: y2 }]], bbox: { minX: x, maxX: x, minY: y1, maxY: y2 }, lineWidth, hasCurves: false };
}

function rect(x: number, y: number, w: number, h: number): PathShape {
  const pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x, maxX: x + w, minY: y, maxY: y + h }, lineWidth: 0, hasCurves: false };
}

function head(x: number, y: number): ClassifiedGlyph {
  return { page: 0, fontId: 'f', fontName: 'Emmentaler-20', family: 'emmentaler', code: 1, x: x - 3, y, advance: 6, size: 24, music: { kind: 'notehead', head: 'black' } };
}

function dot(x: number, y: number): ClassifiedGlyph {
  return { ...head(x, y), music: { kind: 'dot' }, advance: 2, x: x - 1 };
}

const SP = 6;
const staffLines = (top: number) => [0, 1, 2, 3, 4].map((i) => hline(30, 500, top + i * SP));

describe('staff, system and barline detection', () => {
  const paths = [
    ...staffLines(100),
    ...staffLines(160),
    rect(29.5, 100, 1, 84), // system start line spanning both staves
    hline(60, 70, 94), // ledger line: too short to be a staff line
    vline(200, 100, 124),
    vline(200, 124, 160),
    vline(200, 160, 184),
    vline(350, 100, 124),
    vline(350, 160, 184),
    rect(120, 90, 0.3, 20), // a stem near a head
    vline(499, 100, 124, 3),
    vline(499, 160, 184, 3),
    vline(496, 100, 124),
    vline(496, 160, 184),
  ];

  it('finds five equidistant lines with a common extent', () => {
    expect(horizontalLines(paths).length).toBe(11);
    const staves = detectStaves(paths, 0);
    expect(staves).toHaveLength(2);
    expect(staves[0].top).toBe(100);
    expect(staves[0].bottom).toBe(124);
    expect(staves[0].space).toBeCloseTo(SP);
    expect(staves[1].top).toBe(160);
    expect(staves[0].x1).toBe(30);
    expect(staves[0].x2).toBe(500);
  });

  it('groups staves joined by a vertical line into one system', () => {
    const staves = detectStaves(paths, 0);
    const systems = groupSystems(staves, verticalLines(paths), 0, 0);
    expect(systems).toHaveLength(1);
    expect(systems[0].staves.map((s) => s.index)).toEqual([0, 1]);
    expect(staves[1].system).toBe(0);
    const apart = groupSystems(detectStaves([...staffLines(100), ...staffLines(300)], 0), [], 0, 3);
    expect(apart).toHaveLength(2);
    expect(apart[1].index).toBe(4);
  });

  it('detects barline groups, ignores stems and reads repeat dots', () => {
    const staves = detectStaves(paths, 0);
    const [system] = groupSystems(staves, verticalLines(paths), 0, 0);
    const heads = [head(120.5, 112), head(250, 106)];
    const dots = [dot(492, 109), dot(492, 115), dot(258, 106)];
    const groups = detectBarlines(system, verticalLines(paths), heads, dots, []);
    // The system start line is a group too; measureRegions skips it.
    expect(groups.map((g) => Math.round(g.x))).toEqual([30, 200, 350, 498]);
    expect(groups[3].thick).toBe(true);
    expect(groups[3].dotsLeft).toBe(true);
    expect(groups[2].dotsLeft).toBe(false);
    const regions = measureRegions(system, groups);
    expect(regions).toHaveLength(3);
    expect(regions[0].x1).toBe(30);
    expect(regions[0].x2).toBeCloseTo(199.5);
    expect(regions[2].repeatEnd).toBe(true);
    expect(regions[0].repeatStart).toBe(false);
  });

  it('treats a full-height line touching a head as a stem, not a barline', () => {
    const single = [...staffLines(100), vline(200, 100, 124), vline(350, 100, 124), vline(499, 100, 124)];
    const staves = detectStaves(single, 0);
    const [system] = groupSystems(staves, verticalLines(single), 0, 0);
    const groups = detectBarlines(system, verticalLines(single), [head(353, 124)], [], []);
    expect(groups.map((g) => Math.round(g.x))).toEqual([200, 499]);
  });
});

describe('collinear segments', () => {
  it('merges touching or overlapping pieces of one line and keeps separate lines apart', () => {
    const merged = mergeCollinear([
      { x1: 30, x2: 200, y: 100, thickness: 0.5 },
      { x1: 201, x2: 360, y: 100.1, thickness: 0.5 },
      { x1: 30, x2: 100, y: 100, thickness: 0.5 },
      { x1: 30, x2: 360, y: 106, thickness: 0.5 },
      { x1: 30, x2: 100, y: 112, thickness: 0.5 },
      { x1: 110, x2: 360, y: 112, thickness: 0.5 },
    ]);
    expect(merged.map((l) => [l.x1, l.x2, Math.round(l.y)])).toEqual([
      [30, 360, 100],
      [30, 360, 106],
      [30, 100, 112],
      [110, 360, 112],
    ]);
  });

  it('detects one staff from lines drawn per measure', () => {
    const paths = [0, 1, 2, 3, 4].flatMap((i) => [hline(30, 200, 100 + i * SP), hline(200.8, 500, 100 + i * SP)]);
    const staves = detectStaves(paths, 0);
    expect(staves).toHaveLength(1);
    expect([staves[0].x1, staves[0].x2]).toEqual([30, 500]);
  });
});
