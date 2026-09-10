import { describe, expect, it } from 'vitest';
import { applyDots, asBeam, beamsCrossingStem, noteDurationQn, polygonYRangeAt, stemDirection, stemFreeEnd } from './durations';
import type { PathShape } from './model';

function quad(x1: number, y1: number, x2: number, y2: number, thickness: number): PathShape {
  const pts = [
    { x: x1, y: y1 },
    { x: x1, y: y1 + thickness },
    { x: x2, y: y2 + thickness },
    { x: x2, y: y2 },
    { x: x1, y: y1 },
  ];
  return {
    page: 0,
    kind: 'fill',
    subpaths: [pts],
    bbox: { minX: x1, maxX: x2, minY: Math.min(y1, y2), maxY: Math.max(y1, y2) + thickness },
    lineWidth: 0,
    hasCurves: false,
  };
}

describe('duration rules', () => {
  it('derives quarter-note values from head shape, flags/beams and dots', () => {
    expect(noteDurationQn({ head: 'whole', flags: 0, beams: 0, dots: 0 })).toBe(4);
    expect(noteDurationQn({ head: 'half', flags: 0, beams: 0, dots: 0 })).toBe(2);
    expect(noteDurationQn({ head: 'half', flags: 0, beams: 0, dots: 1 })).toBe(3);
    expect(noteDurationQn({ head: 'black', flags: 0, beams: 0, dots: 0 })).toBe(1);
    expect(noteDurationQn({ head: 'black', flags: 1, beams: 0, dots: 0 })).toBe(0.5);
    expect(noteDurationQn({ head: 'black', flags: 0, beams: 2, dots: 0 })).toBe(0.25);
    expect(noteDurationQn({ head: 'black', flags: 0, beams: 1, dots: 1 })).toBe(0.75);
    expect(noteDurationQn({ head: 'black', flags: 0, beams: 0, dots: 2 })).toBe(1.75);
    expect(noteDurationQn({ head: 'breve', flags: 0, beams: 0, dots: 0 })).toBe(8);
    expect(applyDots(1, 3)).toBe(1.875);
  });

  it('finds the stem direction from the free end', () => {
    const up = { x: 10, y1: 0, y2: 20, thickness: 0.3 };
    expect(stemDirection(up, [19])).toBe('up');
    expect(stemFreeEnd(up, 'up')).toEqual({ x: 10, y: 0 });
    expect(stemDirection(up, [1])).toBe('down');
    expect(stemDirection(up, [2, 6, 19])).toBe('up');
  });

  it('recognises beams as wide, thin filled quads', () => {
    const space = 5;
    expect(asBeam(quad(0, 10, 40, 14, 2.2), space)).toBeDefined();
    expect(asBeam(quad(0, 10, 3, 10, 2.2), space)).toBeUndefined(); // too short
    expect(asBeam(quad(0, 10, 40, 10, 8), space)).toBeUndefined(); // too thick
    const stroke: PathShape = { ...quad(0, 10, 40, 10, 2), kind: 'stroke' };
    expect(asBeam(stroke, space)).toBeUndefined();
    const curved: PathShape = { ...quad(0, 10, 40, 10, 2), hasCurves: true };
    expect(asBeam(curved, space)).toBeUndefined();
  });

  it('measures a sloped beam at a given x', () => {
    const beam = asBeam(quad(0, 10, 40, 14, 2), 5)!;
    const [lo, hi] = polygonYRangeAt(beam.points, 20)!;
    expect(lo).toBeCloseTo(12);
    expect(hi).toBeCloseTo(14);
    expect(polygonYRangeAt(beam.points, 80)).toBeUndefined();
  });

  it('counts beams a stem passes through', () => {
    const space = 5;
    const beams = [asBeam(quad(0, 10, 40, 10, 2.2), space)!, asBeam(quad(0, 14, 40, 14, 2.2), space)!, asBeam(quad(0, 60, 40, 60, 2.2), space)!];
    expect(beamsCrossingStem({ x: 20, y1: 11, y2: 30, thickness: 0.3 }, beams, space)).toBe(2);
    expect(beamsCrossingStem({ x: 20, y1: 30, y2: 45, thickness: 0.3 }, beams, space)).toBe(0);
    expect(beamsCrossingStem({ x: 55, y1: 11, y2: 30, thickness: 0.3 }, beams, space)).toBe(0);
  });
});
