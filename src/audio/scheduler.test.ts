import { describe, expect, it } from 'vitest';
import { createDemoScore } from '../core/demoScore';
import type { NoteEvent } from '../core/types';
import {
  type ClockAnchor,
  SCHEDULER,
  TEMPO_MAX,
  TEMPO_MIN,
  clampTempo,
  cursorAt,
  heldNotesAt,
  horizonFor,
  lookaheadWindow,
  maxDurationQn,
  noteTiming,
  positionAt,
  rebase,
  sortByStart,
  takeDue,
  timeForQn,
} from './scheduler';

const note = (startQn: number, durationQn = 1, midi = 60): NoteEvent => ({
  id: `n${startQn}-${midi}`,
  trackId: 't',
  midi,
  startQn,
  durationQn,
  velocity: 0.8,
  measure: 0,
});

describe('clock anchor', () => {
  const anchor: ClockAnchor = { anchorQn: 4, anchorTime: 10, tempoBpm: 120 };

  it('maps context time to quarter notes at the anchor tempo', () => {
    expect(positionAt(anchor, 10)).toBe(4);
    expect(positionAt(anchor, 12)).toBe(8);
    expect(positionAt(anchor, 10.25)).toBeCloseTo(4.5);
  });

  it('holds the anchor position before the anchor time', () => {
    expect(positionAt(anchor, 9.5)).toBe(4);
  });

  it('maps quarter notes back to context time', () => {
    expect(timeForQn(anchor, 4)).toBe(10);
    expect(timeForQn(anchor, 8)).toBe(12);
    expect(timeForQn(anchor, 2)).toBe(9);
  });

  it('round-trips through the current position', () => {
    for (const t of [10, 10.1, 13.37, 20]) expect(timeForQn(anchor, positionAt(anchor, t))).toBeCloseTo(t, 9);
  });
});

describe('rebase', () => {
  const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 100, tempoBpm: 60 };

  it('preserves the playhead when the tempo changes mid-flight', () => {
    const now = 103;
    const before = positionAt(anchor, now);
    const next = rebase(anchor, now, { tempoBpm: 120 });
    expect(next.tempoBpm).toBe(120);
    expect(positionAt(next, now)).toBeCloseTo(before);
    expect(positionAt(next, now + 1)).toBeCloseTo(before + 2);
  });

  it('re-times upcoming notes at the new tempo', () => {
    const now = 103;
    const next = rebase(anchor, now, { tempoBpm: 120 });
    expect(timeForQn(anchor, 5)).toBe(105);
    expect(timeForQn(next, 5)).toBeCloseTo(104);
  });

  it('moves to an explicit position with optional latency', () => {
    const next = rebase(anchor, 103, { positionQn: 12, latencySeconds: 0.02 });
    expect(next.anchorQn).toBe(12);
    expect(next.anchorTime).toBeCloseTo(103.02);
    expect(positionAt(next, 103)).toBe(12);
    expect(positionAt(next, 104.02)).toBeCloseTo(13);
  });
});

describe('lookahead window', () => {
  it('covers the horizon converted to quarter notes at the current tempo', () => {
    const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm: 120 };
    const window = lookaheadWindow(anchor, 1, 0.15);
    expect(window.fromQn).toBeCloseTo(2);
    expect(window.untilQn).toBeCloseTo(2.3);
    const slow = lookaheadWindow({ ...anchor, tempoBpm: 60 }, 1);
    expect(slow.untilQn - slow.fromQn).toBeCloseTo(SCHEDULER.horizonSeconds);
  });
});

describe('note cursor', () => {
  const sorted = sortByStart([note(3), note(0), note(1.5), note(1.5, 1, 64), note(6)]);

  it('sorts by start then pitch', () => {
    expect(sorted.map((n) => n.startQn)).toEqual([0, 1.5, 1.5, 3, 6]);
    expect(sorted[1].midi).toBeLessThan(sorted[2].midi);
  });

  it('finds the first note at or after a position, treating tiny drift as equal', () => {
    expect(cursorAt(sorted, 0)).toBe(0);
    expect(cursorAt(sorted, 1.5)).toBe(1);
    expect(cursorAt(sorted, 1.5 + 1e-9)).toBe(1);
    expect(cursorAt(sorted, 1.6)).toBe(3);
    expect(cursorAt(sorted, 100)).toBe(sorted.length);
    expect(cursorAt([], 2)).toBe(0);
  });

  it('takes notes strictly before the window end and advances the cursor', () => {
    const first = takeDue(sorted, 0, 1.5);
    expect(first.notes.map((n) => n.startQn)).toEqual([0]);
    expect(first.cursor).toBe(1);
    const second = takeDue(sorted, first.cursor, 3.01);
    expect(second.notes.map((n) => n.startQn)).toEqual([1.5, 1.5, 3]);
    expect(second.cursor).toBe(4);
    expect(takeDue(sorted, second.cursor, 5).notes).toEqual([]);
  });

  it('seeking re-bases the cursor so only notes from the new position are due', () => {
    const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm: 120 };
    const played = takeDue(sorted, 0, lookaheadWindow(anchor, 1).untilQn);
    expect(played.cursor).toBe(3);
    const seeked = rebase(anchor, 1, { positionQn: 5 });
    const cursor = cursorAt(sorted, seeked.anchorQn);
    const due = takeDue(sorted, cursor, lookaheadWindow(seeked, 1, 1).untilQn);
    expect(due.notes.map((n) => n.startQn)).toEqual([6]);
  });

  it('covers every demo-score note exactly once when walked in windows', () => {
    const score = createDemoScore();
    const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm: score.tempoBpm };
    for (const track of score.tracks) {
      const notes = sortByStart(track.notes);
      let cursor = cursorAt(notes, 0);
      const seen: NoteEvent[] = [];
      for (let t = 0; positionAt(anchor, t) < score.durationQn; t += SCHEDULER.tickMs / 1000) {
        const due = takeDue(notes, cursor, lookaheadWindow(anchor, t).untilQn);
        seen.push(...due.notes);
        cursor = due.cursor;
      }
      expect(seen.length).toBe(track.notes.length);
      expect(new Set(seen.map((n) => n.id)).size).toBe(track.notes.length);
    }
  });
});

