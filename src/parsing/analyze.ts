import type {
  ClefKind,
  KeySignature,
  Measure,
  ScoreModel,
  TempoMark,
  TimeSignature,
  Track,
} from '../core/types';
import { classifyGlyphs } from './glyphs';
import type { BBox, ClassifiedGlyph, PageExtraction, Point, Staff, System } from './model';
import {
  asBeam,
  beamsCrossingStem,
  applyDots,
  noteDurationQn,
  stemDirection,
  stemFreeEnd,
  type BeamShape,
  type StemLine,
} from './durations';
import { AccidentalMemory, degreeOf, diatonicToMidi, pitchLabel, stepToDiatonic, yToStep } from './pitch';
import { detectVoltas, openVoltaAtLineEnd, voltaForRegion, type BracketLabel, type VoltaBracket } from './repeats';
import { assembleMeasure, type OnsetAnchor, type RhythmItem } from './rhythm';
import {
  detectBarlines,
  detectSingleLineStaves,
  detectStaves,
  glyphCenterX,
  groupSystems,
  horizontalLines,
  measureRegions,
  mergeCollinear,
  polylineSegments,
  verticalLines,
  type HLine,
  type MeasureRegion,
  type VLine,
} from './staves';
import { sonataFamily } from './sonata';
import { buildTimeline, extendEndings, timelineDuration } from './timeline';
import { detectTuplets, parseTupletText, type TupletGroup, type TupletItem, type TupletLabel } from './tuplets';

export const RASTER_ERROR = 'This PDF looks scanned; only engraved (vector) PDFs are supported.';

export function legacyFontError(fileName: string, fontName: string): string {
  return `"${fileName}" uses the music font "${fontName}", which is not supported yet (Emmentaler and SMuFL fonts are).`;
}

export interface AnalyzeOptions {
  fileName: string;
  unfoldRepeats?: boolean;
  onProgress?: (fraction: number, stage: string) => void;
}

export interface DebugNote {
  page: number;
  x: number;
  y: number;
  midi: number;
  label: string;
  track: number;
  durationQn: number;
  grace: boolean;
  measure: number;
  onsetQn: number;
}

export interface DebugRest {
  page: number;
  x: number;
  y: number;
  durationQn: number;
  track: number;
  measure: number;
  onsetQn: number;
}

export interface DebugMeasure {
  index: number;
  page: number;
  x1: number;
  x2: number;
  top: number;
  bottom: number;
  repeatStart: boolean;
  repeatEnd: boolean;
  volta?: number[];
  method: string[];
}

export interface DebugBarline {
  page: number;
  x: number;
  y1: number;
  y2: number;
  thick: boolean;
  dotsLeft: boolean;
  dotsRight: boolean;
}

export interface ParseDebug {
  fonts: string[];
  glyphCounts: Record<string, number>;
  staves: Staff[];
  systems: Array<{ index: number; page: number; top: number; bottom: number; x1: number; x2: number; staves: number }>;
  barlines: DebugBarline[];
  measures: DebugMeasure[];
  notes: DebugNote[];
  rests: DebugRest[];
  stems: Array<{ page: number; x: number; y1: number; y2: number }>;
  beams: Array<{ page: number; points: Point[] }>;
  accidentals: Array<{ page: number; x: number; y: number; alteration: number; attached: boolean; key: boolean }>;
  clefs: Array<{ page: number; x: number; y: number; clef: ClefKind }>;
  voltas: Array<{ page: number; x1: number; x2: number; y: number; numbers: number[]; inherited?: boolean }>;
  tuplets: Array<{ page: number; x1: number; x2: number; y: number; actual: number; normal: number; staff: number }>;
  /** Tie links between two heads (one entry per merged pair; a tie broken at a line break spans two pages/lines). */
  ties: Array<{ page: number; x1: number; y1: number; x2: number; y2: number; page2: number; broken: boolean }>;
  /** Text runs on the pages (titles, composer, lyrics) so overlays can keep clear of them. */
  texts: Array<{ page: number; x: number; y: number; right: number; size: number }>;
}

interface StaffGlyphs {
  heads: ClassifiedGlyph[];
  rests: ClassifiedGlyph[];
  clefs: ClassifiedGlyph[];
  accidentals: ClassifiedGlyph[];
  dots: ClassifiedGlyph[];
  digits: ClassifiedGlyph[];
  /** Full-size 8 / 15 marks Sibelius draws next to octave clefs. */
  octaveMarks: ClassifiedGlyph[];
  tuplets: ClassifiedGlyph[];
  timesigs: ClassifiedGlyph[];
  flags: ClassifiedGlyph[];
  barlines: ClassifiedGlyph[];
}

interface StemRef extends StemLine {
  id: number;
  heads: HeadInfo[];
  direction: 'up' | 'down';
  flags: number;
  beams: number;
}

interface HeadInfo {
  id: string;
  glyph: ClassifiedGlyph;
  staff: Staff;
  cx: number;
  y: number;
  step: number;
  stem?: StemRef;
  dots: number;
  grace: boolean;
  accidental?: number;
  durationQn: number;
  diatonic: number;
  alteration: number;
  midi: number;
  tiedTo?: HeadInfo;
  tiedFrom?: HeadInfo;
  /** A tie arc leaves this head and runs off the right edge of its line. */
  tieOpen?: boolean;
  /** A tie arc arrives at this head from the left edge of its line. */
  tieContinuation?: boolean;
}

interface RestInfo {
  glyph: ClassifiedGlyph;
  durationQn: number;
  onset: number;
}

interface StaffMeasureResult {
  staff: Staff;
  heads: HeadInfo[];
  graces: HeadInfo[];
  rests: RestInfo[];
  onsets: Map<string, number>;
  totalQn: number;
  method: string;
  problem?: string;
  anchors: OnsetAnchor[];
  anomalies: number;
  /** Beam-only tuplet numbers that were needed to make the measure add up. */
  acceptedTuplets: TupletGroup[];
}

interface MeasureBuild {
  region: MeasureRegion;
  system: System;
  index: number;
  nominalQn: number;
  perStaff: StaffMeasureResult[];
  durationQn: number;
  volta?: number[];
}

/** Clef / key / time carried from system to system for one staff position. */
interface StaffState {
  clef: ClefKind;
  clefOctave: number;
  /** Half-spaces the clef sits above its standard line (0 for treble/bass/alto/tenor in place). */
  clefShift: number;
  fifths: number;
  time?: [number, number];
}

interface KeyChange {
  x: number;
  fifths: number;
  /** Printed at the end of a line for the next one: takes effect after its measure. */
  courtesy: boolean;
}

/** Per-system, per-staff symbols read before the measures are assembled. */
interface StaffAnalysis {
  heads: HeadInfo[];
  /** Clefs printed after the first note: they change the clef from where they stand. */
  changeClefs: ClassifiedGlyph[];
  keyChanges: KeyChange[];
  timeChanges: Array<{ x: number; time: [number, number] }>;
  ignoredAccidentals: ClassifiedGlyph[];
  /** Bracketed tuplets, already applied to the heads. */
  tuplets: TupletGroup[];
  /** Numbers centred over a beam: applied per measure only when the rhythm needs them. */
  tupletCandidates: TupletGroup[];
}

const TEMPO_WORDS: Array<[RegExp, number]> = [
  [/\bgrave\b/i, 40],
  [/\blargo\b/i, 50],
  [/\blento\b/i, 56],
  [/\badagio\b/i, 66],
  [/\bandante\b/i, 76],
  [/\bmoderato\b/i, 108],
  [/\ballegretto\b/i, 112],
  [/\ballegro\b/i, 120],
  [/\bvivace\b/i, 140],
  [/\bpresto\b/i, 168],
];

const SHARP_DEGREES = [3, 0, 4, 1, 5, 2, 6];
const FLAT_DEGREES = [6, 2, 5, 1, 4, 0, 3];

function emptyStaffGlyphs(): StaffGlyphs {
  return { heads: [], rests: [], clefs: [], accidentals: [], dots: [], digits: [], octaveMarks: [], tuplets: [], timesigs: [], flags: [], barlines: [] };
}

interface AmbiguousRest {
  glyph: ClassifiedGlyph;
  /** Nearest staff first. */
  candidates: [Staff, Staff];
}

