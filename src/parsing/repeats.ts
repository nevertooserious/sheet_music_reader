import type { System } from './model';
import { mergeCollinear, type HLine, type VLine } from './staves';

export interface VoltaBracket {
  x1: number;
  x2: number;
  y: number;
  /** Passes this ending is played on. */
  numbers: number[];
  label: BracketLabel;
  /** A hook hangs from the right end: the ending finishes here rather than running on to the next line. */
  closedRight: boolean;
  /** Numberless continuation of a bracket that began on the previous line. */
  inherited?: boolean;
}

/** A run of text (or of small digit glyphs) that may label a volta bracket; `y` is its baseline. */
export interface BracketLabel {
  x: number;
  y: number;
  text: string;
}

/** "1." → [1]; "1.-2." / "1–2" → [1, 2]; "1. 2." → [1, 2]; anything without a small number → undefined. */
export function parseVoltaNumbers(text: string): number[] | undefined {
  const t = text.trim();
  if (!/^\d/.test(t)) return undefined;
  const range = /^(\d)\s*\.?\s*[-–—]\s*(\d)\s*\.?$/.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (b < a) return undefined;
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  if (!/^[\d.,\s]+$/.test(t)) return undefined;
  const numbers = [...t.matchAll(/\d/g)].map((m) => Number(m[0])).filter((n) => n >= 1);
  return numbers.length ? [...new Set(numbers)] : undefined;
}

/**
 * Volta brackets: a thin horizontal line above the system's top staff with a
 * hook hanging from its left end and an ending number just inside the hook.
 * When the previous line ended under an open bracket (`inherited` numbers),
 * a bracket line starting before the first head of this line (engravers
 * begin it either at the edge or after the clef and key) continues that
 * ending and needs neither hook nor number.
 */
export function detectVoltas(horizontal: HLine[], vertical: VLine[], labels: BracketLabel[], system: System, inherited?: number[], firstHeadX?: number): VoltaBracket[] {
  const sp = system.staves[0].space;
  const startLimit = Math.max(system.x1 + 2 * sp, firstHeadX ?? -Infinity);
  const out: VoltaBracket[] = [];
  const candidates = mergeCollinear(
    horizontal.filter(
      (h) =>
        h.y <= system.top - 1.0 * sp &&
        h.y >= system.top - 12 * sp &&
        h.x2 - h.x1 >= 2 * sp &&
        h.thickness <= 0.4 * sp &&
        h.x2 >= system.x1 - 2 * sp &&
        h.x1 <= system.x2 + 2 * sp,
    ),
    0.5 * sp,
  );
  const hookAt = (x: number, y: number): boolean =>
    vertical.some((v) => Math.abs(v.x - x) <= 0.5 * sp && v.y1 <= y + 0.3 * sp && v.y2 >= y + 0.8 * sp && v.y2 - v.y1 <= 5 * sp && v.thickness <= 0.5 * sp);
  for (const h of candidates) {
    if (!hookAt(h.x1, h.y)) continue;
    let numbers: number[] | undefined;
    let label: BracketLabel | undefined;
    for (const l of labels) {
      if (l.x < h.x1 - 0.5 * sp || l.x > h.x1 + 4 * sp || l.y < h.y - 0.5 * sp || l.y > h.y + 3.5 * sp) continue;
      numbers = parseVoltaNumbers(l.text);
      if (numbers) {
        label = l;
        break;
      }
    }
    if (!numbers || !label) continue;
    out.push({ x1: h.x1, x2: h.x2, y: h.y, numbers, label, closedRight: hookAt(h.x2, h.y) });
  }
  if (inherited && !out.some((v) => v.x1 <= startLimit)) {
    const cont = candidates.filter((h) => h.x1 >= system.x1 - 2 * sp && h.x1 <= startLimit).sort((a, b) => b.x2 - a.x2)[0];
    if (cont) {
      out.push({
        // The ending logically resumes at the line's edge even when the stroke starts after the key signature.
        x1: Math.min(cont.x1, system.x1),
        x2: cont.x2,
        y: cont.y,
        numbers: inherited,
        label: { x: cont.x1, y: cont.y, text: inherited.join(',') },
        closedRight: hookAt(cont.x2, cont.y),
        inherited: true,
      });
    }
  }
  return out.sort((a, b) => a.x1 - b.x1);
}

/** Numbers of a bracket that runs off the right edge of its system without a closing hook. */
export function openVoltaAtLineEnd(voltas: VoltaBracket[], system: System): number[] | undefined {
  const sp = system.staves[0].space;
  const last = [...voltas].sort((a, b) => a.x2 - b.x2).pop();
  return last && last.x2 >= system.x2 - 1 * sp && !last.closedRight ? last.numbers : undefined;
}

/** Volta numbers for a measure region whose centre lies under a bracket. */
export function voltaForRegion(voltas: VoltaBracket[], x1: number, x2: number, space: number): number[] | undefined {
  const cx = (x1 + x2) / 2;
  return voltas.find((v) => cx >= v.x1 - space && cx <= v.x2 + space)?.numbers;
}
