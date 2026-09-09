/**
 * Compares a parsed ScoreModel against reference MIDI tracks.
 *
 * The reference MIDI may or may not have repeats unfolded, so both the
 * unfolded timeline and a "printed order" (first pass of every measure)
 * variant of the parsed score are compared and the better one is reported.
 */

const ONSET_TOL_QN = 0.13;

function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => a.startQn - b.startQn || a.midi - b.midi);
}

/** Notes of the first playback occurrence of each printed measure, re-timed to printed order. */
export function printedOrderNotes(score, track) {
  const firstSeg = new Map();
  for (const seg of score.timeline) if (!firstSeg.has(seg.measure)) firstSeg.set(seg.measure, seg);
  const printedStart = new Map();
  let acc = 0;
  for (const m of score.measures) {
    printedStart.set(m.index, acc);
    acc += m.durationQn;
  }
  const out = [];
  for (const n of track.notes) {
    const seg = firstSeg.get(n.measure);
    if (!seg) continue;
    if (n.startQn < seg.startQn - 1e-6 || n.startQn >= seg.startQn + seg.durationQn + 1e-6) continue;
    out.push({ ...n, startQn: printedStart.get(n.measure) + (n.startQn - seg.startQn) });
  }
  return sortNotes(out);
}

function matchOnsets(refNotes, gotNotes) {
  const used = new Set();
  let matched = 0;
  let durationMatched = 0;
  const missing = [];
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

function compareTrackPair(refNotes, gotNotesRaw) {
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

/**
 * Returns { variant, tracks: [...], overall: { f1, lcs, ... }, pass }.
 * Tracks are paired greedily by best F1 so parsers may order staves differently.
 */
export function compareScoreToReference(score, reference, { minF1 = 0.85, minLcs = 0.9 } = {}) {
  const variants = {
    unfolded: (t) => sortNotes(t.notes),
    printed: (t) => printedOrderNotes(score, t),
  };
  let best = null;
  for (const [variant, pick] of Object.entries(variants)) {
    const pairs = [];
    const usedGot = new Set();
    for (const ref of reference.tracks) {
      let bestPair = null;
      for (let i = 0; i < score.tracks.length; i++) {
        if (usedGot.has(i)) continue;
        const cmp = compareTrackPair(ref.notes, pick(score.tracks[i]));
        if (!bestPair || cmp.onsetPitchF1 > bestPair.cmp.onsetPitchF1) bestPair = { i, cmp };
      }
      if (bestPair) {
        usedGot.add(bestPair.i);
        pairs.push({ refTrack: ref.name, scoreTrack: score.tracks[bestPair.i].name, scoreTrackId: score.tracks[bestPair.i].id, ...bestPair.cmp });
      } else {
        pairs.push({ refTrack: ref.name, scoreTrack: null, refNoteCount: ref.notes.length, gotNoteCount: 0, pitchLcsRatio: 0, onsetPitchRecall: 0, onsetPitchPrecision: 0, onsetPitchF1: 0, durationAccuracy: 0 });
      }
    }
    const refTotal = pairs.reduce((s, p) => s + p.refNoteCount, 0) || 1;
    const weighted = (key) => +pairs.reduce((s, p) => s + p[key] * p.refNoteCount, 0) / refTotal;
    const overall = {
      onsetPitchF1: +weighted('onsetPitchF1').toFixed(4),
      pitchLcsRatio: +weighted('pitchLcsRatio').toFixed(4),
      durationAccuracy: +weighted('durationAccuracy').toFixed(4),
      unmatchedScoreTracks: score.tracks.length - usedGot.size,
      refTrackCount: reference.tracks.length,
      scoreTrackCount: score.tracks.length,
    };
    const result = { variant, tracks: pairs, overall };
    if (!best || overall.onsetPitchF1 > best.overall.onsetPitchF1) best = result;
  }
  best.thresholds = { minF1, minLcs };
  best.pass = best.overall.onsetPitchF1 >= minF1 && best.overall.pitchLcsRatio >= minLcs;
  return best;
}
