import type { Track } from '../core/types';
import { midiToFrequency } from '../core/types';
import {
  type AutomationEvent,
  FAST_RELEASE_SECONDS,
  clampMidi,
  cutoffFor,
  envelopeAutomation,
  envelopeValueAt,
  partialAutomation,
  resolveEnvelope,
  timbreFor,
} from './envelope';

/** Time constants of release before the oscillators are stopped (e^-6 is well below audibility). */
const RELEASE_TAIL_MULTIPLE = 6;

export interface VoiceRequest {
  midi: number;
  velocity: number;
  startTime: number;
  durationSeconds: number;
  /** Seconds of the note that have already elapsed at `startTime`; the voice joins the envelope there instead of re-attacking. */
  elapsedSeconds?: number;
  instrument: Track['instrument'];
  onEnded?: () => void;
}

export interface Voice {
  readonly startTime: number;
  /** When the natural release begins. */
  readonly endTime: number;
  readonly stopTime: number;
  /** Velocity-mapped peak amplitude of the voice envelope (before track and master gain). */
  readonly peak: number;
  /** Begin releasing at `at` (context time) with an optional time constant; used by pause/seek. */
  release(at: number, tau?: number): void;
  /** Move the natural release to `endTime` (tempo change or seek inside the note); no-op once releasing. */
  retime(endTime: number): void;
  /** Fast-release at `at` even if a natural release is already under way; used when the same pitch retriggers. */
  choke(at: number): void;
  /** Silence and detach a voice that has not started sounding; it never reaches the output. */
  cancel(): void;
}

function applyAutomation(param: AudioParam, events: readonly AutomationEvent[], t0: number): void {
  for (const e of events) {
    const t = t0 + e.at;
    if (e.kind === 'set') param.setValueAtTime(e.value, t);
    else if (e.kind === 'ramp') param.linearRampToValueAtTime(e.value, t);
    else param.setTargetAtTime(e.value, t, e.tau);
  }
}

/**
 * Additive/subtractive voice: per-partial oscillators with their own decay, a shared
 * envelope gain and a pitch-tracking lowpass. Works on both AudioContext and OfflineAudioContext.
 */
export function startVoice(ctx: BaseAudioContext, destination: AudioNode, req: VoiceRequest): Voice {
  const timbre = timbreFor(req.instrument);
  const env = resolveEnvelope(timbre, req.midi, req.velocity);
  const frequency = midiToFrequency(clampMidi(req.midi));
  const t0 = Math.max(req.startTime, ctx.currentTime);
  const automation = envelopeAutomation(env, req.elapsedSeconds ?? 0);
  const elapsed = automation.elapsedSeconds;
  const minEnd = t0 + automation.attackSeconds + 0.01;
  let tEnd = Math.max(minEnd, t0 + req.durationSeconds);
  const stopAfter = (end: number, tau: number): number => end + tau * RELEASE_TAIL_MULTIPLE + 0.02;
  let stopTime = stopAfter(tEnd, env.release);
  let releaseStart = tEnd;
  let releaseTau = env.release;

  /** Analytic mirror of the scheduled automation, for browsers without cancelAndHoldAtTime. */
  const valueAt = (t: number): number => {
    const base = envelopeValueAt(env, elapsed + (Math.min(t, releaseStart) - t0));
    return t <= releaseStart ? base : base * Math.exp(-(t - releaseStart) / releaseTau);
  };

  const envelope = ctx.createGain();
  applyAutomation(envelope.gain, automation.events, t0);
  const scheduleRelease = (end: number): void => {
    envelope.gain.setValueAtTime(envelopeValueAt(env, elapsed + (end - t0)), end);
    envelope.gain.setTargetAtTime(0, end, env.release);
  };
  scheduleRelease(tEnd);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoffFor(timbre, req.midi, req.velocity, ctx.sampleRate);
  filter.Q.value = timbre.q;
  envelope.connect(filter);
  filter.connect(destination);

  const oscillators: OscillatorNode[] = [];
  const partialGains: GainNode[] = [];
  const nyquistGuard = ctx.sampleRate * 0.45;
  for (const partial of timbre.partials) {
    const f = frequency * partial.ratio;
    if (f > nyquistGuard) continue;
    const osc = ctx.createOscillator();
    osc.type = partial.type;
    osc.frequency.value = f;
    osc.detune.value = partial.detuneCents;
    const gain = ctx.createGain();
    applyAutomation(gain.gain, partialAutomation(partial, env, elapsed), t0);
    osc.connect(gain);
    gain.connect(envelope);
    osc.start(t0);
    osc.stop(stopTime);
    oscillators.push(osc);
    partialGains.push(gain);
  }

  const restop = (at: number): void => {
    stopTime = at;
    for (const osc of oscillators) {
      try {
        osc.stop(at);
      } catch {
        // Older engines reject a second stop(); the original stop time then applies, which is only later.
      }
    }
  };

  let finished = false;
  let released = false;
  const teardown = (): void => {
    if (finished) return;
    finished = true;
    for (const osc of oscillators) {
      osc.onended = null;
      osc.disconnect();
    }
    for (const gain of partialGains) gain.disconnect();
    envelope.disconnect();
    filter.disconnect();
    req.onEnded?.();
  };
  if (oscillators.length > 0) oscillators[0].onended = teardown;
  else queueMicrotask(teardown);

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
    peak: env.peak,
    release(at, tau = env.release) {
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
      restop(stopAfter(end, env.release));
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
    },
  };
}

export interface MasterBus {
  input: GainNode;
  limiter: DynamicsCompressorNode;
  analyser?: AnalyserNode;
}

/** master gain -> soft limiter -> (analyser) -> destination. */
export function createMasterBus(ctx: BaseAudioContext, gain: number, withAnalyser = false): MasterBus {
  const input = ctx.createGain();
  input.gain.value = gain;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 10;
  limiter.ratio.value = 3;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  input.connect(limiter);
  let analyser: AnalyserNode | undefined;
  if (withAnalyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    limiter.connect(analyser);
    analyser.connect(ctx.destination);
  } else {
    limiter.connect(ctx.destination);
  }
  return { input, limiter, analyser };
}

export interface TrackBus {
  input: GainNode;
  analyser?: AnalyserNode;
  panner?: StereoPannerNode;
  disconnect(): void;
}

/** track gain -> (analyser for the meter) -> (stereo panner) -> destination. */
export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  gain: number,
  pan: number,
  withAnalyser: boolean,
): TrackBus {
  const input = ctx.createGain();
  input.gain.value = gain;
  let tail: AudioNode = input;
  let analyser: AnalyserNode | undefined;
  if (withAnalyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    tail.connect(analyser);
    tail = analyser;
  }
  let panner: StereoPannerNode | undefined;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    panner = ctx.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, pan));
    tail.connect(panner);
    tail = panner;
  }
  tail.connect(destination);
  return {
    input,
    analyser,
    panner,
    disconnect() {
      input.disconnect();
      analyser?.disconnect();
      panner?.disconnect();
    },
  };
}
