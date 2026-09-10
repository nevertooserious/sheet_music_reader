import { describe, expect, it } from 'vitest';
import {
  CHASE_ATTACK_SECONDS,
  ENVELOPE_LIMITS,
  clampMidi,
  clampVelocity,
  cutoffFor,
  envelopeAutomation,
  envelopeValueAt,
  partialAutomation,
  partialLevelAt,
  promptEndLevel,
  resolveEnvelope,
  timbreByName,
  timbreFor,
  velocityToPeak,
} from './envelope';
import { FakeAudioParam } from './fakeAudioContext';

const piano = timbreByName('piano');

describe('resolveEnvelope', () => {
  it('stays inside the limits for extreme inputs', () => {
    for (const midi of [-10, 0, 60, 127, 500, Number.NaN]) {
      for (const velocity of [-1, 0, 0.5, 1, 7, Number.NaN]) {
        const env = resolveEnvelope(piano, midi, velocity);
        expect(env.attack).toBeGreaterThanOrEqual(ENVELOPE_LIMITS.attackMin);
        expect(env.attack).toBeLessThanOrEqual(ENVELOPE_LIMITS.attackMax);
        expect(env.decayTau).toBeGreaterThanOrEqual(ENVELOPE_LIMITS.decayMin);
        expect(env.decayTau).toBeLessThanOrEqual(ENVELOPE_LIMITS.decayMax);
        expect(env.release).toBeGreaterThanOrEqual(ENVELOPE_LIMITS.releaseMin);
        expect(env.release).toBeLessThanOrEqual(ENVELOPE_LIMITS.releaseMax);
        expect(env.peak).toBeGreaterThanOrEqual(0);
        expect(env.peak).toBeLessThanOrEqual(ENVELOPE_LIMITS.peakMax);
        expect(env.sustainLevel).toBeLessThanOrEqual(env.peak);
      }
    }
  });

  it('is louder and snappier for harder velocities', () => {
    const soft = resolveEnvelope(piano, 60, 0.2);
    const hard = resolveEnvelope(piano, 60, 1);
    expect(hard.peak).toBeGreaterThan(soft.peak);
    expect(hard.attack).toBeLessThan(soft.attack);
  });

  it('lets low notes ring longer than high notes', () => {
    expect(resolveEnvelope(piano, 36, 0.8).decayTau).toBeGreaterThan(resolveEnvelope(piano, 84, 0.8).decayTau);
  });

  it('velocity 0 is silent', () => {
    expect(velocityToPeak(0)).toBe(0);
    expect(resolveEnvelope(piano, 60, 0).peak).toBe(0);
  });
});

describe('envelopeValueAt', () => {
  const env = resolveEnvelope(piano, 60, 0.8);

  it('is zero before the note and continuous through attack and decay', () => {
    expect(envelopeValueAt(env, -1)).toBe(0);
    expect(envelopeValueAt(env, 0)).toBe(0);
    expect(envelopeValueAt(env, env.attack / 2)).toBeCloseTo(env.peak / 2);
    expect(envelopeValueAt(env, env.attack)).toBeCloseTo(env.peak, 9);
    expect(envelopeValueAt(env, env.attack + 1e-9)).toBeCloseTo(env.peak, 6);
  });

  it('decays monotonically towards the sustain level', () => {
    let previous = envelopeValueAt(env, env.attack);
    for (let t = env.attack + 0.01; t < 5; t += 0.05) {
      const v = envelopeValueAt(env, t);
      expect(v).toBeLessThanOrEqual(previous + 1e-12);
      expect(v).toBeGreaterThanOrEqual(env.sustainLevel - 1e-12);
      previous = v;
    }
    expect(envelopeValueAt(env, 1000)).toBeCloseTo(env.sustainLevel, 9);
  });

  it('is continuous where the prompt decay hands over to the slow decay', () => {
    const handover = env.attack + env.promptSeconds;
    expect(env.promptSeconds).toBeGreaterThan(0);
    expect(envelopeValueAt(env, handover - 1e-9)).toBeCloseTo(promptEndLevel(env), 6);
    expect(envelopeValueAt(env, handover + 1e-9)).toBeCloseTo(promptEndLevel(env), 6);
  });

  it('articulates: a piano quarter note at 120 bpm has fallen below half its peak', () => {
    expect(envelopeValueAt(env, 0.5)).toBeLessThan(env.peak * 0.5);
    expect(envelopeValueAt(env, 0.25)).toBeLessThan(env.peak * 0.6);
  });

  it('sustained timbres skip the prompt stage and hold near the sustain level', () => {
    const strings = resolveEnvelope(timbreFor('strings'), 60, 0.8);
    expect(strings.promptSeconds).toBe(0);
    expect(promptEndLevel(strings)).toBe(strings.peak);
    expect(envelopeValueAt(strings, 3)).toBeCloseTo(strings.sustainLevel, 3);
    expect(envelopeValueAt(strings, 0.5)).toBeGreaterThan(strings.peak * 0.7);
  });

  it('releases exponentially from the value at release time', () => {
    const releaseAt = 0.5;
    const atRelease = envelopeValueAt(env, releaseAt);
    expect(envelopeValueAt(env, releaseAt, releaseAt)).toBeCloseTo(atRelease, 9);
    expect(envelopeValueAt(env, releaseAt + env.release, releaseAt)).toBeCloseTo(atRelease / Math.E, 9);
    expect(envelopeValueAt(env, releaseAt + 6 * env.release, releaseAt)).toBeLessThan(atRelease * 0.003);
  });
});

