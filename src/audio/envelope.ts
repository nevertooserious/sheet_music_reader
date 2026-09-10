import type { Track } from '../core/types';
import { midiToFrequency } from '../core/types';

export type TimbreName = 'piano' | 'plucked' | 'sustained' | 'organ';

export interface PartialSpec {
  ratio: number;
  type: OscillatorType;
  gain: number;
  detuneCents: number;
  /** Fraction of the voice decay time constant this partial decays with; 0 = holds its level. */
  decayScale: number;
  /** Level this partial decays towards, as a fraction of its gain. */
  sustain: number;
}

export interface Timbre {
  name: TimbreName;
  partials: PartialSpec[];
  attack: number;
  /** Struck instruments lose most of their energy right after the attack ("prompt sound") before the slow ring. */
  prompt: { level: number; tau: number; seconds: number };
  /** Level the slow decay heads for, as a fraction of the peak. */
  sustain: number;
  /** Slow decay time constant at middle C, seconds; lower notes ring longer. */
  decayTau: number;
  release: number;
  cutoffMultiple: number;
  cutoffVelocityMultiple: number;
  cutoffMin: number;
  cutoffMax: number;
  q: number;
  loudness: number;
}

export interface Envelope {
  attack: number;
  peak: number;
  /** Stage one after the attack: exponential fall towards promptLevel for promptSeconds (0 = no stage one). */
  promptLevel: number;
  promptTau: number;
  promptSeconds: number;
  /** Stage two: exponential fall towards sustainLevel with decayTau. */
  sustainLevel: number;
  decayTau: number;
  release: number;
}

export const ENVELOPE_LIMITS = {
  attackMin: 0.002,
  attackMax: 0.5,
  decayMin: 0.05,
  decayMax: 6,
  releaseMin: 0.02,
  releaseMax: 2,
  peakMax: 0.7,
} as const;

export const FAST_RELEASE_SECONDS = 0.035;
/** A repeated pitch chokes its predecessor this far before the new onset so the two never add up (a re-bow or re-strike gap). */
export const RETRIGGER_LEAD_SECONDS = 0.025;
/** Ramp used when a voice joins a note that is already sounding (seek into a held note); short, but never a step. */
export const CHASE_ATTACK_SECONDS = 0.008;

const TIMBRES: Record<TimbreName, Timbre> = {
  piano: {
    name: 'piano',
    partials: [
      { ratio: 1, type: 'triangle', gain: 0.6, detuneCents: 0, decayScale: 1, sustain: 0.5 },
      { ratio: 2, type: 'sine', gain: 0.3, detuneCents: 0, decayScale: 0.45, sustain: 0.15 },
      { ratio: 3.004, type: 'sine', gain: 0.14, detuneCents: 0, decayScale: 0.25, sustain: 0.05 },
      // The hammer: a bright, quickly dying sawtooth just above the fundamental.
      { ratio: 1, type: 'sawtooth', gain: 0.08, detuneCents: 4, decayScale: 0.12, sustain: 0 },
    ],
    attack: 0.006,
    prompt: { level: 0.35, tau: 0.14, seconds: 0.3 },
    sustain: 0.08,
    decayTau: 1.6,
    release: 0.09,
    cutoffMultiple: 5,
    cutoffVelocityMultiple: 4,
    cutoffMin: 400,
    cutoffMax: 11000,
    q: 0.8,
    loudness: 1,
  },
  plucked: {
    name: 'plucked',
    partials: [
      { ratio: 1, type: 'triangle', gain: 0.65, detuneCents: 0, decayScale: 1, sustain: 0.3 },
      { ratio: 2, type: 'sine', gain: 0.25, detuneCents: 0, decayScale: 0.4, sustain: 0.1 },
      { ratio: 1, type: 'sawtooth', gain: 0.1, detuneCents: 6, decayScale: 0.1, sustain: 0 },
    ],
    attack: 0.003,
    prompt: { level: 0.3, tau: 0.1, seconds: 0.25 },
    sustain: 0.04,
    decayTau: 0.7,
    release: 0.07,
    cutoffMultiple: 4,
    cutoffVelocityMultiple: 4,
    cutoffMin: 350,
    cutoffMax: 9000,
    q: 0.9,
    loudness: 0.95,
  },
  sustained: {
    name: 'sustained',
    partials: [
      { ratio: 1, type: 'sawtooth', gain: 0.34, detuneCents: -6, decayScale: 0, sustain: 1 },
      { ratio: 1, type: 'sawtooth', gain: 0.34, detuneCents: 6, decayScale: 0, sustain: 1 },
      { ratio: 2, type: 'sine', gain: 0.1, detuneCents: 0, decayScale: 0, sustain: 1 },
    ],
    attack: 0.06,
    prompt: { level: 1, tau: 1, seconds: 0 },
    sustain: 0.75,
    decayTau: 0.4,
    release: 0.2,
    cutoffMultiple: 3,
    cutoffVelocityMultiple: 2,
    cutoffMin: 300,
    cutoffMax: 7000,
    q: 1,
    loudness: 0.8,
  },
  organ: {
    name: 'organ',
    partials: [
      { ratio: 1, type: 'sine', gain: 0.5, detuneCents: 0, decayScale: 0, sustain: 1 },
      { ratio: 2, type: 'sine', gain: 0.35, detuneCents: 0, decayScale: 0, sustain: 1 },
      { ratio: 3, type: 'sine', gain: 0.2, detuneCents: 0, decayScale: 0, sustain: 1 },
      { ratio: 4, type: 'sine', gain: 0.12, detuneCents: 0, decayScale: 0, sustain: 1 },
    ],
    attack: 0.012,
    prompt: { level: 1, tau: 1, seconds: 0 },
    sustain: 1,
    decayTau: 1,
    release: 0.06,
    cutoffMultiple: 6,
    cutoffVelocityMultiple: 2,
    cutoffMin: 500,
    cutoffMax: 12000,
    q: 0.7,
    loudness: 0.7,
  },
};

