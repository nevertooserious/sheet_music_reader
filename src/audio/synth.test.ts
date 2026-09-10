import { describe, expect, it } from 'vitest';
import { FAST_RELEASE_SECONDS, envelopeValueAt, resolveEnvelope, timbreFor } from './envelope';
import { FakeAudioContext, FakeAudioParam, FakeBiquadFilterNode, FakeGainNode, FakeOfflineAudioContext } from './fakeAudioContext';
import { createMasterBus, createTrackBus, startVoice } from './synth';

const ctxFor = (time = 0): FakeAudioContext => {
  const ctx = new FakeAudioContext();
  ctx.currentTime = time;
  return ctx;
};

const asContext = (ctx: FakeAudioContext | FakeOfflineAudioContext): BaseAudioContext => ctx as unknown as BaseAudioContext;
const asNode = (ctx: FakeAudioContext | FakeOfflineAudioContext): AudioNode => ctx.destination as unknown as AudioNode;

function envelopeOf(ctx: FakeAudioContext): FakeAudioParam {
  const params = ctx.envelopeParams();
  expect(params.length).toBe(1);
  return params[0];
}

const piano = resolveEnvelope(timbreFor('piano'), 60, 0.8);

describe('startVoice', () => {
  it('builds oscillator -> partial gain -> envelope -> lowpass -> destination and starts from silence', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 1, durationSeconds: 0.5, instrument: 'piano' });
    expect(voice.startTime).toBe(1);
    expect(voice.endTime).toBeCloseTo(1.5, 9);
    expect(voice.peak).toBeCloseTo(piano.peak, 9);
    expect(ctx.oscillators.length).toBe(timbreFor('piano').partials.length);
    for (const osc of ctx.oscillators) {
      expect(osc.startTime).toBe(1);
      expect(osc.stopTime).toBeGreaterThan(voice.endTime + piano.release * 5);
    }
    expect(ctx.filters[0].type).toBe('lowpass');
    expect(ctx.filters[0].outputs).toEqual([ctx.destination]);
    const env = envelopeOf(ctx);
    expect(env.events[0]).toEqual({ kind: 'set', time: 1, value: 0 });
    expect(env.events[1]).toMatchObject({ kind: 'ramp', value: piano.peak });
    expect(env.valueAt(1)).toBe(0);
    expect(env.valueAt(1 + piano.attack)).toBeCloseTo(piano.peak, 9);
  });

  it('follows the analytic envelope and releases without a step at the note end', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 0.7, instrument: 'piano' });
    const env = envelopeOf(ctx);
    for (const t of [0.05, 0.2, 0.31, 0.5, 0.69]) expect(env.valueAt(t)).toBeCloseTo(envelopeValueAt(piano, t), 6);
    const end = voice.endTime;
    expect(env.valueAt(end - 1e-6)).toBeCloseTo(env.valueAt(end + 1e-6), 5);
    expect(env.valueAt(end + piano.release)).toBeCloseTo(env.valueAt(end) / Math.E, 6);
  });

  it('a voice joining a note already in progress ramps to the decayed level and stays on the analytic curve', () => {
    const ctx = ctxFor();
    const elapsed = 0.6;
    const voice = startVoice(asContext(ctx), asNode(ctx), {
      midi: 60,
      velocity: 0.8,
      startTime: 2,
      durationSeconds: 0.4,
      elapsedSeconds: elapsed,
      instrument: 'piano',
    });
    const env = envelopeOf(ctx);
    expect(env.valueAt(2)).toBe(0);
    const ramp = env.events.find((e) => e.kind === 'ramp');
    expect(ramp?.time).toBeCloseTo(2.008, 9);
    expect(ramp?.value).toBeCloseTo(envelopeValueAt(piano, elapsed + 0.008), 9);
    expect(ramp?.value).toBeLessThan(piano.peak * 0.6);
    for (const dt of [0.01, 0.1, 0.25, 0.39]) expect(env.valueAt(2 + dt)).toBeCloseTo(envelopeValueAt(piano, elapsed + dt), 6);
    const end = voice.endTime;
    expect(env.valueAt(end - 1e-6)).toBeCloseTo(env.valueAt(end + 1e-6), 5);
    const partial = ctx.gains.find((g) => g.outputs.some((o) => o.constructor.name === 'FakeGainNode'))?.gain;
    expect(partial?.events[0].time).toBe(2);
  });

  it('joins within the prompt stage too, handing over to the slow decay at the right moment', () => {
    const ctx = ctxFor();
    const elapsed = 0.1;
    startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 1, elapsedSeconds: elapsed, instrument: 'piano' });
    const env = envelopeOf(ctx);
    const handover = piano.attack + piano.promptSeconds - elapsed;
    expect(env.events.some((e) => e.kind === 'target' && Math.abs(e.time - handover) < 1e-9)).toBe(true);
    for (const dt of [0.02, handover - 0.01, handover + 0.01, 0.8]) expect(env.valueAt(dt)).toBeCloseTo(envelopeValueAt(piano, elapsed + dt), 6);
  });

  it('retime() moves the release later or earlier without a step and re-stops the oscillators', () => {
    for (const newEnd of [1.5, 0.6]) {
      const ctx = ctxFor();
      const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 1, instrument: 'piano' });
      ctx.currentTime = 0.3;
      voice.retime(newEnd);
      expect(voice.endTime).toBeCloseTo(newEnd, 9);
      const env = envelopeOf(ctx);
      const releases = env.events.filter((e) => e.kind === 'target' && e.value === 0);
      expect(releases.length).toBe(1);
      expect(releases[0].time).toBeCloseTo(newEnd, 9);
      expect(env.valueAt(newEnd - 1e-6)).toBeCloseTo(envelopeValueAt(piano, newEnd), 6);
      expect(env.valueAt(newEnd + 1e-6)).toBeCloseTo(env.valueAt(newEnd - 1e-6), 5);
      for (const osc of ctx.oscillators) {
        expect(osc.stopCalls).toBe(2);
        expect(osc.stopTime).toBeCloseTo(voice.stopTime, 9);
      }
    }
  });

  it('retime() is ignored once the note is releasing and never ends a note in the past', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 1, instrument: 'piano' });
    ctx.currentTime = 0.5;
    voice.retime(0.1);
    expect(voice.endTime).toBeCloseTo(0.505, 9);
    ctx.currentTime = 1.2;
    voice.retime(3);
    expect(voice.endTime).toBeCloseTo(0.505, 9);
  });

  it('release() holds the current value then fades with the requested time constant', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 2, instrument: 'piano' });
    ctx.currentTime = 0.4;
    voice.release(0.41, FAST_RELEASE_SECONDS);
    const env = envelopeOf(ctx);
    const hold = env.events.find((e) => e.kind === 'hold');
    expect(hold?.time).toBeCloseTo(0.41, 9);
    expect(hold?.value).toBeCloseTo(envelopeValueAt(piano, 0.41), 6);
    expect(env.events.at(-1)).toMatchObject({ kind: 'target', value: 0, tau: FAST_RELEASE_SECONDS });
    expect(env.valueAt(0.41 + FAST_RELEASE_SECONDS)).toBeCloseTo(envelopeValueAt(piano, 0.41) / Math.E, 6);
    expect(voice.stopTime).toBeCloseTo(0.41 + FAST_RELEASE_SECONDS * 6 + 0.02, 9);
    voice.release(0.5);
    expect(env.events.filter((e) => e.kind === 'hold').length).toBe(1);
  });

  it('choke() cuts a voice even after its natural release has begun', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 67, velocity: 0.8, startTime: 0, durationSeconds: 0.5, instrument: 'strings' });
    ctx.currentTime = 0.55;
    const env = envelopeOf(ctx);
    const before = env.valueAt(0.6);
    voice.choke(0.6);
    expect(env.events.find((e) => e.kind === 'hold')?.value).toBeCloseTo(before, 6);
    expect(env.events.at(-1)).toMatchObject({ kind: 'target', value: 0, tau: FAST_RELEASE_SECONDS });
    expect(env.valueAt(0.6 + 0.2)).toBeLessThan(before * 0.01);
    expect(voice.stopTime).toBeCloseTo(0.6 + FAST_RELEASE_SECONDS * 6 + 0.02, 9);
  });

  it('falls back to analytic values when cancelAndHoldAtTime is unavailable', () => {
    const ctx = ctxFor();
    const voice = startVoice(asContext(ctx), asNode(ctx), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 2, instrument: 'piano' });
    const env = envelopeOf(ctx);
    (env as unknown as { cancelAndHoldAtTime?: unknown }).cancelAndHoldAtTime = undefined;
    ctx.currentTime = 0.4;
    voice.release(0.45);
    const set = env.events.filter((e) => e.kind === 'set').at(-1);
    expect(set?.time).toBeCloseTo(0.45, 9);
    expect(set?.value).toBeCloseTo(envelopeValueAt(piano, 0.45), 6);
  });

  it('cancel() silences and detaches a voice that has not sounded; onEnded fires when the oscillators end', () => {
    const ctx = ctxFor();
    let ended = 0;
    const voice = startVoice(asContext(ctx), asNode(ctx), {
      midi: 60,
      velocity: 0.8,
      startTime: 1,
      durationSeconds: 0.2,
      instrument: 'piano',
      onEnded: () => ended++,
    });
    voice.cancel();
    const envelopeGain = ctx.gains.find((g) => g.gain === ctx.envelopeParams()[0]) ?? ctx.gains.find((g) => g.outputs.length === 0 && g.gain.value === 0);
    expect(envelopeGain?.gain.value).toBe(0);
    ctx.advance(5);
    expect(ended).toBe(1);
    expect(ctx.filters[0].outputs).toEqual([]);
  });

  it('skips partials above the Nyquist guard and scales velocity into level and brightness', () => {
    const low = ctxFor();
    low.sampleRate = 8000;
    startVoice(asContext(low), asNode(low), { midi: 108, velocity: 1, startTime: 0, durationSeconds: 0.2, instrument: 'piano' });
    expect(low.oscillators.length).toBeLessThan(timbreFor('piano').partials.length);
    expect(low.filters[0].frequency.value).toBeLessThanOrEqual(8000 * 0.45);

    const soft = ctxFor();
    const loud = ctxFor();
    const softVoice = startVoice(asContext(soft), asNode(soft), { midi: 60, velocity: 0.2, startTime: 0, durationSeconds: 0.2, instrument: 'piano' });
    const loudVoice = startVoice(asContext(loud), asNode(loud), { midi: 60, velocity: 1, startTime: 0, durationSeconds: 0.2, instrument: 'piano' });
    expect(loudVoice.peak).toBeGreaterThan(softVoice.peak * 2);
    expect(loud.filters[0].frequency.value).toBeGreaterThan(soft.filters[0].frequency.value);
  });

  it('gives piano and strings different partial layouts', () => {
    const a = ctxFor();
    const b = ctxFor();
    startVoice(asContext(a), asNode(a), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 1, instrument: 'piano' });
    startVoice(asContext(b), asNode(b), { midi: 60, velocity: 0.8, startTime: 0, durationSeconds: 1, instrument: 'strings' });
    expect(a.oscillators.map((o) => o.type)).not.toEqual(b.oscillators.map((o) => o.type));
    expect(b.oscillators.map((o) => o.detune.value)).toContain(-6);
  });
});