describe('note timing', () => {
  const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm: 120 };

  it('places on-grid notes at their context time with tempo-scaled duration', () => {
    const timing = noteTiming(anchor, note(4, 2), 1);
    expect(timing.start).toBeCloseTo(2);
    expect(timing.end).toBeCloseTo(3);
    expect(timing.durationSeconds).toBeCloseTo(1);
  });

  it('pulls a late note forward without moving its end', () => {
    const timing = noteTiming(anchor, note(1, 2), 0.6);
    expect(timing.start).toBeCloseTo(0.6 + SCHEDULER.minLeadSeconds);
    expect(timing.end).toBeCloseTo(1.5);
  });

  it('never emits a note shorter than the minimum', () => {
    const timing = noteTiming(anchor, note(0, 0.001), 0.2);
    expect(timing.durationSeconds).toBeCloseTo(SCHEDULER.minNoteSeconds);
  });
});

describe('clampTempo', () => {
  it('clamps to the contract range and falls back on garbage', () => {
    expect(clampTempo(108)).toBe(108);
    expect(clampTempo(5)).toBe(TEMPO_MIN);
    expect(clampTempo(1000)).toBe(TEMPO_MAX);
    expect(clampTempo(Number.NaN)).toBe(100);
    expect(clampTempo(Number.POSITIVE_INFINITY, 90)).toBe(90);
  });
});

describe('held notes', () => {
  const sorted = sortByStart([note(0, 2, 55), note(0, 2, 59), note(0, 1, 74), note(1, 0.5, 67), note(1.5, 0.5, 69), note(2, 1, 57)]);

  it('finds notes that started earlier and are still sounding at a position', () => {
    const held = heldNotesAt(sorted, 0.5, maxDurationQn(sorted)).map((i) => sorted[i]);
    expect(held.map((n) => n.midi)).toEqual([55, 59, 74]);
    expect(heldNotesAt(sorted, 1.5, maxDurationQn(sorted)).map((i) => sorted[i].midi)).toEqual([55, 59]);
  });

  it('excludes notes that start exactly at, or end exactly at, the position', () => {
    expect(heldNotesAt(sorted, 0, maxDurationQn(sorted))).toEqual([]);
    expect(heldNotesAt(sorted, 2, maxDurationQn(sorted))).toEqual([]);
    expect(heldNotesAt(sorted, 1 + 1e-9, maxDurationQn(sorted)).map((i) => sorted[i].midi)).toEqual([55, 59]);
    expect(heldNotesAt(sorted, 1.001, maxDurationQn(sorted)).map((i) => sorted[i].midi)).toEqual([55, 59, 67]);
  });

  it('bounds the backward scan by the longest note and handles empty lists', () => {
    expect(heldNotesAt(sorted, 1.5, 0.5)).toEqual([]);
    expect(heldNotesAt([], 3, 4)).toEqual([]);
    expect(maxDurationQn([])).toBe(0);
    expect(maxDurationQn(sorted)).toBe(2);
  });
});

describe('late and held note timing', () => {
  it('a note held across the anchor starts at the anchor with the elapsed part reported', () => {
    const anchor: ClockAnchor = { anchorQn: 0.5, anchorTime: 10.03, tempoBpm: 120 };
    const timing = noteTiming(anchor, note(0, 2), 10);
    expect(timing.start).toBeCloseTo(10.03, 9);
    expect(timing.elapsedSeconds).toBeCloseTo(0.25, 9);
    expect(timing.end).toBeCloseTo(10.03 + 0.75, 9);
    expect(timing.durationSeconds).toBeCloseTo(0.75, 9);
  });

  it('an on-time note reports zero elapsed', () => {
    const anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm: 120 };
    expect(noteTiming(anchor, note(4, 2), 1).elapsedSeconds).toBe(0);
  });
});

describe('horizon', () => {
  it('is the normal lookahead when visible and covers a throttled 1 Hz tick when hidden', () => {
    expect(horizonFor(false)).toBe(SCHEDULER.horizonSeconds);
    expect(horizonFor(true)).toBe(SCHEDULER.hiddenHorizonSeconds);
    expect(SCHEDULER.hiddenHorizonSeconds).toBeGreaterThanOrEqual(1.2);
  });
});
