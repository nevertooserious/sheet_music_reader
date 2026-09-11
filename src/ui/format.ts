import type {
  LayoutBox,
  Measure,
  NoteEvent,
  ScoreModel,
  TimeSignature,
  TimelineSegment,
  TrackMixState,
} from '../core/types';
import { qnToSeconds } from '../core/types';

export const TEMPO_MIN = 30;
export const TEMPO_MAX = 240;

export function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/** "m:ss" clock text; negative, NaN and infinite inputs read as 0:00. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatQnClock(qn: number, bpm: number): string {
  return formatClock(qnToSeconds(qn, bpm));
}

export function formatBpm(bpm: number): string {
  return `${Math.round(bpm)}`;
}

export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (db === -Infinity) return '-inf dB';
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
}

/**
 * Index of the timeline segment containing qn (last segment whose start is
 * <= qn). Positions past the end map to the last segment; -1 for an empty
 * timeline or a position before the first segment.
 */
export function findSegmentIndex(timeline: readonly TimelineSegment[], qn: number): number {
  if (timeline.length === 0 || qn < timeline[0].startQn) return -1;
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid].startQn <= qn) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function segmentAt(timeline: readonly TimelineSegment[], qn: number): TimelineSegment | undefined {
  const i = findSegmentIndex(timeline, qn);
  return i < 0 ? undefined : timeline[i];
}

export function timeSignatureAt(
  signatures: readonly TimeSignature[],
  measureIndex: number,
): TimeSignature | undefined {
  let found: TimeSignature | undefined;
  for (const sig of signatures) {
    if (sig.measure <= measureIndex) found = sig;
    else break;
  }
  return found;
}

export interface PositionInfo {
  segmentIndex: number;
  /** Printed measure index (0-based). */
  measure: number;
  /** 1-based bar number for display. */
  bar: number;
  /** 1-based beat within the bar. */
  beat: number;
  /** 0..1 progress through the current measure. */
  measureFraction: number;
}

export function positionInfo(score: ScoreModel, qn: number): PositionInfo | undefined {
  const segmentIndex = findSegmentIndex(score.timeline, qn);
  if (segmentIndex < 0) return undefined;
  const seg = score.timeline[segmentIndex];
  const sig = timeSignatureAt(score.timeSignatures, seg.measure);
  const beatQn = sig ? 4 / sig.beatType : 1;
  const beatsInBar = sig ? sig.beats : Math.max(1, Math.round(seg.durationQn / beatQn));
  const offset = Math.max(0, qn - seg.startQn);
  const beat = clamp(Math.floor(offset / beatQn + 1e-6) + 1, 1, beatsInBar);
  const measureFraction = seg.durationQn > 0 ? clamp(offset / seg.durationQn, 0, 1) : 0;
  return { segmentIndex, measure: seg.measure, bar: seg.measure + 1, beat, measureFraction };
}

export function formatPosition(score: ScoreModel | undefined, qn: number): string {
  const info = score ? positionInfo(score, qn) : undefined;
  if (!info) return 'bar –';
  return `bar ${info.bar}`;
}

/** Start of the segment `delta` segments away from the one containing qn, clamped to the timeline. */
export function nudgeByMeasure(score: ScoreModel, qn: number, delta: number): number {
  if (score.timeline.length === 0) return 0;
  const current = Math.max(0, findSegmentIndex(score.timeline, qn));
  const target = clamp(current + delta, 0, score.timeline.length - 1);
  return score.timeline[target].startQn;
}

export interface TrackNotes {
  trackId: string;
  sorted: NoteEvent[];
  maxDuration: number;
}

export function indexTracks(score: ScoreModel): TrackNotes[] {
  return score.tracks.map((t) => {
    const sorted = sortNotes(t.notes);
    return { trackId: t.id, sorted, maxDuration: maxDuration(sorted) };
  });
}

export function anySolo(tracks: readonly TrackMixState[]): boolean {
  return tracks.some((t) => t.solo);
}

/**
 * Whether a track's bus is sounding: mute wins, then solo (any soloed track
 * silences the rest), then a fader at zero. A track the engine has no mix
 * state for yet counts as audible.
 */
export function isTrackAudible(mix: TrackMixState | undefined, soloActive: boolean): boolean {
  if (!mix) return true;
  if (mix.muted) return false;
  if (soloActive && !mix.solo) return false;
  return mix.gain > 0;
}

export function sortNotes(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort((a, b) => a.startQn - b.startQn);
}

