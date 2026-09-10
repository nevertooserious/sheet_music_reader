import { clamp, fitScale } from './format';

/** 'fit-width' and 'fit-page' track the viewport; a number is CSS pixels per PDF point (1 = 100 %). */
export type ZoomMode = 'fit-width' | 'fit-page' | number;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const DEFAULT_ZOOM: ZoomMode = 'fit-width';

const STEP_TOLERANCE = 0.01;
/** One mouse-wheel notch (or one line/page tick) zooms by at most this factor. */
const WHEEL_STEP_MAX = 1.2;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;

export function resolveScale(
  mode: ZoomMode,
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  if (typeof mode === 'number') return clamp(mode, ZOOM_MIN, ZOOM_MAX);
  const width = fitScale(availableWidth, pageWidth, ZOOM_MIN, ZOOM_MAX);
  if (mode === 'fit-width') return width;
  return Math.min(width, fitScale(availableHeight, pageHeight, ZOOM_MIN, ZOOM_MAX));
}

/** Nearest preset above (direction 1) or below (direction -1) the current scale; undefined past the last preset. */
export function stepZoom(scale: number, direction: 1 | -1): number | undefined {
  if (direction > 0) return ZOOM_PRESETS.find((p) => p > scale * (1 + STEP_TOLERANCE));
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) {
    if (ZOOM_PRESETS[i] < scale * (1 - STEP_TOLERANCE)) return ZOOM_PRESETS[i];
  }
  return undefined;
}

/** Free zoom values from a wheel or pinch, clamped to the range and rounded so the stored form stays short. */
export function normalizeZoom(scale: number): number {
  return clamp(Math.round(scale * 1000) / 1000, ZOOM_MIN, ZOOM_MAX);
}

/**
 * Zoom factor for a ctrl/⌘ + wheel event. Chrome and Firefox deliver a trackpad pinch as ctrl+wheel with
 * deltaY = -100·ln(scale), so exp(-deltaY / 100) reproduces the finger movement exactly; a mouse notch
 * (±100 px, or a line/page tick) would be a 2.7× jump and is capped to one comfortable step instead.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  return clamp(Math.exp(-px / 100), 1 / WHEEL_STEP_MAX, WHEEL_STEP_MAX);
}

export function formatZoom(mode: ZoomMode): string {
  return typeof mode === 'number' ? String(mode) : mode;
}

/** Inverse of formatZoom for stored or select values; numbers are kept (clamped to the range), anything else is undefined. */
export function parseZoom(value: string | null | undefined): ZoomMode | undefined {
  if (value === 'fit-width' || value === 'fit-page') return value;
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return normalizeZoom(n);
}

export function formatScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