const INSTRUMENT_TIMBRE: Record<Track['instrument'], TimbreName> = {
  piano: 'piano',
  guitar: 'plucked',
  strings: 'sustained',
  woodwind: 'sustained',
  brass: 'sustained',
  voice: 'sustained',
  other: 'sustained',
  organ: 'organ',
};

export function timbreFor(instrument: Track['instrument'] | undefined): Timbre {
  const name = (instrument && INSTRUMENT_TIMBRE[instrument]) || 'piano';
  return TIMBRES[name];
}

export function timbreByName(name: TimbreName): Timbre {
  return TIMBRES[name];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function clampVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0.8;
  return clamp(velocity, 0, 1);
}

export function clampMidi(midi: number): number {
  if (!Number.isFinite(midi)) return 60;
  return Math.round(clamp(midi, 0, 127));
}

/** Velocity 0.8 lands near 0.45 so a four-voice chord peaks a few dB under full scale before the limiter. */
export function velocityToPeak(velocity: number, loudness = 1): number {
  const v = clampVelocity(velocity);
  if (v === 0) return 0;
  return Math.min(ENVELOPE_LIMITS.peakMax, (0.07 + 0.55 * Math.pow(v, 1.6)) * loudness);
}

export function resolveEnvelope(timbre: Timbre, midi: number, velocity: number): Envelope {
  const v = clampVelocity(velocity);
  const m = clampMidi(midi);
  const peak = velocityToPeak(v, timbre.loudness);
  const attack = clamp(timbre.attack * (1.3 - 0.6 * v), ENVELOPE_LIMITS.attackMin, ENVELOPE_LIMITS.attackMax);
  const decayTau = clamp(timbre.decayTau * Math.pow(2, (60 - m) / 36), ENVELOPE_LIMITS.decayMin, ENVELOPE_LIMITS.decayMax);
  const release = clamp(timbre.release, ENVELOPE_LIMITS.releaseMin, ENVELOPE_LIMITS.releaseMax);
  const sustainLevel = peak * clamp(timbre.sustain, 0, 1);
  const promptSeconds = Math.max(0, timbre.prompt.seconds);
  return {
    attack,
    peak,
    promptLevel: Math.max(sustainLevel, peak * clamp(timbre.prompt.level, 0, 1)),
    promptTau: clamp(timbre.prompt.tau, ENVELOPE_LIMITS.decayMin, ENVELOPE_LIMITS.decayMax),
    promptSeconds,
    sustainLevel,
    decayTau,
    release,
  };
}

/** Envelope value where stage one hands over to stage two. */
export function promptEndLevel(env: Envelope): number {
  if (env.promptSeconds <= 0) return env.peak;
  return env.promptLevel + (env.peak - env.promptLevel) * Math.exp(-env.promptSeconds / env.promptTau);
}

/**
 * Analytic envelope value `tRel` seconds after note start, mirroring the Web Audio automation
 * (linear attack, prompt decay, slow decay towards sustain, exponential release from `releaseAtRel`).
 * Used to release a note early without a click where cancelAndHoldAtTime is unavailable.
 */
