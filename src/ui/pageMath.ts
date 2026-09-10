export const MAX_RENDER_DPR = 2;
/** 16 Mpx ≈ 64 MB RGBA per page bitmap. */
export const MAX_BITMAP_PIXELS = 16 * 1024 * 1024;

/** Device pixel ratio to render at: capped, then reduced so the page bitmap stays under the pixel budget. */
export function effectiveDpr(
  deviceDpr: number,
  cssWidth: number,
  cssHeight: number,
  maxDpr = MAX_RENDER_DPR,
  maxPixels = MAX_BITMAP_PIXELS,
): number {
  let dpr = Math.min(Math.max(Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1, 0.5), maxDpr);
  const pixels = cssWidth * cssHeight * dpr * dpr;
  if (pixels > maxPixels) dpr *= Math.sqrt(maxPixels / pixels);
  return Math.round(dpr * 1000) / 1000;
}

export interface PageRange {
  from: number;
  to: number;
}

/** Index range covering the visible pages plus `margin` on each side, clamped to [0, count). */
export function pageRange(visible: Iterable<number>, count: number, margin: number): PageRange | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of visible) {
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  if (!Number.isFinite(lo) || count <= 0) return undefined;
  return { from: Math.max(0, lo - margin), to: Math.min(count - 1, hi + margin) };
}

/** Render order: visible pages top-down, then alternating below/above, widening outwards within range. */
export function renderOrder(visible: readonly number[], range: PageRange): number[] {
  const sorted = [...visible].filter((i) => i >= range.from && i <= range.to).sort((a, b) => a - b);
  if (sorted.length === 0) {
    const all: number[] = [];
    for (let i = range.from; i <= range.to; i++) all.push(i);
    return all;
  }
  const out = [...sorted];
  const seen = new Set(sorted);
  let below = sorted[sorted.length - 1] + 1;
  let above = sorted[0] - 1;
  while (below <= range.to || above >= range.from) {
    if (below <= range.to) {
      if (!seen.has(below)) out.push(below);
      below++;
    }
    if (above >= range.from) {
      if (!seen.has(above)) out.push(above);
      above--;
    }
  }
  return out;
}

export function bitmapBytes(canvases: Iterable<{ width: number; height: number }>): number {
  let total = 0;
  for (const c of canvases) total += c.width * c.height * 4;
  return total;
}
