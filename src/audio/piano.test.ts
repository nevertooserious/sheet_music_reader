import { describe, expect, it } from 'vitest';
import { CHASE_ATTACK_SECONDS, FAST_RELEASE_SECONDS, velocityToPeak } from './envelope';
import { FakeAudioBuffer, FakeAudioContext, type FakeAudioParam } from './fakeAudioContext';
import {
  MIN_USABLE_SAMPLES,
  PIANO_SAMPLE_GAIN,
  PIANO_SAMPLE_MIDIS,
  type PianoSampleSet,
  cutoffForVelocity,
  loadPianoSamples,
  nearestSampleMidi,
  playbackRateFor,
  sampleFileName,
  startSampledVoice,
} from './piano';

const asContext = (ctx: FakeAudioContext): BaseAudioContext => ctx as unknown as BaseAudioContext;
const asNode = (ctx: FakeAudioContext): AudioNode => ctx.destination as unknown as AudioNode;
const buffer = (seconds = 4): AudioBuffer => new FakeAudioBuffer(2, Math.round(44100 * seconds), 44100) as unknown as AudioBuffer;
const fullSet = (): PianoSampleSet => ({ buffers: new Map(PIANO_SAMPLE_MIDIS.map((m) => [m, buffer()])) });
const envelopeOf = (ctx: FakeAudioContext): FakeAudioParam => {
  const params = ctx.envelopeParams();
  expect(params.length).toBe(1);
  return params[0];
};
const peak = velocityToPeak(0.8);
/** What the envelope actually reaches: the velocity peak lifted by the make-up gain. */
const level = peak * PIANO_SAMPLE_GAIN;
const request = (midi: number, startTime: number, durationSeconds: number, extra: Partial<Parameters<typeof startSampledVoice>[2]> = {}) => ({
  midi,
  velocity: 0.8,
  startTime,
  durationSeconds,
  instrument: 'piano' as const,
  ...extra,
});

describe('sample layout', () => {
  it('names the files the way the Salamander set does', () => {
    expect(PIANO_SAMPLE_MIDIS.length).toBe(30);
    expect(sampleFileName(21)).toBe('A0.mp3');
    expect(sampleFileName(27)).toBe('Ds1.mp3');
    expect(sampleFileName(30)).toBe('Fs1.mp3');
    expect(sampleFileName(108)).toBe('C8.mp3');
  });

  it('picks the nearest recording, the lower one on a tie', () => {
    expect(nearestSampleMidi(PIANO_SAMPLE_MIDIS, 22)).toBe(21);
    expect(nearestSampleMidi(PIANO_SAMPLE_MIDIS, 25)).toBe(24);
    expect(nearestSampleMidi(PIANO_SAMPLE_MIDIS, 26)).toBe(27);
    expect(nearestSampleMidi(PIANO_SAMPLE_MIDIS, 0)).toBe(21);
    expect(nearestSampleMidi(PIANO_SAMPLE_MIDIS, 127)).toBe(108);
    expect(nearestSampleMidi([60, 64], 62)).toBe(60);
    expect(nearestSampleMidi([], 60)).toBeUndefined();
  });

  it('pitch-shifts by semitone ratio', () => {
    expect(playbackRateFor(60, 60)).toBe(1);
    expect(playbackRateFor(60, 72)).toBe(2);
    expect(playbackRateFor(60, 59)).toBeCloseTo(0.9439, 4);
  });

  it('opens the lowpass with velocity, never above the Nyquist guard', () => {
    expect(cutoffForVelocity(0.2, 44100)).toBeLessThan(cutoffForVelocity(0.8, 44100));
    expect(cutoffForVelocity(1, 22050)).toBe(22050 * 0.45);
  });
});

describe('loadPianoSamples', () => {
  const fetchOk = (failing: Set<string> = new Set(), throwing = false): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      if (throwing) throw new Error('network');
      const name = String(input).split('/').pop() ?? '';
      return { ok: !failing.has(name), arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    }) as typeof fetch;
  const decode = async (): Promise<AudioBuffer> => buffer(1);
  const baseUrl = 'http://localhost/samples/piano/';

  it('loads every file and keys the buffers by midi', async () => {
    const set = await loadPianoSamples({ baseUrl, fetchFn: fetchOk(), decode });
    expect(set?.buffers.size).toBe(30);
    expect(set?.buffers.has(60)).toBe(true);
  });

  it('skips files that fail and still returns a set above the threshold', async () => {
    const set = await loadPianoSamples({ baseUrl, fetchFn: fetchOk(new Set(['A0.mp3', 'C8.mp3'])), decode });
    expect(set?.buffers.size).toBe(28);
    expect(set?.buffers.has(21)).toBe(false);
  });

  it('is undefined below the threshold and never rejects', async () => {
    const failing = new Set(PIANO_SAMPLE_MIDIS.slice(0, 30 - MIN_USABLE_SAMPLES + 1).map(sampleFileName));
    expect(await loadPianoSamples({ baseUrl, fetchFn: fetchOk(failing), decode })).toBeUndefined();
    expect(await loadPianoSamples({ baseUrl, fetchFn: fetchOk(new Set(), true), decode })).toBeUndefined();
    const rejecting = async (): Promise<AudioBuffer> => {
      throw new Error('bad mp3');
    };
    expect(await loadPianoSamples({ baseUrl, fetchFn: fetchOk(), decode: rejecting })).toBeUndefined();
  });
});

