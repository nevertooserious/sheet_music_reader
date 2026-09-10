export interface RhythmItem {
  id: string;
  kind: 'note' | 'rest';
  x: number;
  y: number;
  durationQn: number;
  stem?: 'up' | 'down';
  /** Items sharing a stem always share an onset. */
  stemId?: number;
}

export interface OnsetAnchor {
  x: number;
  qn: number;
}

export interface AssembleOptions {
  /** Nominal measure length from the time signature; undefined when unknown. */
  measureQn?: number;
  space: number;
  /** y of the staff's middle line, used to split rests between voices. */
  middleY: number;
  /** Horizontal extent of the measure, for proportional fallback. */
  xRange: [number, number];
  /** Onsets already established on another staff of the same system. */
  anchors?: OnsetAnchor[];
}

export type AssembleMethod = 'single' | 'two-voice' | 'aligned' | 'proportional' | 'empty';

export interface AssembleResult {
  onsets: Map<string, number>;
  /** Length actually filled by the assembled voices. */
  totalQn: number;
  method: AssembleMethod;
  /** Cluster onsets, usable as anchors for the other staff. */
  anchors: OnsetAnchor[];
  problem?: string;
  /** Single-voice clusters where a rest coincides with a note: legal but suspicious. */
  anomalies: number;
}

interface Cluster {
  x: number;
  items: RhythmItem[];
}

const EPS = 1e-3;

/** Group items into onset clusters by x; items sharing a stem are always merged. */
export function clusterByX(items: RhythmItem[], space: number, tolerance = 1.0): Cluster[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const clusters: Cluster[] = [];
  const byStem = new Map<number, Cluster>();
  for (const item of sorted) {
    let target: Cluster | undefined;
    if (item.stemId !== undefined) target = byStem.get(item.stemId);
    if (!target) {
      const last = clusters[clusters.length - 1];
      if (last && item.x - last.x <= tolerance * space) target = last;
      // A second in a stemless chord is displaced by a head width, beyond the normal tolerance.
      else if (
        last &&
        item.kind === 'note' &&
        item.stemId === undefined &&
        item.x - last.x <= 1.5 * space &&
        last.items.some((o) => o.kind === 'note' && o.stemId === undefined && Math.abs(o.y - item.y) <= 0.6 * space)
      ) {
        target = last;
      }
    }
    if (!target) {
      target = { x: item.x, items: [] };
      clusters.push(target);
    }
    target.items.push(item);
    if (item.stemId !== undefined) byStem.set(item.stemId, target);
  }
  for (const c of clusters) c.x = c.items.reduce((s, i) => s + i.x, 0) / c.items.length;
  return clusters.sort((a, b) => a.x - b.x);
}

function sequential(clusters: Cluster[], onsets: Map<string, number>): number {
  let qn = 0;
  for (const c of clusters) {
    for (const item of c.items) onsets.set(item.id, qn);
    qn += Math.min(...c.items.map((i) => i.durationQn));
  }
  return qn;
}

function fits(total: number, measureQn: number | undefined): boolean {
  if (measureQn === undefined) return true;
  return total <= measureQn + EPS;
}

function splitVoices(items: RhythmItem[], middleY: number): [RhythmItem[], RhythmItem[]] {
  const up: RhythmItem[] = [];
  const down: RhythmItem[] = [];
  const stemmed = items.filter((i) => i.kind === 'note' && i.stem);
  const meanY = items.length ? items.reduce((s, i) => s + i.y, 0) / items.length : middleY;
  for (const item of items) {
    if (item.kind === 'note' && item.stem) (item.stem === 'up' ? up : down).push(item);
    else if (item.kind === 'note') (item.y <= (stemmed.length ? meanY : middleY) ? up : down).push(item);
    else (item.y < middleY ? up : down).push(item);
  }
  return [up, down];
}

/**
 * Assign an onset (quarter notes from the start of the measure) to every item.
 * Default is one voice read left to right; when the durations do not fill the
 * measure consistently, split by stem direction into two voices; when that
 * also fails, align clusters with the other staff's onsets or space them
 * proportionally by x.
 */