describe('timbres', () => {
  it('maps every instrument hint and gives piano and strings distinct sounds', () => {
    const pianoTimbre = timbreFor('piano');
    const strings = timbreFor('strings');
    expect(pianoTimbre.name).toBe('piano');
    expect(strings.name).toBe('sustained');
    expect(strings.attack).toBeGreaterThan(pianoTimbre.attack);
    expect(strings.sustain).toBeGreaterThan(pianoTimbre.sustain);
    expect(strings.partials.map((p) => p.type)).not.toEqual(pianoTimbre.partials.map((p) => p.type));
    for (const instrument of ['woodwind', 'brass', 'voice', 'other'] as const) expect(timbreFor(instrument).name).toBe('sustained');
    expect(timbreFor('guitar').name).toBe('plucked');
    expect(timbreFor('organ').name).toBe('organ');
    expect(timbreFor(undefined).name).toBe('piano');
  });

  it('partials sum to a bounded amplitude so voices cannot clip on their own', () => {
    for (const name of ['piano', 'plucked', 'sustained', 'organ'] as const) {
      const total = timbreByName(name).partials.reduce((sum, p) => sum + p.gain, 0);
      expect(total).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('filter cutoff', () => {
  it('tracks pitch and opens with velocity, within bounds', () => {
    const low = cutoffFor(piano, 40, 0.5);
    const high = cutoffFor(piano, 80, 0.5);
    expect(high).toBeGreaterThan(low);
    expect(cutoffFor(piano, 60, 1)).toBeGreaterThan(cutoffFor(piano, 60, 0.1));
    expect(cutoffFor(piano, 0, 0)).toBeGreaterThanOrEqual(piano.cutoffMin);
    expect(cutoffFor(piano, 127, 1)).toBeLessThanOrEqual(piano.cutoffMax);
  });

  it('never exceeds the Nyquist guard of a low sample rate', () => {
    expect(cutoffFor(piano, 100, 1, 8000)).toBeLessThanOrEqual(8000 * 0.45);
  });
});

describe('input clamps', () => {
  it('sanitise velocity and midi', () => {
    expect(clampVelocity(-2)).toBe(0);
    expect(clampVelocity(2)).toBe(1);
    expect(clampVelocity(Number.NaN)).toBe(0.8);
    expect(clampMidi(-5)).toBe(0);
    expect(clampMidi(200)).toBe(127);
    expect(clampMidi(60.4)).toBe(60);
    expect(clampMidi(Number.NaN)).toBe(60);
  });
});

describe('envelopeAutomation', () => {
  const evaluate = (events: ReturnType<typeof envelopeAutomation>['events'], t: number): number => {
    const param = new FakeAudioParam(0);
    for (const e of events) {
      if (e.kind === 'set') param.setValueAtTime(e.value, e.at);
      else if (e.kind === 'ramp') param.linearRampToValueAtTime(e.value, e.at);
      else param.setTargetAtTime(e.value, e.at, e.tau);
    }
    return param.valueAt(t);
  };

  it('a fresh note starts at zero, ramps to the peak and then tracks envelopeValueAt', () => {
    const env = resolveEnvelope(piano, 60, 0.8);
    const auto = envelopeAutomation(env, 0);
    expect(auto.elapsedSeconds).toBe(0);
    expect(auto.attackSeconds).toBe(env.attack);
    expect(auto.events[0]).toEqual({ kind: 'set', at: 0, value: 0 });
    for (const t of [env.attack, 0.1, 0.3, env.attack + env.promptSeconds, 1, 3]) expect(evaluate(auto.events, t)).toBeCloseTo(envelopeValueAt(env, t), 6);
  });

  it('a joined note ramps briefly to the current level and then matches envelopeValueAt(elapsed + t)', () => {
    const env = resolveEnvelope(piano, 60, 0.8);
    for (const elapsed of [0.05, 0.2, 0.5, 2]) {
      const auto = envelopeAutomation(env, elapsed);
      expect(auto.elapsedSeconds).toBe(elapsed);
      expect(auto.attackSeconds).toBe(CHASE_ATTACK_SECONDS);
      expect(evaluate(auto.events, 0)).toBe(0);
      for (const t of [CHASE_ATTACK_SECONDS, 0.05, 0.2, 0.5, 1.5]) expect(evaluate(auto.events, t)).toBeCloseTo(envelopeValueAt(env, elapsed + t), 6);
    }
  });

  it('treats an elapsed time inside the attack, or garbage, as a fresh note', () => {
    const env = resolveEnvelope(piano, 60, 0.8);
    expect(envelopeAutomation(env, env.attack / 2).elapsedSeconds).toBe(0);
    expect(envelopeAutomation(env, Number.NaN).elapsedSeconds).toBe(0);
    expect(envelopeAutomation(env, -1).elapsedSeconds).toBe(0);
  });

  it('partials follow their own decay from the elapsed point', () => {
    const env = resolveEnvelope(piano, 60, 0.8);
    const partial = piano.partials[1];
    for (const elapsed of [0, 0.4]) {
      const events = partialAutomation(partial, env, elapsed);
      for (const t of [0, 0.1, 0.5, 2]) expect(evaluate(events, t)).toBeCloseTo(partialLevelAt(partial, env, elapsed + t), 6);
    }
    const flat = partialAutomation(timbreByName('organ').partials[0], env, 1);
    expect(flat).toEqual([{ kind: 'set', at: 0, value: timbreByName('organ').partials[0].gain }]);
  });
});
