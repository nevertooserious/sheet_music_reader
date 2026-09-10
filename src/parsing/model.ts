import type { ClefKind } from '../core/types';

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (PDF convention). */
export type Matrix = [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type FontFamily = 'emmentaler' | 'smufl' | 'legacy-music' | 'text';

export interface FontInfo {
  id: string;
  /** PostScript name without the subset prefix, e.g. "Emmentaler-20". */
  name: string;
  family: FontFamily;
}

/** One glyph drawn from an embedded font, in top-left viewport coordinates at scale 1. */
export interface GlyphPlacement {
  page: number;
  fontId: string;
  fontName: string;
  family: FontFamily;
  code: number;
  /** Glyph name from the font's Differences array or base encoding, when known. */
  name?: string;
  unicode?: string;
  /** Glyph origin on the page. */
  x: number;
  y: number;
  /** Horizontal advance on the page (points). */
  advance: number;
  /** Rendered em size on the page (points). */
  size: number;
}

export type PaintKind = 'stroke' | 'fill';

/** A painted path, flattened to polylines, in top-left viewport coordinates. */
export interface PathShape {
  page: number;
  kind: PaintKind;
  subpaths: Point[][];
  bbox: BBox;
  /** Stroke width on the page (points); 0 for fills. */
  lineWidth: number;
  hasCurves: boolean;
}

export interface TextRun {
  page: number;
  fontName: string;
  text: string;
  x: number;
  y: number;
  /** Rendered font size on the page (points). */
  size: number;
  /** Right edge of the run. */
  right: number;
}

export interface PageExtraction {
  index: number;
  width: number;
  height: number;
  fonts: FontInfo[];
  glyphs: GlyphPlacement[];
  paths: PathShape[];
  texts: TextRun[];
  imageCount: number;
}

export type MusicGlyphKind =
  | 'notehead'
  | 'clef'
  | 'accidental'
  | 'rest'
  | 'flag'
  | 'dot'
  | 'digit'
  | 'tuplet'
  | 'timesig'
  | 'barline'
  | 'brace'
  | 'ornament'
  | 'other';

export type HeadShape = 'breve' | 'whole' | 'half' | 'black';

export type BarlineGlyph = 'single' | 'double' | 'final' | 'repeatStart' | 'repeatEnd' | 'repeatBoth';

export interface MusicGlyph {
  kind: MusicGlyphKind;
  head?: HeadShape;
  clef?: ClefKind;
  /** Octave transposition printed on the clef (−2..2). */
  clefOctave?: number;
  /** Alteration in semitones (natural = 0). */
  accidental?: number;
  /** Nominal rest length in quarter notes before dots. */
  restQn?: number;
  /** Number of flags (1 = eighth). */
  flags?: number;
  digit?: number;
  timesig?: [number, number];
  barline?: BarlineGlyph;
}

export interface ClassifiedGlyph extends GlyphPlacement {
  music: MusicGlyph;
}

export interface Staff {
  page: number;
  /** y of the five lines, top to bottom. */
  lines: number[];
  top: number;
  bottom: number;
  x1: number;
  x2: number;
  /** Staff space (distance between adjacent lines). */
  space: number;
  /** Position within its system (0 = top). */
  index: number;
  system: number;
}

export interface System {
  index: number;
  page: number;
  staves: Staff[];
  top: number;
  bottom: number;
  x1: number;
  x2: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  kind: PaintKind;
}