/** Staves a glyph could belong to, nearest (by distance to the staff band) first. */
function staffCandidates(g: ClassifiedGlyph, staves: Staff[]): Array<{ staff: Staff; distance: number }> {
  const cx = glyphCenterX(g);
  const out: Array<{ staff: Staff; distance: number }> = [];
  for (const s of staves) {
    if (cx < s.x1 - 4 * s.space || cx > s.x2 + 2 * s.space) continue;
    const distance = g.y < s.top ? s.top - g.y : g.y > s.bottom ? g.y - s.bottom : 0;
    if (distance <= 9 * s.space) out.push({ staff: s, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** Every way of choosing candidate 0 or 1 for `n` floating rests, nearest-first. */
function restAssignments(n: number): number[][] {
  const count = Math.min(n, 4);
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << count; mask++) {
    const choice: number[] = [];
    for (let i = 0; i < n; i++) choice.push(i < count ? (mask >> i) & 1 : 0);
    out.push(choice);
  }
  return out;
}

function staffHeight(s: Staff): number {
  return 4 * s.space;
}

/** Every non-empty subset, smallest first (all at once beyond `max` items). */
function subsetsBySize<T>(items: T[], max = 5): T[][] {
  if (items.length > max) return [items];
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => (mask >> i) & 1));
  return out.sort((a, b) => a.length - b.length);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function inRegion(g: ClassifiedGlyph, r: MeasureRegion): boolean {
  const cx = glyphCenterX(g);
  return cx >= r.x1 && cx < r.x2;
}

function groupByX(glyphs: ClassifiedGlyph[], tolerance: number): ClassifiedGlyph[][] {
  const sorted = [...glyphs].sort((a, b) => a.x - b.x);
  const groups: ClassifiedGlyph[][] = [];
  for (const g of sorted) {
    const last = groups[groups.length - 1];
    if (last && g.x - last[last.length - 1].x <= tolerance) last.push(g);
    else groups.push([g]);
  }
  return groups;
}

/** Standard half-space position of each clef's reference line relative to the middle line. */
const CLEF_HOME: Partial<Record<ClefKind, number>> = { treble: -2, bass: 2, alto: 0 };

/**
 * Clef glyphs sit with their origin on the line they name (G, F or C), so the
 * origin's step tells which line that is: the tenor clef is a C clef two
 * half-spaces up; soprano, mezzo, baritone, French violin and sub-bass clefs
 * are reported as the base kind plus an even `shift` of at most four steps.
 */
function resolveClef(c: ClassifiedGlyph, staff: Staff): { kind: ClefKind; shift: number } {
  const kind = c.music.clef ?? 'unknown';
  const home = CLEF_HOME[kind];
  if (home === undefined) return { kind, shift: 0 };
  const step = yToStep(c.y, staff.lines[2], staff.space);
  if (kind === 'alto' && step === 2) return { kind: 'tenor', shift: 0 };
  const shift = step - home;
  return { kind, shift: shift % 2 === 0 && Math.abs(shift) <= 4 ? shift : 0 };
}

function clefOctaveFromDigits(c: ClassifiedGlyph, staff: Staff, digits: ClassifiedGlyph[]): number {
  if (c.music.clefOctave) return c.music.clefOctave;
  const sp = staff.space;
  const cx = glyphCenterX(c);
  for (const d of digits) {
    if (d.music.kind === 'digit' && d.size > 0.6 * staffHeight(staff)) continue;
    if (Math.abs(glyphCenterX(d) - cx) > 1.6 * sp) continue;
    const shift = d.music.digit === 8 ? 1 : d.music.digit === 5 || d.music.digit === 15 ? 2 : 0;
    if (!shift) continue;
    // Marks are centred (Opus) or sit on a baseline (Emmentaler); either way they are on the far side of the middle line.
    return d.y > staff.lines[2] ? -shift : shift;
  }
  return 0;
}

/** Two treble clefs drawn on top of each other: the old-style "treble clef down one octave". */
function doubledTrebleClefs(clefs: ClassifiedGlyph[], sp: number): Map<ClassifiedGlyph, 'first' | 'second'> {
  const roles = new Map<ClassifiedGlyph, 'first' | 'second'>();
  for (let i = 0; i + 1 < clefs.length; i++) {
    const a = clefs[i];
    const b = clefs[i + 1];
    if (a.music.clef === 'treble' && b.music.clef === 'treble' && Math.abs(b.y - a.y) < 0.5 * sp && b.x - a.x < 2.5 * sp && !roles.has(a)) {
      roles.set(a, 'first');
      roles.set(b, 'second');
    }
  }
  return roles;
}

function isOctaveDigit(d: ClassifiedGlyph, staff: Staff, clefs: ClassifiedGlyph[]): boolean {
  return clefs.some((c) => Math.abs(glyphCenterX(d) - glyphCenterX(c)) <= 1.6 * staff.space);
}

/** Stacked full-size digits (numerator above the middle line, denominator below) or a C/¢ glyph. */
function readTimeSignatures(bag: StaffGlyphs, staff: Staff): Array<{ x: number; time: [number, number] }> {
  const out: Array<{ x: number; time: [number, number] }> = [];
  const sp = staff.space;
  const middle = staff.lines[2];
  const big = bag.digits.filter((d) => d.size >= 0.6 * staffHeight(staff));
  for (const grp of groupByX(big, 1.6 * sp)) {
    // Emmentaler digits sit on their baseline (numerator on the middle line); SMuFL digits are centred (numerator one space above it).
    const upper = grp.filter((d) => d.y < middle + 0.5 * sp).sort((a, b) => a.x - b.x);
    const lower = grp.filter((d) => d.y >= middle + 0.5 * sp).sort((a, b) => a.x - b.x);
    if (!upper.length || !lower.length) continue;
    const num = Number(upper.map((d) => d.music.digit).join(''));
    const den = Number(lower.map((d) => d.music.digit).join(''));
    if (num > 0 && den > 0) out.push({ x: grp[0].x, time: [num, den] });
  }
  for (const t of bag.timesigs) if (t.music.timesig) out.push({ x: t.x, time: t.music.timesig });
  return out.sort((a, b) => a.x - b.x);
}

interface KeyAnchor {
  x: number;
  /** How far after the anchor the first accidental may start. */
  reach: number;
  clef: ClefKind;
  clefOctave: number;
  clefShift: number;
  /** Anchored at the closing barline of a line: the signature is a courtesy for the next line. */
  courtesy: boolean;
  /** Anchored right after a clef, where no note can stand. */
  afterClef: boolean;
  regionEnd?: number;
}

interface KeyGroup {
  glyphs: ClassifiedGlyph[];
  fifths: number;
  courtesy: boolean;
}

function keyDegrees(fifths: number): Set<number> {
  return new Set(fifths > 0 ? SHARP_DEGREES.slice(0, fifths) : fifths < 0 ? FLAT_DEGREES.slice(0, -fifths) : []);
}

/**
 * Key signatures are full-size accidentals packed tightly right after a clef or
 * a barline (or before the last barline of a line), on distinct steps, in the
 * circle-of-fifths order for the clef in force. Cancellation naturals are
 * checked against the key running at that point of the line. A group followed
 * closely by heads on every one of its steps is a chord's accidentals instead.
 */
function readKeyGroups(accidentals: ClassifiedGlyph[], heads: ClassifiedGlyph[], staff: Staff, anchors: KeyAnchor[], prevFifths: number): KeyGroup[] {
  const sp = staff.space;
  const full = accidentals.filter((a) => a.size >= 0.85 * staffHeight(staff)).sort((a, b) => a.x - b.x);
  const used = new Set<ClassifiedGlyph>();
  const groups: KeyGroup[] = [];
  const degreeAt = (g: ClassifiedGlyph, anchor: KeyAnchor): number =>
    degreeOf(stepToDiatonic(yToStep(g.y, staff.lines[2], sp), anchor.clef === 'unknown' ? 'treble' : anchor.clef, anchor.clefOctave, anchor.clefShift));
  let prevDegrees = keyDegrees(prevFifths);
  const headOnStepAfter = (g: ClassifiedGlyph, right: number): boolean => {
    const step = yToStep(g.y, staff.lines[2], sp);
    return heads.some((h) => {
      const dx = glyphCenterX(h) - right;
      return dx >= -0.2 * sp && dx <= 2.2 * sp && yToStep(h.y, staff.lines[2], sp) === step;
    });
  };
  for (const anchor of [...anchors].sort((a, b) => a.x - b.x)) {
    const start = full.find((a) => !used.has(a) && a.x >= anchor.x - 0.3 * sp && a.x <= anchor.x + anchor.reach);
    if (!start) continue;
    const glyphs: ClassifiedGlyph[] = [];
    const steps = new Set<number>();
    let sign = 0;
    let count = 0;
    let ok = true;
    for (let i = full.indexOf(start); i < full.length; i++) {
      const g = full[i];
      if (used.has(g)) break;
      const prev = glyphs[glyphs.length - 1];
      if (prev && g.x - prev.x > 1.8 * sp) break;
      if (anchor.regionEnd !== undefined && g.x + g.advance > anchor.regionEnd + 0.5 * sp) break;
      const step = yToStep(g.y, staff.lines[2], sp);
      if (steps.has(step)) break;
      const alt = g.music.accidental ?? 0;
      const degree = degreeAt(g, anchor);
      if (alt === 0) {
        if (sign !== 0 || !prevDegrees.has(degree)) {
          if (!glyphs.length) ok = false;
          break;
        }
      } else if (Math.abs(alt) === 1) {
        if (sign === 0) sign = alt;
        if (alt !== sign) break;
        const order = sign > 0 ? SHARP_DEGREES : FLAT_DEGREES;
        if (count >= 7 || order[count] !== degree) {
          if (!glyphs.length) ok = false;
          break;
        }
        count++;
      } else break;
      glyphs.push(g);
      steps.add(step);
    }
    if (!ok || !glyphs.length) continue;
    const last = glyphs[glyphs.length - 1];
    const groupRight = last.x + last.advance;
    if (glyphs.length === 1 && headOnStepAfter(glyphs[0], groupRight)) continue;
    if (!anchor.afterClef && glyphs.length > 1 && glyphs.every((g) => headOnStepAfter(g, groupRight))) continue;
    if (anchor.courtesy) {
      const end = anchor.regionEnd ?? anchor.x;
      if (groupRight < end - 2.5 * sp) continue;
      if (heads.some((h) => glyphCenterX(h) > glyphs[0].x && glyphCenterX(h) < end)) continue;
    }
    for (const g of glyphs) used.add(g);
    groups.push({ glyphs, fifths: sign * count, courtesy: anchor.courtesy });
    if (!anchor.courtesy) prevDegrees = keyDegrees(sign * count);
  }
  return groups;
}

/** Thin vertical lines touching at least one notehead; barlines never do. */
function buildStems(
  verticals: VLine[],
  heads: ClassifiedGlyph[],
  system: System,
  band: [number, number],
  beams: BeamShape[],
  nextId: () => number,
): StemRef[] {
  const stems: StemRef[] = [];
  const sp = system.staves[0].space;
  for (const v of verticals) {
    if (v.thickness > 0.3 * sp || v.y2 - v.y1 < 1.0 * sp) continue;
    const mid = (v.y1 + v.y2) / 2;
    if (mid < band[0] || mid > band[1]) continue;
    if (v.x < system.x1 - sp || v.x > system.x2 + sp) continue;
    const attached = heads.some((h) => Math.abs(glyphCenterX(h) - v.x) <= 0.9 * sp && h.y >= v.y1 - 0.7 * sp && h.y <= v.y2 + 0.7 * sp);
    if (!attached) continue;
    const dup = stems.some((s) => Math.abs(s.x - v.x) < 0.15 * sp && Math.abs(s.y1 - v.y1) < 0.5 * sp && Math.abs(s.y2 - v.y2) < 0.5 * sp);
    if (dup) continue;
    const stem: StemRef = { id: nextId(), x: v.x, y1: v.y1, y2: v.y2, thickness: v.thickness, heads: [], direction: 'up', flags: 0, beams: 0 };
    stem.beams = beamsCrossingStem(stem, beams, sp);
    stems.push(stem);
  }
  return stems;
}

function attachStems(infos: HeadInfo[], stems: StemRef[], flagGlyphs: ClassifiedGlyph[], sp: number): void {
  for (const info of infos) {
    let best: StemRef | undefined;
    let bestDx = Infinity;
    for (const s of stems) {
      const dx = Math.abs(s.x - info.cx);
      if (dx > 0.9 * sp) continue;
      if (info.y < s.y1 - 0.7 * sp || info.y > s.y2 + 0.7 * sp) continue;
      if (dx < bestDx) {
        bestDx = dx;
        best = s;
      }
    }
    if (best) {
      info.stem = best;
      best.heads.push(info);
    }
  }
  for (const s of stems) {
    if (!s.heads.length) continue;
    s.direction = stemDirection(s, s.heads.map((h) => h.y));
    const end = stemFreeEnd(s, s.direction);
    const flags = flagGlyphs.filter((f) => Math.abs(f.x - s.x) <= 0.7 * sp && Math.abs(f.y - end.y) <= 1.6 * sp);
    s.flags = flags.length ? Math.max(...flags.map((f) => f.music.flags ?? 1)) : 0;
  }
}

/**
 * Ties are flat, short curved fills whose ends sit on two neighbouring heads at
 * the same staff position. A slur can start and end on the same pitch too, so
 * any head of the same voice between the two ends rules the curve out. A tie
 * broken at a line break leaves one half-arc running to the right edge of the
 * line and another arriving from the left edge of the next; those are only
 * marked here and joined once the next system's heads are known.
 */
function detectTies(page: PageExtraction, heads: HeadInfo[], system: System): void {
  const sp = system.staves[0].space;
  for (const path of page.paths) {
    if (path.kind !== 'fill' || !path.hasCurves) continue;
    const w = path.bbox.maxX - path.bbox.minX;
    const h = path.bbox.maxY - path.bbox.minY;
    // Ties stay flat; long ones (whole notes across a barline) may reach ~25 sp and rise a little more.
    if (w < 1.2 * sp || w > 25 * sp || h > Math.max(1.6 * sp, 0.12 * w)) continue;
    if (path.bbox.minY > system.bottom + 10 * sp || path.bbox.maxY < system.top - 10 * sp) continue;
    const pts = path.subpaths.flat();
    let left = pts[0];
    let right = pts[0];
    for (const p of pts) {
      if (p.x < left.x) left = p;
      if (p.x > right.x) right = p;
    }
    const near = (p: Point, side: 'left' | 'right'): HeadInfo | undefined => {
      let best: HeadInfo | undefined;
      let bestD = Infinity;
      for (const hd of heads) {
        const dx = side === 'left' ? p.x - hd.cx : hd.cx - p.x;
        if (dx < -0.4 * sp || dx > 1.8 * sp) continue;
        const dy = Math.abs(hd.y - p.y);
        if (dy > 1.6 * sp) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = hd;
        }
      }
      return best;
    };
    const a = near(left, 'left');
    const b = near(right, 'right');
    if (a && !b && right.x >= a.staff.x2 - 1.5 * sp && right.x > a.cx + 0.5 * sp) {
      a.tieOpen = true;
      continue;
    }
    if (b && !a && left.x < b.cx - 0.5 * sp && left.x >= b.staff.x1 - 2 * sp) {
      // The stub is drawn after the clef, key and time signature, which push it well past the line's
      // left edge; a half-arc arriving at the first head of its staff can only be a continuation.
      const firstOfLine = !heads.some((hd) => hd.staff === b.staff && !hd.grace && hd.cx < b.cx - 0.5 * sp);
      if (left.x <= system.x1 + 6 * sp || firstOfLine) {
        b.tieContinuation = true;
        continue;
      }
    }
    if (!(a && b && a !== b && a.staff === b.staff && a.step === b.step && b.cx > a.cx && !a.tiedTo && !b.tiedFrom)) continue;
    const between = heads.filter((hd) => hd.staff === a.staff && !hd.grace && hd.cx > a.cx + 0.5 * sp && hd.cx < b.cx - 0.5 * sp);
    const sameVoice = between.some((hd) => !a.stem || !hd.stem || hd.stem.direction === a.stem.direction);
    if (sameVoice) continue;
    a.tiedTo = b;
    b.tiedFrom = a;
  }
}

/** Join the open tie halves of the previous line to the continuation halves on this one, by staff position and step. */
function joinBrokenTies(open: HeadInfo[], system: System, headsOf: (staff: Staff) => HeadInfo[]): void {
  for (const a of open) {
    const staff = system.staves[a.staff.index];
    if (!staff) continue;
    const b = headsOf(staff)
      .filter((h) => h.tieContinuation && !h.tiedFrom && h.step === a.step)
      .sort((x, y) => x.cx - y.cx)[0];
    if (!b) continue;
    a.tiedTo = b;
    b.tiedFrom = a;
  }
}

interface TitleRun {
  text: string;
  size: number;
  x: number;
  right: number;
  y: number;
}

/** Largest text near the top of the first page is the title; the largest right-aligned run the composer. */
function readTitle(page: PageExtraction | undefined): { title?: string; composer?: string } {
  if (!page) return {};
  const lines: TitleRun[] = [];
  const top = [...page.texts].filter((t) => t.y < page.height * 0.3 && t.text.trim().length > 1).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of top) {
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(prev.y - t.y) <= t.size * 0.3 && t.x <= prev.right + t.size * 2) {
      prev.text += ` ${t.text.trim()}`;
      prev.right = Math.max(prev.right, t.right);
      prev.size = Math.max(prev.size, t.size);
    } else lines.push({ text: t.text.trim(), size: t.size, x: t.x, right: t.right, y: t.y });
  }
  if (!lines.length) return {};
  const title = [...lines].sort((a, b) => b.size - a.size)[0];
  const composer = lines
    .filter((r) => r !== title && r.x > page.width * 0.5 && r.right > page.width * 0.6)
    .sort((a, b) => b.size - a.size)[0];
  return { title: title.text, composer: composer?.text };
}