export function maxDuration(notes: readonly NoteEvent[]): number {
  let max = 0;
  for (const n of notes) if (n.durationQn > max) max = n.durationQn;
  return max;
}

/** Notes sounding at qn from a list sorted by startQn; maxDurationQn bounds the backward scan. */
export function activeNotes(
  sorted: readonly NoteEvent[],
  qn: number,
  maxDurationQn: number,
  out: NoteEvent[] = [],
): NoteEvent[] {
  out.length = 0;
  if (sorted.length === 0) return out;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].startQn <= qn) lo = mid + 1;
    else hi = mid;
  }
  const earliest = qn - maxDurationQn;
  for (let i = lo - 1; i >= 0 && sorted[i].startQn >= earliest - 1e-9; i--) {
    const n = sorted[i];
    if (n.startQn + n.durationQn > qn + 1e-9) out.push(n);
  }
  return out;
}

/** [offset into segment (qn), x on the page] for every distinct note onset of a timeline segment. */
export type OnsetAnchor = [number, number];

export function onsetAnchors(
  tracks: readonly TrackNotes[],
  segment: TimelineSegment,
  page: number,
): OnsetAnchor[] {
  const end = segment.startQn + segment.durationQn;
  const sums = new Map<number, { x: number; n: number }>();
  for (const { sorted } of tracks) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].startQn < segment.startQn - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < sorted.length && sorted[i].startQn < end - 1e-9; i++) {
      const note = sorted[i];
      if (!note.layout || note.layout.page !== page || note.measure !== segment.measure) continue;
      const key = Math.round((note.startQn - segment.startQn) * 1e6) / 1e6;
      const acc = sums.get(key);
      if (acc) {
        acc.x += note.layout.x;
        acc.n++;
      } else sums.set(key, { x: note.layout.x, n: 1 });
    }
  }
  return [...sums.entries()].map(([t, { x, n }]): OnsetAnchor => [t, x / n]).sort((a, b) => a[0] - b[0]);
}

/**
 * Playhead x in page points for a position inside a measure: piecewise-linear
 * between note onsets (engraving is not proportionally spaced), gliding from
 * the last onset to the barline; proportional to the box when no note has layout.
 */
export function playheadX(anchors: readonly OnsetAnchor[], offsetQn: number, durationQn: number, box: LayoutBox): number {
  const right = box.x + box.width;
  const fraction = durationQn > 0 ? clamp(offsetQn / durationQn, 0, 1) : 0;
  if (anchors.length === 0) return box.x + fraction * box.width;
  const [t0, x0] = anchors[0];
  if (offsetQn <= t0) return t0 > 0 ? box.x + (x0 - box.x) * clamp(offsetQn / t0, 0, 1) : x0;
  for (let i = 1; i < anchors.length; i++) {
    const [ta, xa] = anchors[i - 1];
    const [tb, xb] = anchors[i];
    if (offsetQn <= tb) return tb > ta ? xa + ((xb - xa) * (offsetQn - ta)) / (tb - ta) : xb;
  }
  const [tn, xn] = anchors[anchors.length - 1];
  const span = durationQn - tn;
  if (span <= 0) return xn;
  return xn + (right - xn) * clamp((offsetQn - tn) / span, 0, 1);
}

export function fitScale(
  availableWidth: number,
  pageWidth: number,
  min = 0.25,
  max = 4,
): number {
  if (!(pageWidth > 0) || !(availableWidth > 0)) return 1;
  return clamp(availableWidth / pageWidth, min, max);
}

/** Bounding box of a measure across all its staves on the page of its first box. */
export function measureUnionBox(measure: Measure): LayoutBox | undefined {
  if (measure.layout.length === 0) return undefined;
  const page = measure.layout[0].page;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of measure.layout) {
    if (b.page !== page) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { page, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function describeTimeSignature(sig: TimeSignature | undefined): string {
  return sig ? `${sig.beats}/${sig.beatType}` : '';
}

export function describeKey(fifths: number | undefined): string {
  if (fifths === undefined) return '';
  const majors = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const name = majors[clamp(fifths, -7, 7) + 7];
  return `${name} major`;
}

export function clefLabel(clef: string): string {
  switch (clef) {
    case 'treble':
      return 'G';
    case 'bass':
      return 'F';
    case 'alto':
    case 'tenor':
      return 'C';
    case 'percussion':
      return '||';
    default:
      return '?';
  }
}
