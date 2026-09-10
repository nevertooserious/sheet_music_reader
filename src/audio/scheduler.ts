import type { NoteEvent } from '../core/types';
import { qnToSeconds, secondsToQn } from '../core/types';

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;

export const SCHEDULER = {
  tickMs: 25,
  horizonSeconds: 0.15,
  /** Hidden tabs may still see 1 Hz timers if the Worker clock is unavailable, so the window must outlast a whole throttled tick. */
  hiddenHorizonSeconds: 1.5,
  /** Added when (re)starting so the first notes are not already in the past when the tick hands them over. */
  startLatencySeconds: 0.03,
  seekLatencySeconds: 0.02,
  /** Notes whose ideal start is closer than this (or already past) are started this far ahead of the clock instead of being dropped. */
  minLeadSeconds: 0.005,
  minNoteSeconds: 0.03,
} as const;

const QN_EPSILON = 1e-6;

/** Maps the audio clock to score time: positionQn(t) = anchorQn + (t - anchorTime) at tempoBpm. */
export interface ClockAnchor {
  anchorQn: number;
  anchorTime: number;
  tempoBpm: number;
}

export function clampTempo(bpm: number, fallback = 100): number {
  if (!Number.isFinite(bpm)) return fallback;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm));
}

export function horizonFor(hidden: boolean): number {
  return hidden ? SCHEDULER.hiddenHorizonSeconds : SCHEDULER.horizonSeconds;
}

export function positionAt(anchor: ClockAnchor, time: number): number {
  return anchor.anchorQn + secondsToQn(Math.max(0, time - anchor.anchorTime), anchor.tempoBpm);
}

export function timeForQn(anchor: ClockAnchor, qn: number): number {
  return anchor.anchorTime + qnToSeconds(qn - anchor.anchorQn, anchor.tempoBpm);
}

export interface RebaseOptions {
  positionQn?: number;
  tempoBpm?: number;
  latencySeconds?: number;
}

/** New anchor at `time`; keeps the current position (or moves to `positionQn`) so tempo/seek changes never jump the playhead. */
export function rebase(anchor: ClockAnchor, time: number, options: RebaseOptions = {}): ClockAnchor {
  return {
    anchorQn: options.positionQn ?? positionAt(anchor, time),
    anchorTime: time + (options.latencySeconds ?? 0),
    tempoBpm: options.tempoBpm ?? anchor.tempoBpm,
  };
}

export interface LookaheadWindow {
  fromQn: number;
  untilQn: number;
}

export function lookaheadWindow(
  anchor: ClockAnchor,
  now: number,
  horizonSeconds: number = SCHEDULER.horizonSeconds,
): LookaheadWindow {
  return { fromQn: positionAt(anchor, now), untilQn: positionAt(anchor, now + horizonSeconds) };
}

export function sortByStart(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort((a, b) => a.startQn - b.startQn || a.midi - b.midi);
}

/** Index of the first note starting at or after `qn` (within epsilon), for a start-sorted list. */
export function cursorAt(sorted: readonly NoteEvent[], qn: number): number {
  const target = qn - QN_EPSILON;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].startQn < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function maxDurationQn(notes: readonly Pick<NoteEvent, 'durationQn'>[]): number {
  let max = 0;
  for (const n of notes) if (Number.isFinite(n.durationQn) && n.durationQn > max) max = n.durationQn;
  return max;
}

/**
 * Indices (ascending) of notes that started before `qn` and are still sounding at `qn`, so a
 * seek or an offline render that lands inside a long note can pick it up instead of dropping it.
 * `maxDurationQn` bounds the backward scan.
 */
export function heldNotesAt(sorted: readonly NoteEvent[], qn: number, maxDurationQn: number): number[] {
  const out: number[] = [];
  const oldest = qn - maxDurationQn - QN_EPSILON;
  for (let i = cursorAt(sorted, qn) - 1; i >= 0; i--) {
    const n = sorted[i];
    if (n.startQn < oldest) break;
    if (n.startQn + n.durationQn > qn + QN_EPSILON) out.push(i);
  }
  return out.reverse();
}

export interface DueNotes {
  notes: NoteEvent[];
  cursor: number;
}

/** Notes from `cursor` that start strictly before `untilQn`, plus the advanced cursor. */
export function takeDue(sorted: readonly NoteEvent[], cursor: number, untilQn: number): DueNotes {
  const notes: NoteEvent[] = [];
  let i = Math.max(0, cursor);
  while (i < sorted.length && sorted[i].startQn < untilQn) notes.push(sorted[i++]);
  return { notes, cursor: i };
}

export interface NoteTiming {
  start: number;
  end: number;
  durationSeconds: number;
  /** How far into the note the voice starts (0 for a note started on its own onset). */
  elapsedSeconds: number;
}

/**
 * Context-time start/end for a note. A note whose ideal start is already past (late tick, or a
 * note held across the anchor position) starts at the anchor or `now + minLead`, whichever is
 * later, and keeps its end on the grid; `elapsedSeconds` tells the synth how far in to join.
 */
export function noteTiming(
  anchor: ClockAnchor,
  note: Pick<NoteEvent, 'startQn' | 'durationQn'>,
  now: number,
  minLeadSeconds: number = SCHEDULER.minLeadSeconds,
  minNoteSeconds: number = SCHEDULER.minNoteSeconds,
): NoteTiming {
  const ideal = timeForQn(anchor, note.startQn);
  const start = Math.max(ideal, anchor.anchorTime, now + minLeadSeconds);
  const end = Math.max(timeForQn(anchor, note.startQn + note.durationQn), start + minNoteSeconds);
  return { start, end, durationSeconds: end - start, elapsedSeconds: Math.max(0, start - ideal) };
}
