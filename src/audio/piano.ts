import type { Track } from '../core/types';
import { CHASE_ATTACK_SECONDS, FAST_RELEASE_SECONDS, clampMidi, clampVelocity, velocityToPeak } from './envelope';
import type { Voice, VoiceRequest } from './synth';

/** Salamander Grand Piano (Alexander Holm, CC BY 3.0): one recording every minor third from A0 to C8. */
export const PIANO_SAMPLE_MIDIS: readonly number[] = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
export const PIANO_SAMPLE_PATH = 'samples/piano/';
/** With fewer recordings a note would be stretched further than a major third from its neighbour; the synth is the better fallback then. */
export const MIN_USABLE_SAMPLES = 20;
/** The recordings peak near -9 dBFS where the synth's partials sum near 0 dBFS; this make-up gain lands both at the same loudness. */
export const PIANO_SAMPLE_GAIN = 2.2;

const ATTACK_SECONDS = 0.003;
/** Damper landing on the strings; the recordings carry the natural decay themselves. */
const RELEASE_SECONDS = 0.1;
const RELEASE_TAIL_MULTIPLE = 6;
/** One recorded dynamic layer: soft notes close a lowpass so velocity is heard as tone, not only level. */
const CUTOFF_FLOOR_HZ = 1400;
const CUTOFF_OCTAVES = 3.5;
const NOTE_FILE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

export interface PianoSampleSet {
  buffers: ReadonlyMap<number, AudioBuffer>;
}

/**
 * The parser emits 'piano' for pitched staves and 'other' for percussion lines and anything it cannot
 * name; a rehearsal piano is the conventional stand-in for both, where the synth pad reads as noise.
 * Named instruments keep their synth timbres.
 */
export function playsPianoSamples(instrument: Track['instrument'] | undefined): boolean {
  return instrument === undefined || instrument === 'piano' || instrument === 'other';
}

export function sampleFileName(midi: number): string {
  return `${NOTE_FILE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`;
}

export function nearestSampleMidi(available: Iterable<number>, midi: number): number | undefined {
  let best: number | undefined;
  for (const m of available) {
    if (best === undefined) {
      best = m;
      continue;
    }
    const distance = Math.abs(m - midi);
    const bestDistance = Math.abs(best - midi);
    if (distance < bestDistance || (distance === bestDistance && m < best)) best = m;
  }
  return best;
}

export function playbackRateFor(sampleMidi: number, midi: number): number {
  return Math.pow(2, (midi - sampleMidi) / 12);
}

export function cutoffForVelocity(velocity: number, sampleRate: number): number {
  return Math.min(sampleRate * 0.45, CUTOFF_FLOOR_HZ * Math.pow(2, CUTOFF_OCTAVES * clampVelocity(velocity)));
}

export interface LoadSamplesOptions {
  baseUrl: string;
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  fetchFn?: typeof fetch;
  midis?: readonly number[];
  minUsable?: number;
}

/** Never rejects: files that fail are skipped, and too few of them yields undefined so the synth covers the piano. */
export async function loadPianoSamples(options: LoadSamplesOptions): Promise<PianoSampleSet | undefined> {
  const midis = options.midis ?? PIANO_SAMPLE_MIDIS;
  const fetchFn = options.fetchFn ?? fetch;
  const buffers = new Map<number, AudioBuffer>();
  await Promise.all(
    midis.map(async (midi) => {
      try {
        const response = await fetchFn(new URL(sampleFileName(midi), options.baseUrl).href);
        if (!response.ok) return;
        buffers.set(midi, await options.decode(await response.arrayBuffer()));
      } catch {
        return;
      }
    }),
  );
  return buffers.size >= (options.minUsable ?? MIN_USABLE_SAMPLES) ? { buffers } : undefined;
}

/** Fetches and decodes the bundled recordings in a browser; undefined elsewhere (unit tests). */
export function loadBundledPiano(): Promise<PianoSampleSet | undefined> | undefined {
  if (typeof document === 'undefined' || typeof OfflineAudioContext === 'undefined' || typeof fetch !== 'function') return undefined;
  // Decoding needs a context; an offline one avoids creating the playback context before the first user gesture.
  const decoder = new OfflineAudioContext(1, 1, 44100);
  return loadPianoSamples({
    baseUrl: new URL(PIANO_SAMPLE_PATH, document.baseURI).href,
    decode: (data) => decoder.decodeAudioData(data),
  });
}

/**
 * Plays the nearest recording pitch-shifted to the note under a short fade-in, a velocity lowpass and a
 * damper release. Same Voice contract as the synth, so the engine treats both alike.
 */