describe('startSampledVoice', () => {
  it('routes recording -> envelope -> lowpass -> destination, pitch-shifted from the nearest sample', () => {
    const ctx = new FakeAudioContext();
    const set = fullSet();
    const voice = startSampledVoice(asContext(ctx), asNode(ctx), request(62, 1, 0.5), set);
    expect(ctx.oscillators.length).toBe(0);
    expect(ctx.sources.length).toBe(1);
    const source = ctx.sources[0];
    expect(source.buffer).toBe(set.buffers.get(63));
    expect(source.playbackRate.value).toBeCloseTo(playbackRateFor(63, 62), 9);
    expect(source.startTime).toBe(1);
    expect(source.offset).toBe(0);
    expect(source.stopTime).toBeGreaterThan(voice.endTime + 0.5);
    expect(ctx.filters[0].type).toBe('lowpass');
    expect(ctx.filters[0].frequency.value).toBeCloseTo(cutoffForVelocity(0.8, 44100), 6);
    expect(ctx.filters[0].outputs).toEqual([ctx.destination]);
    expect(voice.peak).toBeCloseTo(peak, 9);
    expect(voice.peak).toBeLessThanOrEqual(1);
    const env = envelopeOf(ctx);
    expect(env.valueAt(1)).toBe(0);
    expect(env.valueAt(1.003)).toBeCloseTo(level, 9);
    expect(env.valueAt(1.4)).toBeCloseTo(level, 9);
    const end = voice.endTime;
    expect(end).toBeCloseTo(1.5, 9);
    expect(env.valueAt(end - 1e-6)).toBeCloseTo(env.valueAt(end + 1e-6), 4);
    expect(env.valueAt(end + 0.1)).toBeCloseTo(level / Math.E, 6);
  });

  it('softer notes are quieter and darker', () => {
    const ctx = new FakeAudioContext();
    const set = fullSet();
    const loud = startSampledVoice(asContext(ctx), asNode(ctx), request(60, 0, 1, { velocity: 0.9 }), set);
    const soft = startSampledVoice(asContext(ctx), asNode(ctx), request(60, 0, 1, { velocity: 0.3 }), set);
    expect(soft.peak).toBeLessThan(loud.peak);
    expect(ctx.filters[1].frequency.value).toBeLessThan(ctx.filters[0].frequency.value);
  });

  it('joins a note already in progress from the matching point in the recording, without re-striking', () => {
    const ctx = new FakeAudioContext();
    startSampledVoice(asContext(ctx), asNode(ctx), request(65, 2, 0.4, { elapsedSeconds: 0.6 }), fullSet());
    expect(ctx.sources[0].offset).toBeCloseTo(0.6 * playbackRateFor(66, 65), 9);
    const env = envelopeOf(ctx);
    expect(env.valueAt(2)).toBe(0);
    expect(env.valueAt(2 + CHASE_ATTACK_SECONDS / 2)).toBeCloseTo(level / 2, 6);
    expect(env.valueAt(2 + CHASE_ATTACK_SECONDS)).toBeCloseTo(level, 9);
  });

  it('caps the start offset inside the recording', () => {
    const ctx = new FakeAudioContext();
    startSampledVoice(asContext(ctx), asNode(ctx), request(60, 0, 1, { elapsedSeconds: 30 }), fullSet());
    expect(ctx.sources[0].offset).toBeLessThanOrEqual(4 - 0.05 + 1e-9);
  });

  it('choke fades fast, retime moves the release, cancel silences a pending voice and stops its source', () => {
    const ctx = new FakeAudioContext();
    const set = fullSet();
    const a = startSampledVoice(asContext(ctx), asNode(ctx), request(60, 0, 2), set);
    a.choke(0.5);
    expect(a.stopTime).toBeLessThan(0.5 + FAST_RELEASE_SECONDS * 6 + 0.03);
    expect(ctx.sources[0].stopTime).toBe(a.stopTime);
    expect(ctx.envelopeParams()[0].valueAt(0.5 + FAST_RELEASE_SECONDS)).toBeCloseTo(level / Math.E, 5);

    const b = startSampledVoice(asContext(ctx), asNode(ctx), request(60, 0, 2), set);
    b.retime(1);
    expect(b.endTime).toBe(1);
    const envB = ctx.envelopeParams()[1];
    expect(envB.valueAt(0.99)).toBeCloseTo(level, 9);
    expect(envB.valueAt(1.1)).toBeCloseTo(level / Math.E, 5);
    expect(ctx.sources[1].stopTime).toBeCloseTo(1 + 0.1 * 6 + 0.02, 9);

    ctx.currentTime = 0.2;
    let ended = 0;
    const c = startSampledVoice(asContext(ctx), asNode(ctx), request(60, 1, 1, { onEnded: () => ended++ }), set);
    c.cancel();
    expect(ctx.sources[2].stopTime).toBe(1);
    expect(ctx.gains[2].outputs).toEqual([]);
    ctx.advance(1);
    expect(ended).toBe(1);
  });
});
