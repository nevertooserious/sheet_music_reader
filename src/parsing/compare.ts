import type { ScoreModel, Track } from '../core/types';

/**
 * Port of tools/verify/compare.mjs so the showcase can score itself in the
 * browser with the same metric the verifier uses.
 */

export interface RefNote {
  midi: number;
  startQn: number;
  durationQn: number;
  velocity?: number;
}

export interface RefTrack {
  name: string;
  notes: RefNote[];
}

export interface Reference {
  ticksPerBeat: number;
  tempoBpm: number;
  timeSignature: { beats: number; beatType: number } | null;
  keyFifths: number | null;
  tracks: RefTrack[];
}

export interface TrackComparison {
  refTrack: string;
  scoreTrack: string | null;
  scoreTrackId?: string;
  refNoteCount: number;
  gotNoteCount: number;
  pitchLcsRatio: number;
  onsetPitchRecall: number;
  onsetPitchPrecision: number;
  onsetPitchF1: number;
  durationAccuracy: number;
  missingSample: RefNote[];
  extraSample: Array<{ midi: number; startQn: number; durationQn: number; measure?: number }>;
}

export interface Comparison {
  variant: 'unfolded' | 'printed';
  tracks: TrackComparison[];
  overall: {
    onsetPitchF1: number;
    pitchLcsRatio: number;
    durationAccuracy: number;
    unmatchedScoreTracks: number;
    refTrackCount: number;
    scoreTrackCount: number;
  };
  thresholds: { minF1: number; minLcs: number };
  pass: boolean;
}

const ONSET_TOL_QN = 0.13;

interface GotNote {
  midi: number;
  startQn: number;
  durationQn: number;
  measure?: number;
}

export function lcsLength(a: number[], b: number[]): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function sortNotes<T extends { startQn: number; midi: number }>(notes: T[]): T[] {
  return [...notes].sort((a, b) => a.startQn - b.startQn || a.midi - b.midi);
}

/** Notes of the first playback occurrence of each printed measure, re-timed to printed order. */
export function printedOrderNotes(score: ScoreModel, track: Track): GotNote[] {
  const firstSeg = new Map<number, { startQn: number; durationQn: number }>();
  for (const seg of score.timeline) if (!firstSeg.has(seg.measure)) firstSeg.set(seg.measure, seg);
  const printedStart = new Map<number, number>();
  let acc = 0;
  for (const m of score.measures) {
    printedStart.set(m.index, acc);
    acc += m.durationQn;
  }
  const out: GotNote[] = [];
  for (const n of track.notes) {
    const seg = firstSeg.get(n.measure);
    if (!seg) continue;
    if (n.startQn < seg.startQn - 1e-6 || n.startQn >= seg.startQn + seg.durationQn + 1e-6) continue;
    out.push({ midi: n.midi, durationQn: n.durationQn, measure: n.measure, startQn: (printedStart.get(n.measure) ?? 0) + (n.startQn - seg.startQn) });
  }
  return sortNotes(out);
}

function matchOnsets(refNotes: RefNote[], gotNotes: GotNote[]) {
  const used = new Set<number>();
  let matched = 0;
  let durationMatched = 0;
  const missing: RefNote[] = [];
  for (const r of refNotes) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < gotNotes.length; i++) {
      if (used.has(i)) continue;
      const g = gotNotes[i];
      if (g.midi !== r.midi) continue;
      const d = Math.abs(g.startQn - r.startQn);
      if (d <= ONSET_TOL_QN && d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched++;
      if (Math.abs(gotNotes[best].durationQn - r.durationQn) <= 0.26) durationMatched++;
    } else missing.push(r);
  }
  const extra = gotNotes.filter((_, i) => !used.has(i));
  return { matched, durationMatched, missing, extra };
}