/**
 * Quarter notes per beat for the note glyph of a metronome mark. Sonata-layout
 * text fonts (Opus Text, Opus Metronome) expose their glyphs as PUA code
 * points F0xx of the Sonata letters (w h q e x); a following dot lengthens by half.
 */
export function metronomeBeatQn(text: string): number {
  const beforeEquals = text.split('=')[0];
  const m = /([\uf000-\uf0ff\u{1d15d}-\u{1d161}\u2669-\u266b])(\s*[.\uf02e\uf06b])?/u.exec(beforeEquals);
  if (!m) return 1;
  const cp = m[1].codePointAt(0)!;
  const code = cp >= 0xf000 && cp <= 0xf0ff ? cp - 0xf000 : cp;
  const base: Record<number, number> = {
    0x77: 4, // w
    0x57: 8, // W
    0x68: 2, // h H
    0x48: 2,
    0x71: 1, // q Q
    0x51: 1,
    0x65: 0.5, // e E
    0x45: 0.5,
    0x78: 0.25, // x X
    0x58: 0.25,
    0x1d15d: 4,
    0x1d15e: 2,
    0x2669: 1,
    0x1d15f: 1,
    0x266a: 0.5,
    0x1d160: 0.5,
    0x1d161: 0.25,
  };
  const qn = base[code] ?? 1;
  return m[2] ? qn * 1.5 : qn;
}

