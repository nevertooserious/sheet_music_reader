import type { BBox, HeadShape, PathShape, Point } from './model';

export interface StemLine {
  x: number;
  /** Top end (smaller y). */
  y1: number;
  /** Bottom end (larger y). */
  y2: number;
  thickness: number;
}

export interface BeamShape {
  points: Point[];
  bbox: BBox;
}

export function headBaseQn(head: HeadShape): number {
  switch (head) {
    case 'breve':
      return 8;
    case 'whole':
      return 4;
    case 'half':
      return 2;
    default:
      return 1;
  }
}

export interface DurationInput {
  head: HeadShape;
  flags: number;
  beams: number;
  dots: number;
}

/** Notehead shape + flags/beams (each halves a quarter) + augmentation dots → quarter notes. */
export function noteDurationQn({ head, flags, beams, dots }: DurationInput): number {
  let qn = headBaseQn(head);
  if (head === 'black') {
    const halvings = Math.max(flags, beams);
    qn = 1 / Math.pow(2, halvings);
  }
  return applyDots(qn, dots);
}

export function applyDots(qn: number, dots: number): number {
  let extra = 0;
  let part = qn / 2;
  for (let i = 0; i < dots; i++) {
    extra += part;
    part /= 2;
  }
  return qn + extra;
}

/**
 * Which way a stem points relative to the heads attached to it: the end that
 * extends further beyond the heads is the free end.
 */
export function stemDirection(stem: StemLine, headYs: number[]): 'up' | 'down' {
  const top = Math.min(...headYs);
  const bottom = Math.max(...headYs);
  const above = top - stem.y1;
  const below = stem.y2 - bottom;
  return above >= below ? 'up' : 'down';
}

export function stemFreeEnd(stem: StemLine, direction: 'up' | 'down'): Point {
  return { x: stem.x, y: direction === 'up' ? stem.y1 : stem.y2 };
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/**
 * A beam is a filled, straight-edged quadrilateral much wider than it is
 * thick, with a vertical thickness of roughly half a staff space.
 */
export function asBeam(path: PathShape, space: number): BeamShape | undefined {
  if (path.kind !== 'fill' || path.hasCurves || path.subpaths.length !== 1) return undefined;
  const pts = dedupeClosing(path.subpaths[0]);
  if (pts.length < 4 || pts.length > 6) return undefined;
  const width = path.bbox.maxX - path.bbox.minX;
  if (width < 0.8 * space) return undefined;
  const thickness = polygonArea(pts) / width;
  if (thickness < 0.2 * space || thickness > 0.9 * space) return undefined;
  const height = path.bbox.maxY - path.bbox.minY;
  if (height > width * 1.2 + thickness) return undefined;
  return { points: pts, bbox: path.bbox };
}

function dedupeClosing(points: Point[]): Point[] {
  if (points.length > 1) {
    const a = points[0];
    const b = points[points.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) return points.slice(0, -1);
  }
  return points;
}

/** Vertical extent of a polygon along the line x = `x`, or undefined when it misses. */
export function polygonYRangeAt(points: Point[], x: number): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
      const y = Math.abs(b.x - a.x) < 1e-9 ? Math.min(a.y, b.y) : a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      if (Math.abs(b.x - a.x) < 1e-9) hi = Math.max(hi, Math.max(a.y, b.y));
    }
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** Number of beams a stem passes through (each halves the note value). */
export function beamsCrossingStem(stem: StemLine, beams: BeamShape[], space: number): number {
  let count = 0;
  const slack = 0.3 * space;
  for (const beam of beams) {
    if (stem.x < beam.bbox.minX - slack || stem.x > beam.bbox.maxX + slack) continue;
    const probeX = Math.min(Math.max(stem.x, beam.bbox.minX), beam.bbox.maxX);
    const range = polygonYRangeAt(beam.points, probeX);
    if (!range) continue;
    const [lo, hi] = range;
    if (hi >= stem.y1 - 0.6 * space && lo <= stem.y2 + 0.6 * space) count++;
  }
  return count;
}