function compareTrackPair(refNotes: RefNote[], gotNotesRaw: GotNote[]): Omit<TrackComparison, 'refTrack' | 'scoreTrack'> {
  const gotNotes = sortNotes(gotNotesRaw);
  const refPitches = refNotes.map((n) => n.midi);
  const gotPitches = gotNotes.map((n) => n.midi);
  const lcs = lcsLength(refPitches, gotPitches);
  const lcsRatio = lcs / Math.max(refPitches.length, gotPitches.length, 1);
  const { matched, durationMatched, missing, extra } = matchOnsets(refNotes, gotNotes);
  const recall = matched / Math.max(refNotes.length, 1);
  const precision = matched / Math.max(gotNotes.length, 1);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    refNoteCount: refNotes.length,
    gotNoteCount: gotNotes.length,
    pitchLcsRatio: +lcsRatio.toFixed(4),
    onsetPitchRecall: +recall.toFixed(4),
    onsetPitchPrecision: +precision.toFixed(4),
    onsetPitchF1: +f1.toFixed(4),
    durationAccuracy: +(durationMatched / Math.max(matched, 1)).toFixed(4),
    missingSample: missing.slice(0, 12),
    extraSample: extra.slice(0, 12).map((n) => ({ midi: n.midi, startQn: n.startQn, durationQn: n.durationQn, measure: n.measure })),
  };
}

export function compareScoreToReference(
  score: ScoreModel,
  reference: Reference,
  { minF1 = 0.85, minLcs = 0.9 } = {},
): Comparison {
  const variants: Record<Comparison['variant'], (t: Track) => GotNote[]> = {
    unfolded: (t) => sortNotes(t.notes.map((n) => ({ midi: n.midi, startQn: n.startQn, durationQn: n.durationQn, measure: n.measure }))),
    printed: (t) => printedOrderNotes(score, t),
  };
  let best: Comparison | null = null;
  for (const variant of Object.keys(variants) as Comparison['variant'][]) {
    const pick = variants[variant];
    const pairs: TrackComparison[] = [];
    const usedGot = new Set<number>();
    for (const ref of reference.tracks) {
      let bestPair: { i: number; cmp: ReturnType<typeof compareTrackPair> } | null = null;
      for (let i = 0; i < score.tracks.length; i++) {
        if (usedGot.has(i)) continue;
        const cmp = compareTrackPair(ref.notes, pick(score.tracks[i]));
        if (!bestPair || cmp.onsetPitchF1 > bestPair.cmp.onsetPitchF1) bestPair = { i, cmp };
      }
      if (bestPair) {
        usedGot.add(bestPair.i);
        pairs.push({ refTrack: ref.name, scoreTrack: score.tracks[bestPair.i].name, scoreTrackId: score.tracks[bestPair.i].id, ...bestPair.cmp });
      } else {
        pairs.push({
          refTrack: ref.name,
          scoreTrack: null,
          refNoteCount: ref.notes.length,
          gotNoteCount: 0,
          pitchLcsRatio: 0,
          onsetPitchRecall: 0,
          onsetPitchPrecision: 0,
          onsetPitchF1: 0,
          durationAccuracy: 0,
          missingSample: [],
          extraSample: [],
        });
      }
    }
    const refTotal = pairs.reduce((s, p) => s + p.refNoteCount, 0) || 1;
    const weighted = (key: 'onsetPitchF1' | 'pitchLcsRatio' | 'durationAccuracy'): number =>
      +(pairs.reduce((s, p) => s + p[key] * p.refNoteCount, 0) / refTotal).toFixed(4);
    const result: Comparison = {
      variant,
      tracks: pairs,
      overall: {
        onsetPitchF1: weighted('onsetPitchF1'),
        pitchLcsRatio: weighted('pitchLcsRatio'),
        durationAccuracy: weighted('durationAccuracy'),
        unmatchedScoreTracks: score.tracks.length - usedGot.size,
        refTrackCount: reference.tracks.length,
        scoreTrackCount: score.tracks.length,
      },
      thresholds: { minF1, minLcs },
      pass: false,
    };
    if (!best || result.overall.onsetPitchF1 > best.overall.onsetPitchF1) best = result;
  }
  const chosen = best!;
  chosen.pass = chosen.overall.onsetPitchF1 >= minF1 && chosen.overall.pitchLcsRatio >= minLcs;
  return chosen;
}