export function assembleMeasure(items: RhythmItem[], opts: AssembleOptions): AssembleResult {
  const onsets = new Map<string, number>();
  if (!items.length) return { onsets, totalQn: 0, method: 'empty', anchors: [], anomalies: 0 };
  const clusters = clusterByX(items, opts.space);
  const restNoteClusters = clusters.filter((c) => c.items.some((i) => i.kind === 'rest') && c.items.some((i) => i.kind === 'note')).length;
  const anchorsOf = (): OnsetAnchor[] =>
    clusters.map((c) => ({ x: c.x, qn: Math.min(...c.items.map((i) => onsets.get(i.id) ?? 0)) }));

  const singleTotal = sequential(clusters, onsets);
  const exact = opts.measureQn === undefined || Math.abs(singleTotal - opts.measureQn) < EPS;
  const mixedCluster = clusters.some((c) => {
    const dirs = new Set(c.items.filter((i) => i.kind === 'note' && i.stem).map((i) => i.stem));
    const stems = new Set(c.items.filter((i) => i.stemId !== undefined).map((i) => i.stemId));
    return dirs.size > 1 && stems.size > 1;
  });
  if (exact && !mixedCluster) return { onsets, totalQn: singleTotal, method: 'single', anchors: anchorsOf(), anomalies: restNoteClusters };

  const [up, down] = splitVoices(items, opts.middleY);
  if (up.length && down.length) {
    const voiceOnsets = new Map<string, number>();
    const upTotal = sequential(clusterByX(up, opts.space), voiceOnsets);
    const downTotal = sequential(clusterByX(down, opts.space), voiceOnsets);
    const target = opts.measureQn ?? Math.max(upTotal, downTotal);
    const upExact = Math.abs(upTotal - target) < EPS;
    const downExact = Math.abs(downTotal - target) < EPS;
    if ((upExact && downTotal <= target + EPS) || (downExact && upTotal <= target + EPS)) {
      onsets.clear();
      for (const [k, v] of voiceOnsets) onsets.set(k, v);
      return { onsets, totalQn: Math.max(upTotal, downTotal), method: 'two-voice', anchors: anchorsOf(), anomalies: 0 };
    }
  }

  if (fits(singleTotal, opts.measureQn) && !mixedCluster) {
    return {
      onsets,
      totalQn: singleTotal,
      method: 'single',
      anchors: anchorsOf(),
      problem: `durations fill ${singleTotal} of ${opts.measureQn} quarter notes`,
      anomalies: restNoteClusters,
    };
  }

  onsets.clear();
  const measureQn = opts.measureQn ?? singleTotal;
  const anchors = opts.anchors && opts.anchors.length ? opts.anchors : undefined;
  const [x1, x2] = opts.xRange;
  for (const c of clusters) {
    let qn: number;
    if (anchors) {
      let best = anchors[0];
      for (const a of anchors) if (Math.abs(a.x - c.x) < Math.abs(best.x - c.x)) best = a;
      if (Math.abs(best.x - c.x) <= opts.space) qn = best.qn;
      else qn = interpolate(anchors, c.x, measureQn, x1, x2);
    } else {
      qn = (measureQn * (c.x - x1)) / Math.max(1e-6, x2 - x1);
    }
    qn = Math.min(measureQn, Math.max(0, Math.round(qn * 8) / 8));
    for (const item of c.items) onsets.set(item.id, qn);
  }
  return {
    onsets,
    totalQn: measureQn,
    method: anchors ? 'aligned' : 'proportional',
    anchors: anchorsOf(),
    problem: `durations sum to ${singleTotal} quarter notes in a ${measureQn}-quarter measure`,
    anomalies: restNoteClusters,
  };
}

function interpolate(anchors: OnsetAnchor[], x: number, measureQn: number, x1: number, x2: number): number {
  const sorted = [...anchors].sort((a, b) => a.x - b.x);
  let left: OnsetAnchor = { x: x1, qn: 0 };
  let right: OnsetAnchor = { x: x2, qn: measureQn };
  for (const a of sorted) {
    if (a.x <= x && a.x >= left.x) left = a;
    if (a.x >= x && a.x < right.x) right = a;
  }
  if (right.x - left.x < 1e-6) return left.qn;
  return left.qn + ((x - left.x) / (right.x - left.x)) * (right.qn - left.qn);
}
