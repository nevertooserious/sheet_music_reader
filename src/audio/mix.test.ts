import { describe, expect, it } from 'vitest';
import type { TrackMixState } from '../core/types';
import { PAN_SPREAD, anySolo, clampGain, dbToMeter, effectiveTrackGain, gainToDb, panPositions, resolveTrackGains, smoothLevel } from './mix';

const track = (id: string, patch: Partial<TrackMixState> = {}): TrackMixState => ({
  trackId: id,
  gain: 0.8,
  muted: false,
  solo: false,
  level: 0,
  ...patch,
});

describe('effectiveTrackGain', () => {
  it('passes the fader through when nothing is muted or soloed', () => {
    expect(effectiveTrackGain(track('a'), false)).toBe(0.8);
  });

  it('mute silences regardless of solo', () => {
    expect(effectiveTrackGain(track('a', { muted: true }), false)).toBe(0);
    expect(effectiveTrackGain(track('a', { muted: true, solo: true }), true)).toBe(0);
  });

  it('a solo elsewhere silences non-soloed tracks and keeps soloed ones', () => {
    expect(effectiveTrackGain(track('a'), true)).toBe(0);
    expect(effectiveTrackGain(track('a', { solo: true }), true)).toBe(0.8);
  });

  it('clamps the fader to 0..1', () => {
    expect(effectiveTrackGain(track('a', { gain: 3 }), false)).toBe(1);
    expect(effectiveTrackGain(track('a', { gain: -1 }), false)).toBe(0);
    expect(effectiveTrackGain(track('a', { gain: Number.NaN }), false)).toBe(0);
  });
});

describe('resolveTrackGains', () => {
  it('resolves a whole mixer at once', () => {
    const gains = resolveTrackGains([track('a', { solo: true, gain: 0.5 }), track('b'), track('c', { muted: true, solo: true })]);
    expect(gains).toEqual({ a: 0.5, b: 0, c: 0 });
    expect(anySolo([track('a'), track('b')])).toBe(false);
  });
});

describe('clampGain', () => {
  it('bounds and sanitises', () => {
    expect(clampGain(0.5)).toBe(0.5);
    expect(clampGain(2)).toBe(1);
    expect(clampGain(-0.1)).toBe(0);
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('uses the fallback for non-finite input when one is given', () => {
    expect(clampGain(Number.NaN, 0.8)).toBe(0.8);
    expect(clampGain(0.3, 0.8)).toBe(0.3);
  });
});

describe('panPositions', () => {
  it('centres a single track and spreads two staves top-right / bottom-left', () => {
    expect(panPositions([{ staffIndex: 0 }])).toEqual([0]);
    expect(panPositions([])).toEqual([]);
    expect(panPositions([{ staffIndex: 0 }, { staffIndex: 1 }])).toEqual([PAN_SPREAD, -PAN_SPREAD]);
  });

  it('spreads more staves evenly and follows staff order rather than list order', () => {
    expect(panPositions([{ staffIndex: 2 }, { staffIndex: 0 }, { staffIndex: 1 }], 0.3)).toEqual([-0.3, 0.3, 0]);
    const five = panPositions(Array.from({ length: 5 }, (_, i) => ({ staffIndex: i })), 0.4);
    expect(five).toEqual([0.4, 0.2, 0, -0.2, -0.4]);
  });

  it('falls back to list order when staff indices repeat', () => {
    expect(panPositions([{ staffIndex: 0 }, { staffIndex: 0 }], 0.2)).toEqual([0.2, -0.2]);
  });
});

describe('smoothLevel', () => {
  it('jumps up instantly and falls exponentially', () => {
    expect(smoothLevel(0.1, 0.7, 1 / 60)).toBe(0.7);
    const fallen = smoothLevel(0.7, 0, 0.25);
    expect(fallen).toBeCloseTo(0.7 / Math.E, 6);
    expect(smoothLevel(0.7, 0, 5)).toBeLessThan(0.001);
  });

  it('never exceeds 1 and ignores garbage', () => {
    expect(smoothLevel(0, 4, 0.01)).toBe(1);
    expect(smoothLevel(Number.NaN, Number.NaN, 0.01)).toBe(0);
  });
});

describe('dB helpers', () => {
  it('converts gain to dB and to a meter fraction', () => {
    expect(gainToDb(1)).toBeCloseTo(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(dbToMeter(0)).toBe(1);
    expect(dbToMeter(-30)).toBeCloseTo(0.5);
    expect(dbToMeter(-90)).toBe(0);
    expect(dbToMeter(-Infinity)).toBe(0);
  });
});