export function envelopeValueAt(env: Envelope, tRel: number, releaseAtRel = Infinity): number {
  if (!(tRel > 0)) return 0;
  if (tRel >= releaseAtRel) {
    return envelopeValueAt(env, releaseAtRel) * Math.exp(-(tRel - releaseAtRel) / env.release);
  }
  if (tRel < env.attack) return (env.peak * tRel) / env.attack;
  const sinceAttack = tRel - env.attack;
  if (sinceAttack < env.promptSeconds) {
    return env.promptLevel + (env.peak - env.promptLevel) * Math.exp(-sinceAttack / env.promptTau);
  }
  const handover = promptEndLevel(env);
  return env.sustainLevel + (handover - env.sustainLevel) * Math.exp(-(sinceAttack - env.promptSeconds) / env.decayTau);
}

/** Level of a decaying partial `tRel` seconds into the note (before the voice envelope is applied). */
export function partialLevelAt(partial: PartialSpec, env: Envelope, tRel: number): number {
  if (partial.decayScale <= 0) return partial.gain;
  const floor = partial.gain * partial.sustain;
  const since = Math.max(0, tRel - env.attack);
  return floor + (partial.gain - floor) * Math.exp(-since / (env.decayTau * partial.decayScale));
}

export type AutomationEvent =
  | { kind: 'set'; at: number; value: number }
  | { kind: 'ramp'; at: number; value: number }
  | { kind: 'target'; at: number; value: number; tau: number };

export interface EnvelopeAutomation {
  events: AutomationEvent[];
  /** Length of the initial ramp actually used (the timbre attack, or the short chase ramp). */
  attackSeconds: number;
  /** Seconds of the note that had already elapsed when the voice starts; 0 for a fresh attack. */
  elapsedSeconds: number;
}

/**
 * Automation (relative to voice start) that reproduces `envelopeValueAt(env, elapsed + t)` for
 * t >= attackSeconds. A fresh note runs the timbre attack; a voice that joins a note already in
 * progress ramps to the level the note has reached and continues its decay from there, so a seek
 * into a held note neither re-strikes it at full force nor drops it.
 */
export function envelopeAutomation(env: Envelope, elapsedSeconds = 0): EnvelopeAutomation {
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > env.attack ? elapsedSeconds : 0;
  const events: AutomationEvent[] = [{ kind: 'set', at: 0, value: 0 }];
  if (elapsed === 0) {
    events.push({ kind: 'ramp', at: env.attack, value: env.peak });
    if (env.promptSeconds > 0) events.push({ kind: 'target', at: env.attack, value: env.promptLevel, tau: env.promptTau });
    events.push({ kind: 'target', at: env.attack + env.promptSeconds, value: env.sustainLevel, tau: env.decayTau });
    return { events, attackSeconds: env.attack, elapsedSeconds: 0 };
  }
  const ramp = CHASE_ATTACK_SECONDS;
  events.push({ kind: 'ramp', at: ramp, value: envelopeValueAt(env, elapsed + ramp) });
  const handoverAt = env.attack + env.promptSeconds - elapsed;
  if (handoverAt > ramp) {
    events.push({ kind: 'target', at: ramp, value: env.promptLevel, tau: env.promptTau });
    events.push({ kind: 'target', at: handoverAt, value: env.sustainLevel, tau: env.decayTau });
  } else {
    events.push({ kind: 'target', at: ramp, value: env.sustainLevel, tau: env.decayTau });
  }
  return { events, attackSeconds: ramp, elapsedSeconds: elapsed };
}

/** Automation for one partial's own gain, matching `partialLevelAt(partial, env, elapsed + t)`. */
export function partialAutomation(partial: PartialSpec, env: Envelope, elapsedSeconds = 0): AutomationEvent[] {
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > env.attack ? elapsedSeconds : 0;
  const events: AutomationEvent[] = [{ kind: 'set', at: 0, value: partialLevelAt(partial, env, elapsed) }];
  if (partial.decayScale > 0) {
    events.push({
      kind: 'target',
      at: elapsed === 0 ? env.attack : 0,
      value: partial.gain * partial.sustain,
      tau: env.decayTau * partial.decayScale,
    });
  }
  return events;
}

export function cutoffFor(timbre: Timbre, midi: number, velocity: number, sampleRate = 44100): number {
  const f = midiToFrequency(clampMidi(midi));
  const v = clampVelocity(velocity);
  const max = Math.min(timbre.cutoffMax, sampleRate * 0.45);
  return clamp(f * (timbre.cutoffMultiple + timbre.cutoffVelocityMultiple * v), Math.min(timbre.cutoffMin, max), max);
}
