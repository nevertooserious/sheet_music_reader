import type { BBox, Staff } from './model';
import type { HLine } from './staves';

export interface TupletLabel {
  /** Horizontal centre of the number. */
  cx: number;
  /** Baseline of the number. */
  y: number;
  size: number;
  actual: number;
  normal?: number;
}

export interface TupletItem {
  id: string;
  cx: number;
  y: number;
  stemId?: number;
  grace?: boolean;
}

export interface TupletGroup {
  itemIds: string[];
  actual: number;
  normal: number;
  /** Multiply printed durations by this. */
  ratio: number;
  x1: number;
  x2: number;
  y: number;
  /**
   * How the number was tied to its notes. A bracket is unambiguous; a number
   * merely centred over a beam looks like a fingering, so the caller only
   * keeps it when it repairs the measure's rhythm.
   */
  source: 'bracket' | 'beam';
}

/** Number of normal notes a tuplet of `actual` notes replaces, when not printed as "a:n". */
export function tupletNormal(actual: number, normal?: number): number {
  if (normal && normal > 0) return normal;
  if (actual === 2 || actual === 4) return 3;
  let p = 1;
  while (p * 2 < actual) p *= 2;
  return p;
}

/** Text of a tuplet number: "3", "3:2" → actual/normal ("2." with a dot is a volta label, not a duplet). */
export function parseTupletText(text: string): { actual: number; normal?: number } | undefined {
  const m = /^\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?\s*$/.exec(text);
  if (!m) return undefined;
  const actual = Number(m[1]);
  if (actual < 2 || actual > 15) return undefined;
  const normal = m[2] ? Number(m[2]) : undefined;
  return { actual, normal };
}

/**
 * Attach tuplet numbers to the notes they govern: the notes under a bracket
 * broken around (or drawn through) the number, or under the beam the number
 * is centred over (within 0.6 sp: LilyPond fingerings are the same small
 * digits but sit over one head of the group). Numbers with neither are ignored.
 */
export function detectTuplets(labels: TupletLabel[], items: TupletItem[], beams: BBox[], brackets: HLine[], staff: Staff): TupletGroup[] {
  const sp = staff.space;
  const out: TupletGroup[] = [];
  const taken = new Set<string>();
  for (const label of labels) {
    const ly = label.y - 0.35 * label.size;
    const nearY = (h: HLine): boolean => Math.abs(h.y - ly) <= 1.3 * sp && h.thickness <= 0.4 * sp;
    const left = brackets.filter((h) => nearY(h) && h.x2 <= label.cx + 0.3 * sp && h.x2 >= label.cx - 3 * sp && h.x1 < h.x2 - 1 * sp);
    const right = brackets.filter((h) => nearY(h) && h.x1 >= label.cx - 0.3 * sp && h.x1 <= label.cx + 3 * sp && h.x2 > h.x1 + 1 * sp);
    const through = brackets.filter((h) => Math.abs(h.y - ly) <= 1.8 * sp && h.thickness <= 0.4 * sp && h.x1 < label.cx - 1 * sp && h.x2 > label.cx + 1 * sp);
    let range: [number, number] | undefined;
    let source: TupletGroup['source'] = 'bracket';
    if (left.length && right.length) range = [Math.min(...left.map((h) => h.x1)), Math.max(...right.map((h) => h.x2))];
    else if (through.length) range = [Math.min(...through.map((h) => h.x1)), Math.max(...through.map((h) => h.x2))];
    else {
      const beam = beams
        .filter((b) => Math.abs((b.minX + b.maxX) / 2 - label.cx) <= 0.6 * sp)
        .filter((b) => (ly < b.minY - 0.3 * sp ? b.minY - ly <= 4 * sp : ly > b.maxY + 0.3 * sp ? ly - b.maxY <= 4 * sp : false))
        .sort((a, b) => Math.abs((a.minY + a.maxY) / 2 - ly) - Math.abs((b.minY + b.maxY) / 2 - ly))[0];
      if (beam) {
        range = [beam.minX - 1.2 * sp, beam.maxX + 1.2 * sp];
        source = 'beam';
      }
    }
    if (!range) continue;
    const members = items.filter((it) => !it.grace && !taken.has(it.id) && it.cx >= range![0] - 0.3 * sp && it.cx <= range![1] + 0.3 * sp);
    if (!members.length) continue;
    const normal = tupletNormal(label.actual, label.normal);
    for (const m of members) taken.add(m.id);
    out.push({
      itemIds: members.map((m) => m.id),
      actual: label.actual,
      normal,
      ratio: normal / label.actual,
      x1: range[0],
      x2: range[1],
      y: ly,
      source,
    });
  }
  return out;
}
