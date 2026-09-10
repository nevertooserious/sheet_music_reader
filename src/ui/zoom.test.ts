import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PRESETS,
  formatScalePercent,
  formatZoom,
  normalizeZoom,
  parseZoom,
  resolveScale,
  stepZoom,
  wheelZoomFactor,
} from './zoom';

describe('resolveScale', () => {
  it('fits the widest page to the available width', () => {
    expect(resolveScale('fit-width', 1190, 500, 595, 842)).toBe(2);
    expect(resolveScale('fit-width', 595, 5000, 595, 842)).toBe(1);
  });

  it('fits the whole page for fit-page, whichever dimension binds', () => {
    expect(resolveScale('fit-page', 1190, 421, 595, 842)).toBe(0.5);
    expect(resolveScale('fit-page', 297.5, 5000, 595, 842)).toBe(0.5);
  });

  it('uses a numeric zoom as-is within the limits regardless of the viewport', () => {
    expect(resolveScale(1.5, 100, 100, 595, 842)).toBe(1.5);
    expect(resolveScale(0.01, 100, 100, 595, 842)).toBe(ZOOM_MIN);
    expect(resolveScale(99, 100, 100, 595, 842)).toBe(ZOOM_MAX);
  });

  it('falls back to 1 when the viewport has no size yet', () => {
    expect(resolveScale('fit-width', 0, 0, 595, 842)).toBe(1);
    expect(resolveScale('fit-page', 0, 0, 595, 842)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('moves to the next preset in either direction', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.79, 1)).toBe(2);
    expect(stepZoom(1.79, -1)).toBe(1.75);
  });

  it('ignores rounding noise around a preset', () => {
    expect(stepZoom(1.0000001, 1)).toBe(1.1);
    expect(stepZoom(0.9999999, -1)).toBe(0.9);
  });

  it('is undefined past the ends', () => {
    expect(stepZoom(ZOOM_PRESETS[ZOOM_PRESETS.length - 1], 1)).toBeUndefined();
    expect(stepZoom(ZOOM_PRESETS[0], -1)).toBeUndefined();
    expect(stepZoom(0.3, 1)).toBe(0.5);
    expect(stepZoom(3.5, -1)).toBe(3);
  });
});

describe('wheelZoomFactor', () => {
  it('reproduces a Chrome trackpad pinch, which arrives as ctrl+wheel with deltaY = -100·ln(scale)', () => {
    expect(wheelZoomFactor(-100 * Math.log(1.1))).toBeCloseTo(1.1, 6);
    expect(wheelZoomFactor(100 * Math.log(1.1))).toBeCloseTo(1 / 1.1, 6);
    expect(wheelZoomFactor(-5)).toBeCloseTo(Math.exp(0.05), 6);
  });

  it('caps a mouse notch to one step in pixel, line and page modes', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.2, 6);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.2, 6);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.2, 6);
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(1 / 1.2, 6);
  });

  it('is neutral without vertical movement', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });
});

describe('normalizeZoom', () => {
  it('rounds to a thousandth and clamps to the range', () => {
    expect(normalizeZoom(1.23456)).toBe(1.235);
    expect(normalizeZoom(0.01)).toBe(ZOOM_MIN);
    expect(normalizeZoom(10)).toBe(ZOOM_MAX);
  });
});

describe('zoom persistence', () => {
  it('round-trips every mode through formatZoom/parseZoom', () => {
    expect(parseZoom(formatZoom('fit-width'))).toBe('fit-width');
    expect(parseZoom(formatZoom('fit-page'))).toBe('fit-page');
    for (const p of ZOOM_PRESETS) expect(parseZoom(formatZoom(p))).toBe(p);
    expect(parseZoom(formatZoom(1.234))).toBe(1.234);
  });

  it('keeps free zoom values exactly, clamps them to the range and rejects garbage', () => {
    expect(parseZoom('1.02')).toBe(1.02);
    expect(parseZoom('2.2')).toBe(2.2);
    expect(parseZoom('0.1')).toBe(ZOOM_MIN);
    expect(parseZoom('99')).toBe(ZOOM_MAX);
    expect(parseZoom('')).toBeUndefined();
    expect(parseZoom(null)).toBeUndefined();
    expect(parseZoom(undefined)).toBeUndefined();
    expect(parseZoom('huge')).toBeUndefined();
    expect(parseZoom('-1')).toBeUndefined();
  });

  it('formats scales as whole percentages', () => {
    expect(formatScalePercent(1.7899)).toBe('179%');
    expect(formatScalePercent(0.5)).toBe('50%');
  });
});