describe('buses', () => {
  it('master bus: gain -> compressor -> analyser -> destination', () => {
    const ctx = ctxFor();
    const bus = createMasterBus(asContext(ctx), 0.9, true);
    expect(bus.input.gain.value).toBe(0.9);
    expect(ctx.gains[0].outputs[0]).toBe(ctx.compressors[0]);
    expect(ctx.compressors[0].outputs[0]).toBe(ctx.analysers[0]);
    expect(ctx.analysers[0].outputs[0]).toBe(ctx.destination);
    expect(ctx.compressors[0].threshold.value).toBeLessThan(0);
  });

  it('track bus: gain -> meter analyser -> panner -> destination, centred tracks skip the panner', () => {
    const ctx = ctxFor();
    const master = ctx.createGain();
    const bus = createTrackBus(asContext(ctx), master as unknown as AudioNode, 0.7, -0.22, true);
    expect(bus.input.gain.value).toBe(0.7);
    expect(bus.analyser?.fftSize).toBe(256);
    expect(bus.panner?.pan.value).toBe(-0.22);
    expect(ctx.gains[1].outputs[0]).toBe(ctx.analysers[0]);
    expect(ctx.analysers[0].outputs[0]).toBe(ctx.panners[0]);
    expect(ctx.panners[0].outputs[0]).toBe(master);
    bus.disconnect();
    expect(ctx.panners[0].outputs).toEqual([]);

    const centred = createTrackBus(asContext(ctx), master as unknown as AudioNode, 1, 0, false);
    expect(centred.panner).toBeUndefined();
    expect(centred.analyser).toBeUndefined();
    expect((centred.input as unknown as FakeGainNode).outputs[0]).toBe(master);
  });

  it('works on an offline context through the same voice path', () => {
    const offline = new FakeOfflineAudioContext(2, 44100, 44100);
    const bus = createMasterBus(asContext(offline), 0.9);
    const track = createTrackBus(asContext(offline), bus.input as unknown as AudioNode, 0.8, 0.22, false);
    const voice = startVoice(asContext(offline), track.input as unknown as AudioNode, { midi: 60, velocity: 0.8, startTime: 0.25, durationSeconds: 0.5, instrument: 'piano' });
    expect(voice.startTime).toBe(0.25);
    expect(offline.filters[0]).toBeInstanceOf(FakeBiquadFilterNode);
    expect(offline.filters[0].outputs[0]).toBe(track.input);
  });
});
