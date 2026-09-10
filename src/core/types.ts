/**
 * Shared domain model. Every subsystem (ui, parsing, audio) depends on this
 * file and on contracts.ts only. Nothing in core imports from a subsystem.
 *
 * Time unit: "qn" = quarter notes from the start of the (repeat-unfolded)
 * playback timeline. Tempo is expressed as quarter notes per minute.
 * Layout coordinates are PDF points in a top-left-origin viewport at scale 1
 * (what pdf.js `page.getViewport({ scale: 1 })` produces).
 */

export type ClefKind = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion' | 'unknown';

export type ParseEngine = 'vector' | 'raster';

export interface LayoutBox {
  page: number; // 0-based page index
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutPoint {
  page: number;
  x: number;
  y: number;
}

export interface NoteEvent {
  id: string;
  trackId: string;
  /** MIDI note number, 0..127. */
  midi: number;
  /** Onset on the unfolded playback timeline, in quarter notes. */
  startQn: number;
  /** Sounding duration in quarter notes (> 0). */
  durationQn: number;
  /** 0..1 */
  velocity: number;
  /**
   * Index into ScoreModel.measures: the measure whose time span contains
   * `startQn` (normally the printed measure of the head). A grace note printed
   * at the start of a bar borrows the end of the previous bar and is filed
   * under that previous bar; its `layout` then lies in the next measure's box.
   */
  measure: number;
  /** Position of the notehead on the page, for playhead highlighting. */
  layout?: LayoutPoint;
  /** True for ornaments/grace notes that were realized with a nominal duration. */
  grace?: boolean;
}

export interface Track {
  id: string;
  /** Human-readable label, e.g. "Right hand", "Violin I", "Staff 2". */
  name: string;
  /** General MIDI-ish hint the audio module may use to pick a timbre. */
  instrument: 'piano' | 'strings' | 'woodwind' | 'brass' | 'guitar' | 'organ' | 'voice' | 'other';
  clef: ClefKind;
  /** Index of this track's staff within a system (0 = top). */
  staffIndex: number;
  notes: NoteEvent[];
  /** Default mixer gain 0..1 (parsers should emit 0.8). */
  defaultGain: number;
}

export interface Measure {
  /** 0-based printed measure index, in reading order. */
  index: number;
  /** Nominal length of the measure from the time signature, in quarter notes. */
  durationQn: number;
  /** Bounding boxes of this measure on each staff (one per track/staff). */
  layout: LayoutBox[];
  /** Start of the first playback occurrence of this measure, in quarter notes. */
  firstStartQn: number;
  /** Barline decorations for playback and display. */
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** Passes on which this measure is played when it sits under a volta bracket (e.g. [1] or [2]); absent = every pass. */
  volta?: number[];
}

/** One entry per measure occurrence on the unfolded playback timeline. */
export interface TimelineSegment {
  measure: number;
  startQn: number;
  durationQn: number;
}

export interface TimeSignature {
  measure: number;
  beats: number;
  beatType: number;
}

export interface KeySignature {
  measure: number;
  /** Positive = sharps, negative = flats. */
  fifths: number;
}

export interface TempoMark {
  qn: number;
  bpm: number;
  text?: string;
}

export interface ScoreModel {
  title?: string;
  composer?: string;
  source: {
    fileName: string;
    pageCount: number;
    engine: ParseEngine;
    /** Music font families recognised, e.g. ["Emmentaler-20"]. */
    fonts?: string[];
  };
  /** Initial tempo in quarter notes per minute. Parsers default to 100. */
  tempoBpm: number;
  tempoMarks: TempoMark[];
  timeSignatures: TimeSignature[];
  keySignatures: KeySignature[];
  measures: Measure[];
  timeline: TimelineSegment[];
  tracks: Track[];
  /** Total playback length of the unfolded timeline in quarter notes. */
  durationQn: number;
  /** Human-readable, non-fatal parse problems. Empty on a clean parse. */
  warnings: string[];
}

export interface PageInfo {
  index: number;
  /** Size in PDF points at scale 1. */
  width: number;
  height: number;
}

export interface TrackMixState {
  trackId: string;
  gain: number; // 0..1
  muted: boolean;
  solo: boolean;
  /** Recent peak output level 0..1, for meters. May be 0 if unsupported. */
  level: number;
}

export interface TransportState {
  playing: boolean;
  /** Current playhead on the unfolded timeline, in quarter notes. */
  positionQn: number;
  tempoBpm: number;
  masterGain: number;
  tracks: TrackMixState[];
  /** Web Audio context state, for diagnostics. */
  contextState: 'suspended' | 'running' | 'closed' | 'none';
}

export type AppStatus = 'idle' | 'loading' | 'parsing' | 'ready' | 'error';

export interface ParseProgress {
  /** 0..1 */
  fraction: number;
  stage: string;
}

export interface AppState {
  status: AppStatus;
  fileName?: string;
  progress?: ParseProgress;
  score?: ScoreModel;
  pages: PageInfo[];
  error?: string;
  transport: TransportState;
}

/** Mapping helpers shared by all modules. */
export function qnToSeconds(qn: number, bpm: number): number {
  return (qn * 60) / bpm;
}

export function secondsToQn(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

export function midiToName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[((midi % 12) + 12) % 12]}${octave}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
