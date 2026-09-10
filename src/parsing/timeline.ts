import type { TimelineSegment } from '../core/types';

export interface RepeatMeasure {
  durationQn: number;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** Passes on which this measure is played (volta bracket numbers); undefined = every pass. */
  volta?: number[];
}

/**
 * An ending whose bracket was broken across a line break arrives with its
 * continuation measures unlabelled. When such a run closes with a repeat
 * barline and the next ending starts right after it, the run belongs to the
 * ending that precedes it.
 */
export function extendEndings(measures: RepeatMeasure[]): RepeatMeasure[] {
  const out = measures.map((m) => ({ ...m }));
  for (let i = 0; i < out.length; i++) {
    const v = out[i].volta;
    if (!v || out[i].repeatEnd) continue;
    let j = i + 1;
    while (j < out.length && !out[j].volta && !out[j].repeatEnd && !out[j].repeatStart) j++;
    if (j >= out.length || out[j].volta || out[j].repeatStart || !out[j].repeatEnd) continue;
    const next = out[j + 1]?.volta;
    if (!next || next.some((n) => v.includes(n))) continue;
    for (let k = i + 1; k <= j; k++) out[k].volta = v;
  }
  return out;
}

/**
 * Expand repeat barlines into the playback order. A repeated section runs from
 * the last `repeatStart` (or the measure after the previous repeat, or the
 * beginning) to the `repeatEnd` measure. Measures under a volta bracket are
 * played only on the passes the bracket names; a section without brackets is
 * played twice, one with brackets as many times as its highest volta number.
 * With `unfoldRepeats` off every measure is played once in printed order.
 */
export function buildTimeline(printed: RepeatMeasure[], unfoldRepeats = true): TimelineSegment[] {
  const measures = extendEndings(printed);
  const out: TimelineSegment[] = [];
  let qn = 0;
  const push = (i: number): void => {
    out.push({ measure: i, startQn: qn, durationQn: measures[i].durationQn });
    qn += measures[i].durationQn;
  };
  if (!unfoldRepeats) {
    for (let i = 0; i < measures.length; i++) push(i);
    return out;
  }
  // Highest volta number in the run of bracketed measures that starts at or right after `end`.
  const passesNeeded = (end: number): number => {
    let max = 2;
    for (let j = end; j < measures.length; j++) {
      const v = measures[j].volta;
      if (!v) {
        if (j > end) break;
        continue;
      }
      max = Math.max(max, ...v);
    }
    return max;
  };
  let sectionStart = 0;
  let pass = 1;
  let i = 0;
  let prevVolta = false;
  let guard = 0;
  while (i < measures.length && guard++ < 100000) {
    const m = measures[i];
    if (pass > 1 && !m.volta && prevVolta) {
      // Stepped past the last alternative ending: the repeat is finished.
      pass = 1;
      sectionStart = i;
    }
    if (m.repeatStart && pass === 1) sectionStart = i;
    prevVolta = !!m.volta;
    if (m.volta && !m.volta.includes(pass)) {
      i++;
      continue;
    }
    push(i);
    if (m.repeatEnd) {
      if (pass < passesNeeded(i)) {
        pass++;
        i = sectionStart;
        prevVolta = false;
        continue;
      }
      if (!(i + 1 < measures.length && measures[i + 1].volta)) {
        pass = 1;
        sectionStart = i + 1;
      }
    }
    i++;
  }
  return out;
}

export function timelineDuration(timeline: TimelineSegment[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.startQn + last.durationQn : 0;
}