export function readTempo(page: PageExtraction | undefined): { bpm: number; text: string } | undefined {
  if (!page) return undefined;
  for (const t of page.texts) {
    const m = /=\s*(?:ca\.?\s*|c\.\s*|approx\.?\s*|about\s*)?(\d{2,3})\b/i.exec(t.text);
    if (m) {
      // The metronome note glyph usually comes from another font (a Sonata-layout text font such as
      // Opus Text, whose letters w h q e are note values) and therefore another run on the same line.
      const line = page.texts
        .filter((o) => Math.abs(o.y - t.y) <= 0.6 * Math.max(o.size, t.size) && o.right <= t.x + 0.5 * t.size && o.right >= t.x - 6 * t.size)
        .sort((a, b) => a.x - b.x)
        .map((o) => (sonataFamily(o.fontName) ? [...o.text].map((c) => (c.charCodeAt(0) < 0x80 ? String.fromCharCode(0xf000 + c.charCodeAt(0)) : c)).join('') : o.text))
        .join(' ');
      const beat = Number(m[1]);
      const bpm = Math.round(beat * metronomeBeatQn(`${line} ${t.text}`));
      if (beat >= 20 && beat <= 300 && bpm >= 20 && bpm <= 400) return { bpm, text: `${line} ${t.text}`.trim() };
    }
  }
  for (const t of page.texts) {
    for (const [re, bpm] of TEMPO_WORDS) if (re.test(t.text)) return { bpm, text: t.text.trim() };
  }
  return undefined;
}

