import type { TrackMixState } from '../core/types';

export function clampGain(gain: number, fallback = 0): number {
  if (!Number.isFinite(gain)) return fallback;
  return Math.min(1, Math.max(0, gain));
}

export function anySolo(tracks: readonly Pick<TrackMixState, 'solo'>[]): boolean {
  return tracks.some((t) => t.solo);
}

/** Gain actually applied to a track's bus: mute wins, then solo (any soloed track silences the rest), then the fader. */
export function effectiveTrackGain(
  track: Pick<TrackMixState, 'gain' | 'muted' | 'solo'>,
  soloActive: boolean,
): number {
  if (track.muted) return 0;
  if (soloActive && !track.solo) return 0;
  return clampGain(track.gain);
}

export function resolveTrackGains(tracks: readonly TrackMixState[]): Record<string, number> {
  const soloActive = anySolo(tracks);
  const out: Record<string, number> = {};
  for (const t of tracks) out[t.trackId] = effectiveTrackGain(t, soloActive);
  return out;
}

export const PAN_SPREAD = 0.22;

/**
 * Stereo position per track, -1..1: the top staff sits slightly right and the bottom staff
 * slightly left (as a keyboard would be heard), evenly spread; a single track stays centred.
 * Falls back to list order when staff indices are not distinct.
 */
export function panPositions(tracks: readonly { staffIndex: number }[], spread = PAN_SPREAD): number[] {
  const n = tracks.length;
  if (n < 2) return tracks.map(() => 0);
  const staves = tracks.map((t) => t.staffIndex);
  const distinct = new Set(staves).size === n && staves.every((s) => Number.isFinite(s));
  const order = distinct
    ? staves.map((s) => [...staves].sort((a, b) => a - b).indexOf(s))
    : tracks.map((_, i) => i);
  return order.map((rank) => ((n - 1 - 2 * rank) / (n - 1)) * spread);
}

/** Peak meter ballistics: instant attack, exponential fall with `fallTau` seconds. */
export function smoothLevel(previous: number, peak: number, dtSeconds: number, fallTau = 0.25): number {
  const safePrev = Number.isFinite(previous) ? Math.max(0, previous) : 0;
  const safePeak = Number.isFinite(peak) ? Math.max(0, peak) : 0;
  const decayed = safePrev * Math.exp(-Math.max(0, dtSeconds) / fallTau);
  return Math.min(1, Math.max(safePeak, decayed));
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** Meter fill 0..1 on a dB scale from `floorDb` to 0 dBFS. */
export function dbToMeter(db: number, floorDb = -60): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}