export function startSampledVoice(ctx: BaseAudioContext, destination: AudioNode, req: VoiceRequest, set: PianoSampleSet): Voice {
  const midi = clampMidi(req.midi);
  const sampleMidi = nearestSampleMidi(set.buffers.keys(), midi);
  const buffer = sampleMidi === undefined ? undefined : set.buffers.get(sampleMidi);
  if (sampleMidi === undefined || !buffer) throw new Error('startSampledVoice: the sample set is empty.');
  const rate = playbackRateFor(sampleMidi, midi);
  const velocity = clampVelocity(req.velocity);
  const peak = velocityToPeak(velocity);
  const level = peak * PIANO_SAMPLE_GAIN;
  const t0 = Math.max(req.startTime, ctx.currentTime);
  const elapsed = req.elapsedSeconds !== undefined && Number.isFinite(req.elapsedSeconds) && req.elapsedSeconds > ATTACK_SECONDS ? req.elapsedSeconds : 0;
  const attack = elapsed > 0 ? CHASE_ATTACK_SECONDS : ATTACK_SECONDS;
  const minEnd = t0 + attack + 0.01;
  let tEnd = Math.max(minEnd, t0 + req.durationSeconds);
  const stopAfter = (end: number, tau: number): number => end + tau * RELEASE_TAIL_MULTIPLE + 0.02;
  let stopTime = stopAfter(tEnd, RELEASE_SECONDS);
  let releaseStart = tEnd;
  let releaseTau = RELEASE_SECONDS;

  const levelAt = (t: number): number => (t <= t0 ? 0 : Math.min(1, (t - t0) / attack) * level);
  /** Analytic mirror of the scheduled automation, for browsers without cancelAndHoldAtTime. */
  const valueAt = (t: number): number =>
    t <= releaseStart ? levelAt(t) : levelAt(releaseStart) * Math.exp(-(t - releaseStart) / releaseTau);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, t0);
  envelope.gain.linearRampToValueAtTime(level, t0 + attack);
  const scheduleRelease = (end: number): void => {
    envelope.gain.setValueAtTime(level, end);
    envelope.gain.setTargetAtTime(0, end, RELEASE_SECONDS);
  };
  scheduleRelease(tEnd);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoffForVelocity(velocity, ctx.sampleRate);
  filter.Q.value = 0.5;
  envelope.connect(filter);
  filter.connect(destination);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(envelope);
  source.start(t0, Math.min(elapsed * rate, Math.max(0, buffer.duration - 0.05)));
  source.stop(stopTime);

  const restop = (at: number): void => {
    stopTime = at;
    try {
      source.stop(at);
    } catch {
      // Older engines reject a second stop(); the original stop time then applies, which is only later.
    }
  };

  let finished = false;
  let released = false;
  const teardown = (): void => {
    if (finished) return;
    finished = true;
    source.onended = null;
    source.disconnect();
    envelope.disconnect();
    filter.disconnect();
    req.onEnded?.();
  };
  source.onended = teardown;

  const holdAt = (t: number): void => {
    const param = envelope.gain;
    const holdable = param as AudioParam & { cancelAndHoldAtTime?: (time: number) => AudioParam };
    if (typeof holdable.cancelAndHoldAtTime === 'function') {
      holdable.cancelAndHoldAtTime(t);
    } else {
      param.cancelScheduledValues(t);
      param.setValueAtTime(valueAt(t), t);
    }
  };

  const fadeOut = (at: number, tau: number): void => {
    const t = Math.max(at, t0, ctx.currentTime);
    if (t >= stopTime) return;
    holdAt(t);
    envelope.gain.setTargetAtTime(0, t, tau);
    if (t <= releaseStart) {
      releaseStart = t;
      releaseTau = tau;
    }
    released = true;
    const stop = stopAfter(t, tau);
    if (stop < stopTime) restop(stop);
  };

  return {
    startTime: t0,
    get endTime() {
      return tEnd;
    },
    get stopTime() {
      return stopTime;
    },
    peak,
    release(at, tau = RELEASE_SECONDS) {
      if (released || finished) return;
      fadeOut(at, tau);
    },
    retime(endTime) {
      if (released || finished) return;
      const now = ctx.currentTime;
      if (tEnd <= now + 0.001) return;
      const end = Math.max(endTime, now + 0.005, minEnd);
      if (Math.abs(end - tEnd) < 1e-4) return;
      envelope.gain.cancelScheduledValues(Math.min(tEnd, end));
      tEnd = end;
      releaseStart = end;
      scheduleRelease(end);
      restop(stopAfter(end, RELEASE_SECONDS));
    },
    choke(at) {
      if (finished) return;
      fadeOut(at, FAST_RELEASE_SECONDS);
    },
    cancel() {
      if (finished) return;
      released = true;
      envelope.gain.cancelScheduledValues(0);
      envelope.gain.value = 0;
      envelope.disconnect();
      restop(Math.max(t0, ctx.currentTime));
    },
  };
}