function dedupeByMeasure<T extends { measure: number }>(list: T[]): T[] {
  const out: T[] = [];
  for (const item of list) {
    const i = out.findIndex((o) => o.measure === item.measure);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out.sort((a, b) => a.measure - b.measure);
}

/** Thin horizontal strokes that are not staff lines: tuplet and volta brackets, ottava lines. */
function bracketLines(page: PageExtraction, staves: Staff[]): HLine[] {
  const segs = polylineSegments(page.paths);
  const sp = staves[0]?.space ?? 5;
  return mergeCollinear([...horizontalLines(page.paths), ...segs.horizontal], 0.5 * sp).filter(
    (h) => h.thickness <= 0.4 * sp && h.x2 - h.x1 >= 1 * sp && !staves.some((s) => s.lines.some((y) => Math.abs(y - h.y) < 0.3)),
  );
}

export function analyze(pages: PageExtraction[], opts: AnalyzeOptions): { score: ScoreModel; debug: ParseDebug } {
  const progress = (f: number, stage: string): void => opts.onProgress?.(f, stage);
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  progress(0.55, 'Classifying glyphs');
  const fontFamilies = new Map<string, string>();
  for (const p of pages) for (const f of p.fonts) fontFamilies.set(f.name, f.family);
  const musicFonts = [...fontFamilies].filter(([, fam]) => fam !== 'text').map(([n]) => n);
  const legacyFonts = [...fontFamilies].filter(([, fam]) => fam === 'legacy-music').map(([n]) => n);
  for (const name of legacyFonts) warn(`Music font "${name}" is not a SMuFL or Emmentaler font; its glyphs may be misread.`);
  const classified = pages.map((p) => classifyGlyphs(p.glyphs));
  const glyphCounts: Record<string, number> = {};
  for (const list of classified) for (const g of list) glyphCounts[g.music.kind] = (glyphCounts[g.music.kind] ?? 0) + 1;
  if ((glyphCounts.notehead ?? 0) + (glyphCounts.clef ?? 0) + (glyphCounts.rest ?? 0) === 0) {
    if (legacyFonts.length) throw new Error(legacyFontError(opts.fileName, legacyFonts[0]));
    throw new Error(RASTER_ERROR);
  }

  progress(0.6, 'Detecting staves and systems');
  const allStaves: Staff[] = [];
  const systems: System[] = [];
  const verticalsByPage: VLine[][] = [];
  const beamsByPage: BeamShape[][] = [];
  const bracketsByPage: HLine[][] = [];
  for (const p of pages) {
    const staves = detectStaves(p.paths, p.index);
    const percussionClefs = classified[p.index]
      .filter((g) => g.music.kind === 'clef' && g.music.clef === 'percussion')
      .map((g) => ({ x: glyphCenterX(g), y: g.y }));
    const singleLine = detectSingleLineStaves(p.paths, p.index, staves, percussionClefs);
    if (singleLine.length) {
      staves.push(...singleLine);
      staves.sort((a, b) => a.top - b.top);
    }
    const verticals = verticalLines(p.paths);
    verticalsByPage[p.index] = verticals;
    const space = staves[0]?.space ?? 5;
    beamsByPage[p.index] = p.paths.map((path) => asBeam(path, space)).filter((b): b is BeamShape => !!b);
    bracketsByPage[p.index] = bracketLines(p, staves);
    systems.push(...groupSystems(staves, verticals, p.index, systems.length));
    allStaves.push(...staves);
  }
  if (!allStaves.length) throw new Error('No staff lines were found in this PDF, so it cannot be read as sheet music.');

  const stavesPerSystem = systems.map((s) => s.staves.length);
  if (new Set(stavesPerSystem).size > 1) {
    warn(`Systems have differing staff counts (${[...new Set(stavesPerSystem)].join(', ')}); staves are matched to tracks by kind (rhythm line, drum staff, pitched staff) and position from the top.`);
  }

  const glyphsByStaff = new Map<Staff, StaffGlyphs>();
  for (const s of allStaves) glyphsByStaff.set(s, emptyStaffGlyphs());
  const headsByPage: ClassifiedGlyph[][] = pages.map((p) => classified[p.index].filter((g) => g.music.kind === 'notehead'));
  const stemsBySystem = new Map<System, StemRef[]>();
  let stemCounter = 0;
  for (const system of systems) {
    const page = system.page;
    const above = systems.filter((s) => s.page === page && s.bottom < system.top).sort((a, b) => b.bottom - a.bottom)[0];
    const below = systems.filter((s) => s.page === page && s.top > system.bottom).sort((a, b) => a.top - b.top)[0];
    // Everything up to the midpoint of the gap to the neighbouring system belongs to this one.
    const band: [number, number] = [above ? (above.bottom + system.top) / 2 : -Infinity, below ? (system.bottom + below.top) / 2 : Infinity];
    stemsBySystem.set(system, buildStems(verticalsByPage[page], headsByPage[page], system, band, beamsByPage[page], () => stemCounter++));
  }
  const ambiguousRests: AmbiguousRest[] = [];
  for (const p of pages) {
    const pageStaves = allStaves.filter((s) => s.page === p.index);
    for (const g of classified[p.index]) {
      const kind = g.music.kind;
      if (kind === 'other' || kind === 'ornament' || kind === 'brace') continue;
      const candidates = staffCandidates(g, pageStaves);
      if (!candidates.length) continue;
      let staff = candidates[0].staff;
      const inGap = candidates.length > 1 && candidates[1].staff.system === staff.system && candidates[0].distance > 1.5 * staff.space;
      if (inGap && kind === 'rest') {
        ambiguousRests.push({ glyph: g, candidates: [candidates[0].staff, candidates[1].staff] });
        continue;
      }
      if (inGap && kind === 'notehead' && candidates[0].distance > 2.5 * staff.space) {
        // A head this far into the gap needs ledger lines; its stem points back at its own staff.
        const sp = staff.space;
        const cx = glyphCenterX(g);
        const stem = (stemsBySystem.get(systems[staff.system]) ?? []).find(
          (s) => Math.abs(s.x - cx) <= 0.9 * sp && g.y >= s.y1 - 0.7 * sp && g.y <= s.y2 + 0.7 * sp,
        );
        if (stem) {
          const up = g.y - stem.y1 >= stem.y2 - g.y;
          const [upper, lower] = [candidates[0].staff, candidates[1].staff].sort((a, b) => a.top - b.top);
          staff = up ? upper : lower;
        }
      }
      const bag = glyphsByStaff.get(staff)!;
      if (kind === 'notehead') bag.heads.push(g);
      else if (kind === 'rest') bag.rests.push(g);
      else if (kind === 'clef') bag.clefs.push(g);
      else if (kind === 'accidental') bag.accidentals.push(g);
      else if (kind === 'dot') bag.dots.push(g);
      else if (kind === 'digit') bag.digits.push(g);
      else if (kind === 'clefOctave') bag.octaveMarks.push(g);
      else if (kind === 'tuplet') bag.tuplets.push(g);
      else if (kind === 'timesig') bag.timesigs.push(g);
      else if (kind === 'flag') bag.flags.push(g);
      else if (kind === 'barline') bag.barlines.push(g);
    }
  }

  const debug: ParseDebug = {
    fonts: musicFonts,
    glyphCounts,
    staves: allStaves,
    systems: systems.map((s) => ({ index: s.index, page: s.page, top: s.top, bottom: s.bottom, x1: s.x1, x2: s.x2, staves: s.staves.length })),
    barlines: [],
    measures: [],
    notes: [],
    rests: [],
    stems: [],
    beams: [],
    accidentals: [],
    clefs: [],
    voltas: [],
    tuplets: [],
    ties: [],
    texts: pages.flatMap((p) => p.texts.map((t) => ({ page: p.index, x: t.x, y: t.y, right: t.right, size: t.size }))),
  };
  for (const p of pages) for (const b of beamsByPage[p.index]) debug.beams.push({ page: p.index, points: b.points });
  for (const [system, stems] of stemsBySystem) for (const st of stems) debug.stems.push({ page: system.page, x: st.x, y1: st.y1, y2: st.y2 });

  // Staves become tracks by kind and vertical order, so a choral score whose
  // percussion lines come and go keeps its voices on the same tracks.
  type StaffKind = 'rhythm' | 'drum' | 'pitched';
  const KIND_ORDER: StaffKind[] = ['rhythm', 'drum', 'pitched'];
  const kindOf = (staff: Staff): StaffKind => {
    if (staff.lineCount === 1) return 'rhythm';
    const first = [...glyphsByStaff.get(staff)!.clefs].sort((a, b) => a.x - b.x)[0];
    return first?.music.clef === 'percussion' ? 'drum' : 'pitched';
  };
  const kindMax: Record<StaffKind, number> = { rhythm: 0, drum: 0, pitched: 0 };
  for (const system of systems) {
    const counts: Record<StaffKind, number> = { rhythm: 0, drum: 0, pitched: 0 };
    for (const staff of system.staves) counts[kindOf(staff)]++;
    for (const k of KIND_ORDER) kindMax[k] = Math.max(kindMax[k], counts[k]);
  }
  const kindOffset: Record<StaffKind, number> = { rhythm: 0, drum: kindMax.rhythm, pitched: kindMax.rhythm + kindMax.drum };
  const trackCount = kindMax.rhythm + kindMax.drum + kindMax.pitched;
  const trackSlot = new Map<Staff, number>();
  const signatureStaff = new Map<System, Staff>();
  for (const system of systems) {
    const counts: Record<StaffKind, number> = { rhythm: 0, drum: 0, pitched: 0 };
    for (const staff of system.staves) {
      const k = kindOf(staff);
      trackSlot.set(staff, kindOffset[k] + counts[k]++);
    }
    signatureStaff.set(system, system.staves.find((st) => kindOf(st) === 'pitched') ?? system.staves[0]);
  }
  const slot = (staff: Staff): number => trackSlot.get(staff)!;
  const trackKind = (i: number): StaffKind => (i < kindOffset.drum ? 'rhythm' : i < kindOffset.pitched ? 'drum' : 'pitched');

  progress(0.7, 'Reading notes');
  const staffStates: StaffState[] = [];
  for (let i = 0; i < trackCount; i++) staffStates.push({ clef: 'unknown', clefOctave: 0, clefShift: 0, fifths: 0 });
  const firstClefs = new Map<number, ClefKind>();
  const measures: MeasureBuild[] = [];
  const timeSignatures: TimeSignature[] = [];
  const keySignatures: KeySignature[] = [];
  let headCounter = 0;
  const clefWarned = new Set<number>();
  let openVolta: number[] | undefined;
  let openTies: HeadInfo[] = [];

  for (const system of systems) {
    const page = system.page;
    const sp0 = system.staves[0].space;
    const sysDots = system.staves.flatMap((s) => glyphsByStaff.get(s)!.dots);
    const sysFlags = system.staves.flatMap((s) => glyphsByStaff.get(s)!.flags);
    const sysBarlineGlyphs = system.staves.flatMap((s) => glyphsByStaff.get(s)!.barlines);
    const groups = detectBarlines(system, verticalsByPage[page], headsByPage[page], sysDots, sysBarlineGlyphs);
    for (const g of groups) {
      debug.barlines.push({ page, x: g.x, y1: system.top, y2: system.bottom, thick: g.thick, dotsLeft: g.dotsLeft, dotsRight: g.dotsRight });
    }
    const systemRests = ambiguousRests.filter((r) => r.candidates[0].system === system.index);
    const regions = measureRegions(system, groups).filter(
      (r) =>
        system.staves.some((s) => {
          const bag = glyphsByStaff.get(s)!;
          return bag.heads.some((h) => inRegion(h, r)) || bag.rests.some((h) => inRegion(h, r));
        }) || systemRests.some((ar) => inRegion(ar.glyph, r)),
    );
    if (!regions.length) {
      warn(`System ${system.index + 1} on page ${page + 1} has no measures with notes and was skipped.`);
      continue;
    }

    const smallDigitLabels = (staff: Staff, clefs: ClassifiedGlyph[]): ClassifiedGlyph[][] => {
      const bag = glyphsByStaff.get(staff)!;
      const small = [...bag.tuplets, ...bag.digits.filter((d) => d.size < 0.6 * staffHeight(staff) && !isOctaveDigit(d, staff, clefs))];
      return groupByX(small, 0.9 * staff.space);
    };
    const segs = polylineSegments(pages[page].paths);
    const voltaLabels: BracketLabel[] = [
      ...pages[page].texts.map((t) => ({ x: t.x, y: t.y, text: t.text })),
      ...system.staves.flatMap((s) =>
        smallDigitLabels(s, glyphsByStaff.get(s)!.clefs).map((grp) => ({ x: grp[0].x, y: grp[0].y, text: grp.map((d) => d.music.digit).join('') })),
      ),
    ];
    const firstHeadX = Math.min(...system.staves.flatMap((s) => glyphsByStaff.get(s)!.heads.map(glyphCenterX)));
    const voltas: VoltaBracket[] = detectVoltas(
      [...horizontalLines(pages[page].paths), ...segs.horizontal],
      [...verticalsByPage[page], ...segs.vertical],
      voltaLabels,
      system,
      openVolta,
      Number.isFinite(firstHeadX) ? firstHeadX : undefined,
    );
    openVolta = openVoltaAtLineEnd(voltas, system);
    for (const v of voltas) debug.voltas.push({ page, x1: v.x1, x2: v.x2, y: v.y, numbers: v.numbers, inherited: v.inherited });
    const isVoltaLabel = (x: number, y: number): boolean => voltas.some((v) => Math.abs(v.label.x - x) < 0.01 && Math.abs(v.label.y - y) < 0.01);
    const tupletBrackets = bracketsByPage[page].filter(
      (h) => !voltas.some((v) => Math.abs(v.y - h.y) < 0.5 && h.x1 < v.x2 + sp0 && h.x2 > v.x1 - sp0),
    );

    const stems = stemsBySystem.get(system)!;
    const analyses = new Map<Staff, StaffAnalysis>();
    for (const staff of system.staves) {
      const bag = glyphsByStaff.get(staff)!;
      const state = staffStates[slot(staff)];
      const sp = staff.space;
      const firstNoteX = Math.min(Infinity, ...bag.heads.map(glyphCenterX), ...bag.rests.map(glyphCenterX));

      const clefs = [...bag.clefs].sort((a, b) => a.x - b.x);
      const changeClefs: ClassifiedGlyph[] = [];
      const marks = [...bag.digits, ...bag.octaveMarks];
      const doubled = doubledTrebleClefs(clefs, sp);
      const octaveOf = (c: ClassifiedGlyph): number => (doubled.get(c) === 'first' ? -1 : clefOctaveFromDigits(c, staff, marks));
      for (const c of clefs) {
        if (doubled.get(c) === 'second') continue;
        const { kind, shift } = resolveClef(c, staff);
        debug.clefs.push({ page, x: c.x, y: c.y, clef: kind });
        if (c.x < firstNoteX) {
          state.clef = kind;
          state.clefShift = shift;
          state.clefOctave = octaveOf(c);
          if (!firstClefs.has(slot(staff))) firstClefs.set(slot(staff), kind);
        } else changeClefs.push(c);
      }
      if (state.clef === 'unknown' && !clefWarned.has(staff.index)) {
        clefWarned.add(staff.index);
        warn(`No clef found for staff ${staff.index + 1}; treble clef assumed.`);
      }
      const clefAtX = (x: number): { clef: ClefKind; octave: number; shift: number } => {
        let clef = state.clef;
        let octave = state.clefOctave;
        let shift = state.clefShift;
        for (const c of changeClefs) {
          if (c.x < x) {
            ({ kind: clef, shift } = resolveClef(c, staff));
            octave = octaveOf(c);
          }
        }
        return { clef, octave, shift };
      };

      const anchorAt = (x: number, reach: number, kind: 'clef' | 'region' | 'courtesy', regionEnd?: number): KeyAnchor => {
        const { clef, octave, shift } = clefAtX(x + 0.01);
        return { x, reach, courtesy: kind === 'courtesy', afterClef: kind === 'clef', regionEnd, clef, clefOctave: octave, clefShift: shift };
      };
      const anchors: KeyAnchor[] = [];
      for (const c of clefs) anchors.push(anchorAt(c.x + c.advance, 3 * sp, 'clef'));
      for (const r of regions) anchors.push(anchorAt(r.x1, 4 * sp, 'region'));
      const lastRegion = regions[regions.length - 1];
      anchors.push(anchorAt(lastRegion.x2 - 9 * sp, 9 * sp, 'courtesy', lastRegion.x2));
      const keyGroups = readKeyGroups(bag.accidentals, bag.heads, staff, anchors, state.fifths);
      const keyGlyphs = new Set(keyGroups.flatMap((g) => g.glyphs));

      const attached = new Set<ClassifiedGlyph>();
      const headAccidental = new Map<ClassifiedGlyph, ClassifiedGlyph>();
      for (const h of bag.heads) {
        const hx = glyphCenterX(h);
        let best: ClassifiedGlyph | undefined;
        for (const a of bag.accidentals) {
          if (keyGlyphs.has(a)) continue;
          if (Math.abs(a.y - h.y) > 0.35 * sp) continue;
          const dx = hx - (a.x + a.advance);
          if (dx < -0.2 * sp || dx > 4.5 * sp) continue;
          if (!best || a.x > best.x) best = a;
        }
        if (best) {
          headAccidental.set(h, best);
          attached.add(best);
        }
      }
      const ignoredAccidentals: ClassifiedGlyph[] = [];
      for (const a of bag.accidentals) {
        const key = keyGlyphs.has(a);
        debug.accidentals.push({ page, x: a.x, y: a.y, alteration: a.music.accidental ?? 0, attached: attached.has(a), key });
        if (!key && !attached.has(a)) ignoredAccidentals.push(a);
      }
      const keyChanges: KeyChange[] = keyGroups.map((g) => ({ x: g.glyphs[0].x, fifths: g.fifths, courtesy: g.courtesy }));

      const heads: HeadInfo[] = bag.heads.map((h) => ({
        id: `h${headCounter++}`,
        glyph: h,
        staff,
        cx: glyphCenterX(h),
        y: h.y,
        step: yToStep(h.y, staff.lines[2], sp),
        dots: 0,
        grace: h.size < 0.85 * staffHeight(staff),
        accidental: headAccidental.get(h)?.music.accidental,
        durationQn: 0,
        diatonic: 0,
        alteration: 0,
        midi: 0,
      }));
      attachStems(heads, stems, sysFlags, sp);
      for (const info of heads) {
        const right = info.glyph.x + info.glyph.advance;
        info.dots = bag.dots.filter((d) => {
          const dx = glyphCenterX(d) - right;
          return dx >= -0.3 * sp && dx <= 1.8 * sp && Math.abs(d.y - info.y) <= 0.8 * sp;
        }).length;
        info.durationQn = noteDurationQn({
          head: info.glyph.music.head ?? 'black',
          flags: info.stem?.flags ?? 0,
          beams: info.stem?.beams ?? 0,
          dots: info.dots,
        });
      }

      const tupletLabels: TupletLabel[] = [];
      for (const grp of smallDigitLabels(staff, clefs)) {
        if (isVoltaLabel(grp[0].x, grp[0].y)) continue;
        const parsed = parseTupletText(grp.map((d) => d.music.digit).join(''));
        if (!parsed) continue;
        tupletLabels.push({ cx: (grp[0].x + grp[grp.length - 1].x + grp[grp.length - 1].advance) / 2, y: grp[0].y, size: grp[0].size, ...parsed });
      }
      for (const t of pages[page].texts) {
        if (t.x < system.x1 + 1.5 * sp || t.x > system.x2 || t.size > 0.8 * staffHeight(staff) || isVoltaLabel(t.x, t.y)) continue;
        if (t.y < staff.top - 10 * sp || t.y > staff.bottom + 10 * sp) continue;
        const parsed = parseTupletText(t.text);
        if (parsed) tupletLabels.push({ cx: (t.x + t.right) / 2, y: t.y, size: t.size, ...parsed });
      }
      const tupletItems: TupletItem[] = heads.map((h) => ({ id: h.id, cx: h.cx, y: h.y, stemId: h.stem?.id, grace: h.grace }));
      const beamBoxes: BBox[] = beamsByPage[page].map((b) => b.bbox);
      const detected = detectTuplets(tupletLabels, tupletItems, beamBoxes, tupletBrackets, staff);
      const tuplets = detected.filter((t) => t.source === 'bracket');
      for (const t of tuplets) {
        debug.tuplets.push({ page, x1: t.x1, x2: t.x2, y: t.y, actual: t.actual, normal: t.normal, staff: staff.index });
        const ids = new Set(t.itemIds);
        for (const h of heads) if (ids.has(h.id)) h.durationQn *= t.ratio;
      }

      analyses.set(staff, {
        heads,
        changeClefs,
        keyChanges,
        timeChanges: readTimeSignatures(bag, staff),
        ignoredAccidentals,
        tuplets,
        tupletCandidates: detected.filter((t) => t.source === 'beam'),
      });
    }

    detectTies(pages[page], [...analyses.values()].flatMap((a) => a.heads), system);
    joinBrokenTies(openTies, system, (staff) => analyses.get(staff)!.heads);
    openTies = [...analyses.values()].flatMap((a) => a.heads.filter((h) => h.tieOpen && !h.tiedTo));

    for (const region of regions) {
      const index = measures.length;
      const build: MeasureBuild = { region, system, index, nominalQn: 0, perStaff: [], durationQn: 0, volta: voltaForRegion(voltas, region.x1, region.x2, sp0) };
      const regionClefs = new Map<Staff, ClassifiedGlyph[]>();
      const courtesyKeys: Array<{ staff: Staff; fifths: number }> = [];
      for (const staff of system.staves) {
        const state = staffStates[slot(staff)];
        const sp = staff.space;
        const analysis = analyses.get(staff)!;
        regionClefs.set(
          staff,
          analysis.changeClefs.filter((c) => c.x >= region.x1 - 0.5 * sp && c.x < region.x2),
        );
        for (const kc of analysis.keyChanges) {
          if (kc.x < region.x1 - 0.5 * sp || kc.x >= region.x2) continue;
          if (kc.courtesy) {
            courtesyKeys.push({ staff, fifths: kc.fifths });
            continue;
          }
          if (kc.fifths !== state.fifths || index === 0) {
            state.fifths = kc.fifths;
            if (staff === signatureStaff.get(system)) keySignatures.push({ measure: index, fifths: kc.fifths });
          }
        }
        for (const tc of analysis.timeChanges) {
          if (tc.x >= region.x1 - 0.5 * sp && tc.x < region.x2) {
            state.time = tc.time;
            if (staff === signatureStaff.get(system)) timeSignatures.push({ measure: index, beats: tc.time[0], beatType: tc.time[1] });
          }
        }
        for (const a of analysis.ignoredAccidentals) {
          if (inRegion(a, region)) warn(`Measure ${index + 1}, staff ${staff.index + 1}: an accidental not attached to any note was ignored.`);
        }
      }
      if (index === 0 && !keySignatures.length) keySignatures.push({ measure: 0, fifths: staffStates[slot(signatureStaff.get(system)!)].fifths });
      const time = staffStates.find((s) => s.time)?.time;
      if (index === 0 && !timeSignatures.length && time) timeSignatures.push({ measure: 0, beats: time[0], beatType: time[1] });
      build.nominalQn = time ? (time[0] * 4) / time[1] : 0;

      const exactFit = (r: { problem?: string; method: string }): boolean => !r.problem && (r.method === 'single' || r.method === 'two-voice' || r.method === 'empty');

      const beatQn = time ? 4 / time[1] : 1;
      const multipleOf = (qn: number, unit: number): boolean => Math.abs(qn / unit - Math.round(qn / unit)) < 1e-3;
      const opensSection = index === 0 || region.repeatStart;
      const closesSection = !!region.closing && (region.closing.dotsLeft || region.closing.thick);
      const lastOfPiece = system === systems[systems.length - 1] && region === regions[regions.length - 1];
      // The bar that opened the current section (the piece, or the last |:); a short closing bar may complete its pickup.
      const opener = [...measures].reverse().find((m) => m.region.repeatStart) ?? measures[0];
      const completesPickup = (qn: number): boolean =>
        !!opener && opener.durationQn < opener.nominalQn - 1e-3 && Math.abs(opener.durationQn + qn - build.nominalQn) < 1e-3;
      // A lone staff cannot corroborate a short bar, so it must look like one: a whole number of beats, a pickup of
      // at most half a bar opening a section, or a closing bar that adds up with that pickup to a full bar.
      const sensibleShort = (qn: number): boolean =>
        build.nominalQn > 0 &&
        qn > 0 &&
        qn < build.nominalQn - 1e-3 &&
        multipleOf(qn, 0.125) &&
        (multipleOf(qn, beatQn) || (opensSection && qn <= build.nominalQn / 2 + 1e-3) || ((closesSection || lastOfPiece) && completesPickup(qn)));
      // Two or more staves corroborate each other: any short bar on the 32nd grid they agree on is believable.
      const shortLegal = (qn: number): boolean =>
        build.nominalQn > 0 && qn > 0 && qn < build.nominalQn - 1e-3 && multipleOf(qn, 0.125) && (system.staves.length > 1 || sensibleShort(qn));

      const assembleStaff = (staff: Staff, extraRests: ClassifiedGlyph[]): StaffMeasureResult => {
        const state = staffStates[slot(staff)];
        const sp = staff.space;
        const analysis = analyses.get(staff)!;
        const bag = glyphsByStaff.get(staff)!;
        const heads = analysis.heads.filter((h) => h.cx >= region.x1 && h.cx < region.x2).sort((a, b) => a.cx - b.cx);
        const memory = new AccidentalMemory(state.fifths);
        const baseClef: ClefKind = state.clef === 'unknown' ? 'treble' : state.clef;
        const clefAt = (x: number): { clef: ClefKind; octave: number; shift: number } => {
          let clef: ClefKind = baseClef;
          let octave = state.clefOctave;
          let shift = state.clefShift;
          for (const c of regionClefs.get(staff) ?? []) {
            if (c.x < x) {
              ({ kind: clef, shift } = resolveClef(c, staff));
              octave = clefOctaveFromDigits(c, staff, [...bag.digits, ...bag.octaveMarks]);
            }
          }
          return { clef, octave, shift };
        };
        for (const info of heads) {
          const { clef, octave, shift } = clefAt(info.cx);
          info.diatonic = stepToDiatonic(info.step, clef, octave, shift);
          info.alteration = memory.resolve(info.diatonic, info.accidental);
          info.midi = Math.max(0, Math.min(127, diatonicToMidi(info.diatonic, info.alteration)));
        }
        const soundingHeads = heads.filter((h) => !h.grace);
        const candidates = analysis.tupletCandidates.filter((t) => t.x1 >= region.x1 - 2 * sp && t.x2 <= region.x2 + 2 * sp);

        const attempt = (applied: TupletGroup[]): StaffMeasureResult => {
          // Bracket tuplets are already baked into the heads' durations; rests are re-derived here, so they see both.
          const restRatioAt = (cx: number): number =>
            [...analysis.tuplets, ...applied].find((g) => cx >= g.x1 - 0.3 * sp && cx <= g.x2 + 0.3 * sp)?.ratio ?? 1;
          const headRatio = (id: string): number => applied.find((g) => g.itemIds.includes(id))?.ratio ?? 1;
          const rests: RestInfo[] = [...bag.rests.filter((r) => inRegion(r, region)), ...extraRests].map((r) => {
            const right = r.x + r.advance;
            const dots = bag.dots.filter((d) => {
              const dx = glyphCenterX(d) - right;
              return dx >= -0.3 * sp && dx <= 1.8 * sp && Math.abs(d.y - r.y) <= 1.5 * sp;
            }).length;
            return { glyph: r, durationQn: applyDots(r.music.restQn ?? 1, dots) * restRatioAt(glyphCenterX(r)), onset: 0 };
          });
          if (rests.length === 1 && !soundingHeads.length && build.nominalQn && rests[0].durationQn >= 2) {
            rests[0].durationQn = build.nominalQn;
          }
          const items: RhythmItem[] = soundingHeads.map((h) => ({
            id: h.id,
            kind: 'note' as const,
            x: h.cx,
            y: h.y,
            durationQn: h.durationQn * headRatio(h.id),
            stem: h.stem?.direction,
            stemId: h.stem?.id,
          }));
          rests.forEach((r, i) => items.push({ id: `r${i}`, kind: 'rest', x: glyphCenterX(r.glyph), y: r.glyph.y, durationQn: r.durationQn }));
          const result = assembleMeasure(items, {
            measureQn: build.nominalQn || undefined,
            space: sp,
            middleY: staff.lines[2],
            xRange: [region.x1, region.x2],
          });
          rests.forEach((r, i) => (r.onset = result.onsets.get(`r${i}`) ?? 0));
          return {
            staff,
            heads: soundingHeads,
            graces: heads.filter((h) => h.grace),
            rests,
            onsets: result.onsets,
            totalQn: result.totalQn,
            method: result.method,
            problem: result.problem,
            anchors: result.anchors,
            anomalies: result.anomalies,
            acceptedTuplets: applied,
          };
        };
        // A number over a beam is a fingering as often as a tuplet: keep the smallest set of such numbers
        // that makes a bar add up which does not add up without them. With nothing to check against, a
        // number is believed only when it counts an odd beamed group of at least three notes.
        if (!candidates.length) return attempt([]);
        if (!build.nominalQn) return attempt(candidates.filter((c) => c.itemIds.length >= 3 && c.itemIds.length % 2 === 1 && c.itemIds.length === c.actual));
        const plain = attempt([]);
        if (exactFit(plain)) return plain;
        let shortFallback: StaffMeasureResult | undefined;
        for (const subset of subsetsBySize(candidates)) {
          const scaled = attempt(subset);
          if (exactFit(scaled)) return scaled;
          if (!shortFallback && scaled.method === 'single' && sensibleShort(scaled.totalQn)) shortFallback = scaled;
        }
        // Neither fits: in a pickup or closing bar the reading that gives a believable short length wins.
        if (plain.method === 'single' && sensibleShort(plain.totalQn)) return plain;
        return shortFallback ?? plain;
      };

      // Rests floating between two staves belong to whichever staff they complete.
      const floating = systemRests.filter((ar) => inRegion(ar.glyph, region));
      let best: StaffMeasureResult[] | undefined;
      let bestScore = -Infinity;
      for (const choice of restAssignments(floating.length)) {
        const results = system.staves.map((staff) =>
          assembleStaff(
            staff,
            floating.filter((ar, i) => ar.candidates[choice[i]] === staff).map((ar) => ar.glyph),
          ),
        );
        const exact = results.filter(exactFit).length;
        const score = exact * 10 - results.reduce((s, r) => s + r.anomalies, 0);
        if (score > bestScore) {
          bestScore = score;
          best = results;
        }
      }
      build.perStaff = best ?? [];
      for (const r of build.perStaff) {
        for (const t of r.acceptedTuplets) {
          debug.tuplets.push({ page: system.page, x1: t.x1, x2: t.x2, y: t.y, actual: t.actual, normal: t.normal, staff: r.staff.index });
          const ids = new Set(t.itemIds);
          for (const h of r.heads) if (ids.has(h.id)) h.durationQn *= t.ratio;
        }
      }

      const clean = build.perStaff.find((r) => r.method === 'single' || r.method === 'two-voice');
      for (const r of build.perStaff) {
        if ((r.method === 'proportional' || r.method === 'aligned') && clean && clean !== r) {
          const items: RhythmItem[] = [
            ...r.heads.map((h) => ({ id: h.id, kind: 'note' as const, x: h.cx, y: h.y, durationQn: h.durationQn, stem: h.stem?.direction, stemId: h.stem?.id })),
            ...r.rests.map((rest, i) => ({ id: `r${i}`, kind: 'rest' as const, x: glyphCenterX(rest.glyph), y: rest.glyph.y, durationQn: rest.durationQn })),
          ];
          const again = assembleMeasure(items, {
            measureQn: build.nominalQn || undefined,
            space: r.staff.space,
            middleY: r.staff.lines[2],
            xRange: [region.x1, region.x2],
            anchors: clean.anchors,
          });
          r.onsets = again.onsets;
          r.method = again.method;
          r.problem = again.problem;
          r.rests.forEach((rest, i) => (rest.onset = again.onsets.get(`r${i}`) ?? 0));
        }
      }

      const totals = build.perStaff.map((r) => r.totalQn).filter((t) => t > 0);
      const maxTotal = totals.length ? Math.max(...totals) : 0;
      const shortAgreed = build.nominalQn > 0 && maxTotal > 0 && maxTotal < build.nominalQn - 1e-3 && totals.every((t) => Math.abs(t - maxTotal) < 1e-3);
      const short = shortAgreed && shortLegal(maxTotal);
      if (!build.nominalQn) build.durationQn = maxTotal || 1;
      else if (short) build.durationQn = maxTotal;
      else build.durationQn = build.nominalQn;
      // An anacrusis (or the short bar closing a section that it completes) is a legitimate short measure.
      const pickup = short && (opensSection || closesSection || lastOfPiece);
      for (const r of build.perStaff) {
        if (!r.problem || (pickup && r.method === 'single')) continue;
        const how =
          r.method === 'aligned' ? 'aligned with the other staff' : r.method === 'proportional' ? 'spaced by position' : 'read left to right';
        warn(`Measure ${index + 1}, staff ${r.staff.index + 1}: ${r.problem}; onsets were ${how}.`);
      }

      for (const staff of system.staves) {
        const state = staffStates[slot(staff)];
        const bag = glyphsByStaff.get(staff)!;
        for (const c of regionClefs.get(staff) ?? []) {
          ({ kind: state.clef, shift: state.clefShift } = resolveClef(c, staff));
          state.clefOctave = clefOctaveFromDigits(c, staff, [...bag.digits, ...bag.octaveMarks]);
        }
      }
      for (const ck of courtesyKeys) {
        const state = staffStates[slot(ck.staff)];
        if (ck.fifths !== state.fifths) {
          state.fifths = ck.fifths;
          if (ck.staff === signatureStaff.get(system)) keySignatures.push({ measure: index + 1, fifths: ck.fifths });
        }
      }
      measures.push(build);
    }
  }

  if (!measures.length) throw new Error('No measures with notes were found in this PDF.');
  if (!timeSignatures.length) warn('No time signature found; measure lengths were taken from the note durations.');

  progress(0.85, 'Building timeline');
  const repeatMeasures = extendEndings(
    measures.map((m) => ({ durationQn: m.durationQn, repeatStart: m.region.repeatStart, repeatEnd: m.region.repeatEnd, volta: m.volta })),
  );
  const timeline = buildTimeline(repeatMeasures, opts.unfoldRepeats !== false);
  const durationQn = timelineDuration(timeline);
  const occurrences = new Map<number, number[]>();
  for (const seg of timeline) {
    if (!occurrences.has(seg.measure)) occurrences.set(seg.measure, []);
    occurrences.get(seg.measure)!.push(seg.startQn);
  }

  const isPiano = trackCount === 2 && firstClefs.get(0) === 'treble' && firstClefs.get(1) === 'bass';
  const tracks: Track[] = [];
  for (let i = 0; i < trackCount; i++) {
    tracks.push({
      id: `track-${i + 1}`,
      name: isPiano
        ? i === 0
          ? 'Right hand'
          : 'Left hand'
        : trackKind(i) === 'pitched'
          ? `Staff ${i - kindOffset.pitched + 1}`
          : `Percussion ${i + 1}`,
      instrument: trackKind(i) === 'pitched' ? 'piano' : 'other',
      clef: firstClefs.get(i) ?? 'unknown',
      staffIndex: i,
      notes: [],
      defaultGain: 0.8,
    });
  }

  const scoreMeasures: Measure[] = measures.map((m, i) => ({
    index: m.index,
    durationQn: m.durationQn,
    firstStartQn: occurrences.get(m.index)?.[0] ?? 0,
    volta: repeatMeasures[i].volta,
    layout: m.system.staves.map((s) => ({
      page: s.page,
      x: m.region.x1,
      y: s.top - 1.5 * s.space,
      width: m.region.x2 - m.region.x1,
      height: staffHeight(s) + 3 * s.space,
    })),
    repeatStart: m.region.repeatStart || undefined,
    repeatEnd: m.region.repeatEnd || undefined,
  }));

  const noteCounters = tracks.map(() => 0);
  for (const m of measures) {
    debug.measures.push({
      index: m.index,
      page: m.system.page,
      x1: m.region.x1,
      x2: m.region.x2,
      top: m.system.top,
      bottom: m.system.bottom,
      repeatStart: m.region.repeatStart,
      repeatEnd: m.region.repeatEnd,
      volta: m.volta,
      method: m.perStaff.map((r) => r.method),
    });
    for (const r of m.perStaff) {
      const staff = r.staff;
      const track = tracks[slot(staff)];
      if (!track) continue;
      const emit = (info: HeadInfo, onset: number, dur: number, grace: boolean, measureIndex = m.index): void => {
        debug.notes.push({
          page: staff.page,
          x: info.cx,
          y: info.y,
          midi: info.midi,
          label: pitchLabel(info.diatonic, info.alteration),
          track: slot(staff),
          durationQn: dur,
          grace,
          measure: measureIndex,
          onsetQn: onset,
        });
        for (const start of occurrences.get(measureIndex) ?? []) {
          track.notes.push({
            id: `${track.id}-${noteCounters[slot(staff)]++}`,
            trackId: track.id,
            midi: info.midi,
            startQn: round4(start + onset),
            durationQn: round4(dur),
            velocity: grace ? 0.6 : 0.8,
            measure: measureIndex,
            layout: { page: staff.page, x: info.cx, y: info.y },
            grace: grace || undefined,
          });
        }
      };
      for (const info of r.heads) {
        if (info.tiedFrom) continue;
        let dur = info.durationQn;
        let prev = info;
        let next = info.tiedTo;
        let guard = 0;
        while (next && guard++ < 16) {
          dur += next.durationQn;
          debug.ties.push({ page: prev.staff.page, x1: prev.cx, y1: prev.y, x2: next.cx, y2: next.y, page2: next.staff.page, broken: !!prev.tieOpen });
          prev = next;
          next = next.tiedTo;
        }
        emit(info, r.onsets.get(info.id) ?? 0, dur, false);
      }
      const graces = [...r.graces].sort((a, b) => a.cx - b.cx);
      for (const g of graces) {
        const following = r.heads.filter((h) => h.cx > g.cx).sort((a, b) => a.cx - b.cx)[0];
        const groupAfter = graces.filter((o) => o.cx > g.cx && (!following || o.cx < following.cx)).length;
        const target = following ? (r.onsets.get(following.id) ?? m.durationQn) : m.durationQn;
        const onset = target - 0.125 * (groupAfter + 1);
        // A grace printed at the start of a bar borrows the last beat of the previous bar (as LilyPond's MIDI
        // does), so it is filed under the bar whose time it occupies even though its head sits in the next one.
        if (onset < 0 && m.index > 0) emit(g, measures[m.index - 1].durationQn + onset, 0.125, true, m.index - 1);
        else emit(g, Math.max(0, onset), 0.125, true);
      }
      for (const rest of r.rests) {
        debug.rests.push({ page: staff.page, x: glyphCenterX(rest.glyph), y: rest.glyph.y, durationQn: rest.durationQn, track: staff.index, measure: m.index, onsetQn: rest.onset });
      }
    }
  }
  for (const t of tracks) t.notes.sort((a, b) => a.startQn - b.startQn || a.midi - b.midi);
  if (!tracks.some((t) => t.notes.length)) throw new Error('No notes could be read from this PDF.');

  const { title, composer } = readTitle(pages[0]);
  const tempo = readTempo(pages[0]);
  const tempoMarks: TempoMark[] = tempo ? [{ qn: 0, bpm: tempo.bpm, text: tempo.text }] : [];

  const score: ScoreModel = {
    title,
    composer,
    source: { fileName: opts.fileName, pageCount: pages.length, engine: 'vector', fonts: musicFonts },
    tempoBpm: tempo?.bpm ?? 100,
    tempoMarks,
    timeSignatures: dedupeByMeasure(timeSignatures),
    keySignatures: dedupeByMeasure(keySignatures),
    measures: scoreMeasures,
    timeline,
    tracks,
    durationQn,
    warnings,
  };
  progress(0.95, 'Assembling score');
  return { score, debug };
}
