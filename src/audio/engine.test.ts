import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoScore } from '../core/demoScore';
import type { NoteEvent, ScoreModel, Track } from '../core/types';
import { qnToSeconds } from '../core/types';
import { type EngineOptions, RESUME_TIMEOUT_MS, createAudioEngine, resumeContext } from './engine';
import { FAST_RELEASE_SECONDS, RETRIGGER_LEAD_SECONDS, timbreFor, velocityToPeak } from './envelope';
import { FakeAudioBuffer, FakeAudioContext, FakeOfflineAudioContext } from './fakeAudioContext';
import { PAN_SPREAD } from './mix';
import { PIANO_SAMPLE_MIDIS, type PianoSampleSet } from './piano';
import { SCHEDULER } from './scheduler';

interface Harness {
  engine: ReturnType<typeof createAudioEngine>;
  fake: FakeAudioContext;
  offlines: FakeOfflineAudioContext[];
  setHidden(hidden: boolean): void;
}

function harness(extra: Pick<EngineOptions, 'samples'> = {}): Harness {
  const fake = new FakeAudioContext();
  const offlines: FakeOfflineAudioContext[] = [];
  let hidden = false;
  const engine = createAudioEngine({
    ...extra,
    createContext: () => fake as unknown as AudioContext,
    createOfflineContext: (channels, length, sampleRate) => {
      const offline = new FakeOfflineAudioContext(channels, length, sampleRate);
      offlines.push(offline);
      return offline as unknown as OfflineAudioContext;
    },
    isHidden: () => hidden,
  });
  return {
    engine,
    fake,
    offlines,
    setHidden: (h) => {
      hidden = h;
    },
  };
}

/** Advances the fake audio clock and the (faked) timers together, in scheduler-tick-sized steps. */
async function run(fake: FakeAudioContext, ms: number, stepMs: number = SCHEDULER.tickMs): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    fake.advance(stepMs / 1000);
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

const noteKey = (n: { trackId: string; midi: number; qn: number }): string => `${n.trackId}:${n.midi}:${n.qn.toFixed(3)}`;

type TrackSpec = Omit<Partial<Track>, 'notes'> & { notes: Array<[midi: number, startQn: number, durationQn: number]> };

function scoreWith(tracks: TrackSpec[], tempoBpm = 120): ScoreModel {
  const base = createDemoScore();
  let durationQn = 0;
  const built: Track[] = tracks.map((t, i) => {
    const id = t.id ?? `t${i + 1}`;
    const notes: NoteEvent[] = t.notes.map(([midi, startQn, dur], n) => {
      durationQn = Math.max(durationQn, startQn + dur);
      return { id: `${id}-${n}`, trackId: id, midi, startQn, durationQn: dur, velocity: 0.8, measure: 0 };
    });
    return { id, name: t.name ?? id, instrument: t.instrument ?? 'piano', clef: 'treble', staffIndex: t.staffIndex ?? i, defaultGain: 0.8, notes };
  });
  return { ...base, tempoBpm, tracks: built, durationQn: Math.ceil(durationQn), measures: [], timeline: [] };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('play', () => {
  it('creates the context lazily, resumes it and puts the opening notes on the tempo grid', async () => {
    const { engine, fake } = harness();
    const score = createDemoScore();
    engine.load(score);
    expect(engine.getState()).toMatchObject({ playing: false, positionQn: 0, tempoBpm: 108, contextState: 'none' });
    expect(engine.getState().tracks.map((t) => t.gain)).toEqual([0.8, 0.7]);

    await engine.play();
    expect(fake.resumeCalls).toBe(1);
    expect(engine.getState()).toMatchObject({ playing: true, contextState: 'running' });
    const opening = engine.getScheduledLog();
    expect(opening.map((n) => n.midi).sort((a, b) => a - b)).toEqual([55, 59, 62, 74]);
    for (const n of opening) {
      expect(n.qn).toBe(0);
      expect(n.time).toBeCloseTo(SCHEDULER.startLatencySeconds, 6);
    }
    expect(opening.find((n) => n.midi === 74)?.durationSeconds).toBeCloseTo(qnToSeconds(1, 108), 6);

    await run(fake, 1000);
    const state = engine.getState();
    expect(state.positionQn).toBeCloseTo((1 - SCHEDULER.startLatencySeconds) * (108 / 60), 2);
    for (const n of engine.getScheduledLog()) expect(n.time - SCHEDULER.startLatencySeconds).toBeCloseTo(qnToSeconds(n.qn, 108), 6);
    expect(fake.panners.map((p) => p.pan.value)).toEqual([PAN_SPREAD, -PAN_SPREAD]);
  });

  it('is a no-op without a score or with an empty score, and tolerates zero-note tracks', async () => {
    const { engine, fake } = harness();
    await engine.play();
    expect(engine.getState().contextState).toBe('none');
    engine.load({ ...createDemoScore(), tracks: [], durationQn: 0 });
    await engine.play();
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'none' });

    engine.load(scoreWith([{ notes: [] }, { notes: [[60, 0, 1]] }]));
    await engine.play();
    await run(fake, 200);
    expect(engine.getState().playing).toBe(true);
    expect(engine.getScheduledLog().map((n) => n.trackId)).toEqual(['t2']);
  });

  it('notifies subscribers on setters and on every frame while playing', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    const seen: number[] = [];
    const unsubscribe = engine.subscribe((s) => seen.push(s.positionQn));
    engine.setTempo(120);
    engine.setMasterGain(0.5);
    expect(seen.length).toBe(2);
    await engine.play();
    const before = seen.length;
    await run(fake, 500);
    expect(seen.length - before).toBeGreaterThanOrEqual(20);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[before]);
    unsubscribe();
    const after = seen.length;
    await run(fake, 100);
    expect(seen.length).toBe(after);
  });
});

describe('resume failures', () => {
  it('a resume() that never settles leaves the transport paused, and play() retries later', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    fake.resumeMode = 'hang';
    const first = engine.play();
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 20);
    await first;
    expect(fake.resumeCalls).toBe(1);
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'suspended', positionQn: 0 });
    expect(engine.getScheduledLog()).toEqual([]);

    const second = engine.play();
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 20);
    await second;
    expect(fake.resumeCalls).toBe(2);
    expect(engine.getState().playing).toBe(false);

    fake.resumeMode = 'resolve';
    await engine.play();
    expect(fake.resumeCalls).toBe(3);
    expect(engine.getState()).toMatchObject({ playing: true, contextState: 'running' });
    expect(engine.getScheduledLog().length).toBeGreaterThan(0);
  });

  it('a rejected resume() reports paused and a later external resume lets play() start without a new resume call', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    fake.resumeMode = 'reject';
    await engine.play();
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'suspended' });

    fake.setState('running');
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'running' });
    await engine.play();
    expect(fake.resumeCalls).toBe(1);
    expect(engine.getState().playing).toBe(true);
  });

  it('an external suspension while playing pauses at the frozen position instead of reporting a dead "playing"', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTempo(120);
    await engine.play();
    await run(fake, 500);
    const frozen = engine.getState().positionQn;
    expect(frozen).toBeGreaterThan(0.5);

    fake.setState('suspended');
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'suspended' });
    expect(engine.getState().positionQn).toBeCloseTo(frozen, 6);
    await vi.advanceTimersByTimeAsync(300);
    expect(engine.getState().positionQn).toBeCloseTo(frozen, 6);

    engine.clearScheduledLog();
    await engine.play();
    expect(engine.getState()).toMatchObject({ playing: true, contextState: 'running' });
    expect(engine.getState().positionQn).toBeCloseTo(frozen, 3);
    await run(fake, 300);
    const notes = createDemoScore().tracks.flatMap((t) => t.notes);
    for (const n of engine.getScheduledLog()) {
      const source = notes.find((s) => s.trackId === n.trackId && s.midi === n.midi && s.startQn === n.qn);
      const spansResumePoint = !!source && source.startQn < frozen && source.startQn + source.durationQn > frozen;
      expect(n.qn >= frozen - 0.01 || spansResumePoint).toBe(true);
    }
  });

  it('resumeContext resolves false at the timeout and true as soon as the state flips', async () => {
    const hanging = new FakeAudioContext();
    hanging.resumeMode = 'hang';
    const slow = resumeContext(hanging as unknown as AudioContext, 200);
    await vi.advanceTimersByTimeAsync(210);
    expect(await slow).toBe(false);

    const eventually = new FakeAudioContext();
    eventually.resumeMode = 'hang';
    const p = resumeContext(eventually as unknown as AudioContext, 1000);
    eventually.setState('running');
    expect(await p).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('held notes', () => {
  it('seeking while paused into a held chord starts it for the remaining duration, joined mid-envelope', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.seek(0.5);
    expect(engine.getState().positionQn).toBe(0.5);
    await engine.play();
    const log = engine.getScheduledLog();
    expect(log.map((n) => n.midi).sort((a, b) => a - b)).toEqual([55, 59, 62, 74]);
    for (const n of log) {
      expect(n.qn).toBe(0);
      expect(n.time).toBeCloseTo(SCHEDULER.startLatencySeconds, 6);
    }
    expect(log.find((n) => n.midi === 55)?.durationSeconds).toBeCloseTo(qnToSeconds(1.5, 108), 6);
    expect(log.find((n) => n.midi === 74)?.durationSeconds).toBeCloseTo(qnToSeconds(0.5, 108), 6);
    // Joined voices ramp to the level the note has already decayed to, not to a fresh peak.
    for (const param of fake.envelopeParams()) {
      const ramp = param.events.find((e) => e.kind === 'ramp');
      expect(ramp?.value).toBeLessThan(log[0].gain * 0.95);
    }
    await run(fake, 400);
    expect(engine.getScheduledLog().filter((n) => n.qn === 1).map((n) => n.midi)).toEqual([67]);
  });

  it('seeking while playing keeps a voice that still spans the target, retimes its end and releases the rest', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTempo(60);
    await engine.play();
    await run(fake, 200);
    expect(engine.getVoiceCount()).toBe(4);
    const now = fake.currentTime;

    engine.seek(1.5);
    expect(engine.getState().positionQn).toBeCloseTo(1.5, 6);
    const chordEnd = now + SCHEDULER.seekLatencySeconds + qnToSeconds(0.5, 60);
    const chord = engine.getScheduledLog().filter((n) => n.trackId === 'track-2' && n.qn === 0);
    expect(chord.length).toBe(3);
    for (const n of chord) expect(n.durationSeconds).toBeCloseTo(chordEnd - SCHEDULER.startLatencySeconds, 6);
    const melody = engine.getScheduledLog().filter((n) => n.trackId === 'track-1');
    expect(melody.map((n) => n.qn)).toEqual([0, 1.5]);
    expect(engine.getVoiceCount()).toBe(4);
    const heldParams = fake.envelopeParams().filter((p) => p.events.some((e) => e.kind === 'hold'));
    expect(heldParams.length).toBe(1);
    expect(heldParams[0].events.at(-1)).toMatchObject({ kind: 'target', value: 0, tau: FAST_RELEASE_SECONDS });
  });

  it('renderOffline starting inside a held note includes it and honours trackIds and mute', async () => {
    const { engine, offlines } = harness();
    engine.load(createDemoScore());
    const buffer = await engine.renderOffline({ fromQn: 1, toQn: 2, tempoBpm: 120, sampleRate: 22050 });
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.duration).toBeCloseTo(0.5 + 0.35, 3);
    expect(offlines[0].filters.length).toBe(5);
    expect(offlines[0].oscillators.filter((o) => o.startTime === 0).length).toBe(16);
    expect(offlines[0].panners.map((p) => p.pan.value)).toEqual([PAN_SPREAD, -PAN_SPREAD]);

    await engine.renderOffline({ fromQn: 1, toQn: 2, tempoBpm: 120, sampleRate: 22050, trackIds: ['track-1'] });
    expect(offlines[1].filters.length).toBe(2);

    engine.setTrackMuted('track-2', true);
    await engine.renderOffline({ fromQn: 1, toQn: 2, tempoBpm: 120, sampleRate: 22050 });
    expect(offlines[2].filters.length).toBe(2);
    await engine.renderOffline({ fromQn: 1, toQn: 2, tempoBpm: 120, sampleRate: 22050, trackIds: ['track-2'] });
    expect(offlines[3].filters.length).toBe(3);

    await expect(engine.renderOffline({ fromQn: 2, toQn: 1, tempoBpm: 120 })).rejects.toThrow();
  });
});

describe('tempo', () => {
  it('re-times sounding notes and re-schedules pending ones with no duplicates', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTempo(60);
    await engine.play();
    await run(fake, 100);
    const now = fake.currentTime;
    const positionBefore = engine.getState().positionQn;

    engine.setTempo(300);
    expect(engine.getState().tempoBpm).toBe(300);
    expect(engine.getState().positionQn).toBeCloseTo(positionBefore, 6);
    const chordEnd = now + qnToSeconds(2 - positionBefore, 300);
    const melodyEnd = now + qnToSeconds(1 - positionBefore, 300);
    const log = engine.getScheduledLog();
    expect(log.find((n) => n.midi === 55)?.durationSeconds).toBeCloseTo(chordEnd - SCHEDULER.startLatencySeconds, 6);
    expect(log.find((n) => n.midi === 74)?.durationSeconds).toBeCloseTo(melodyEnd - SCHEDULER.startLatencySeconds, 6);
    const [melodyParam, chordParam] = fake.envelopeParams();
    const releaseOf = (param: typeof melodyParam): number[] => param.events.filter((e) => e.kind === 'target' && e.value === 0).map((e) => e.time);
    expect(releaseOf(melodyParam)).toHaveLength(1);
    expect(releaseOf(melodyParam)[0]).toBeCloseTo(melodyEnd, 6);
    expect(releaseOf(chordParam)).toHaveLength(1);
    expect(releaseOf(chordParam)[0]).toBeCloseTo(chordEnd, 6);

    await run(fake, 2500);
    const keys = engine.getScheduledLog().map(noteKey);
    expect(new Set(keys).size).toBe(keys.length);
    const expected = createDemoScore()
      .tracks.flatMap((t) => t.notes)
      .filter((n) => n.startQn < engine.getState().positionQn - 0.5)
      .map((n) => noteKey({ trackId: n.trackId, midi: n.midi, qn: n.startQn }));
    for (const key of expected) expect(keys).toContain(key);
  });

  it('clamps and ignores garbage', () => {
    const { engine } = harness();
    engine.load(createDemoScore());
    engine.setTempo(1000);
    expect(engine.getState().tempoBpm).toBe(300);
    engine.setTempo(Number.NaN);
    expect(engine.getState().tempoBpm).toBe(300);
    engine.setTempo(-4);
    expect(engine.getState().tempoBpm).toBe(20);
  });
});

describe('end of score, pause and stop', () => {
  it('stops at durationQn with every note scheduled exactly once, then restarts from 0', async () => {
    const { engine, fake } = harness();
    const score = createDemoScore();
    engine.load(score);
    engine.setTempo(300);
    await engine.play();
    await run(fake, 10_000);
    expect(engine.getState()).toMatchObject({ playing: false, positionQn: score.durationQn });
    const keys = engine.getScheduledLog().map(noteKey);
    expect(keys.length).toBe(score.tracks.reduce((n, t) => n + t.notes.length, 0));
    expect(new Set(keys).size).toBe(keys.length);
    expect(engine.getVoiceCount()).toBe(0);

    engine.clearScheduledLog();
    await engine.play();
    expect(engine.getState().playing).toBe(true);
    expect(engine.getState().positionQn).toBeCloseTo(0, 6);
    expect(engine.getScheduledLog()[0].qn).toBe(0);
  });

  it('pause freezes the position and fast-releases sounding voices; stop rewinds', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTempo(120);
    await engine.play();
    await run(fake, 400);
    engine.pause();
    const paused = engine.getState();
    expect(paused.playing).toBe(false);
    expect(paused.positionQn).toBeCloseTo((0.4 - SCHEDULER.startLatencySeconds) * 2, 3);
    await run(fake, 300);
    expect(engine.getState().positionQn).toBeCloseTo(paused.positionQn, 9);
    expect(engine.getVoiceCount()).toBe(0);
    const sounding = fake.envelopeParams().filter((p) => p.events.length > 0);
    expect(sounding.length).toBe(4);
    for (const param of sounding) expect(param.events.at(-1)).toMatchObject({ kind: 'target', value: 0, tau: FAST_RELEASE_SECONDS });

    engine.stop();
    expect(engine.getState()).toMatchObject({ playing: false, positionQn: 0 });
  });

  it('a pending note cancelled by pause never sounded and leaves the log', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTempo(120);
    await engine.play();
    await run(fake, 400);
    const pending = engine.getScheduledLog().filter((n) => n.time > fake.currentTime + SCHEDULER.minLeadSeconds);
    expect(pending.length).toBeGreaterThan(0);
    engine.pause();
    const remaining = engine.getScheduledLog();
    for (const n of pending) expect(remaining).not.toContainEqual(n);
  });
});

describe('mixer', () => {
  it('applies mute and solo to the track buses and ignores NaN gains', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    engine.setTrackGain('track-1', Number.NaN);
    expect(engine.getState().tracks[0].gain).toBe(0.8);
    engine.setTrackGain('track-1', 5);
    expect(engine.getState().tracks[0].gain).toBe(1);
    engine.setTrackGain('track-1', 0.8);
    engine.setMasterGain(Number.NaN);
    expect(engine.getState().masterGain).toBe(0.9);
    engine.setTrackGain('missing', 0.5);
    expect(engine.getState().tracks.length).toBe(2);

    await engine.play();
    const [bus1, bus2] = fake.trackBusParams();
    expect(bus1.value).toBe(0.8);
    expect(bus2.value).toBe(0.7);
    engine.setTrackMuted('track-2', true);
    expect(engine.getState().tracks[1]).toMatchObject({ muted: true, gain: 0.7 });
    expect(bus2.events.at(-1)).toMatchObject({ kind: 'target', value: 0 });
    engine.setTrackMuted('track-2', false);
    engine.setTrackSolo('track-1', true);
    expect(bus2.events.at(-1)).toMatchObject({ kind: 'target', value: 0 });
    expect(bus1.events.at(-1)).toMatchObject({ kind: 'target', value: 0.8 });
    engine.setTrackSolo('track-1', false);
    expect(bus2.events.at(-1)).toMatchObject({ kind: 'target', value: 0.7 });
  });

  it('reports smoothed per-track levels from the analysers', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    await engine.play();
    const meters = fake.analysers.filter((a) => a.fftSize === 256);
    meters[0].level = 0.5;
    await run(fake, 100);
    const [t1, t2] = engine.getState().tracks;
    expect(t1.level).toBeCloseTo(0.5, 6);
    expect(t2.level).toBe(0);
    meters[0].level = 0;
    await run(fake, 100);
    expect(engine.getState().tracks[0].level).toBeLessThan(0.5);
    expect(engine.getState().tracks[0].level).toBeGreaterThan(0.2);
  });
});

describe('synth integration', () => {
  it('a same-pitch retrigger chokes the previous voice instead of stacking with it', async () => {
    const { engine, fake } = harness();
    engine.load(scoreWith([{ instrument: 'strings', notes: [[67, 0, 1], [67, 1, 1], [69, 2, 1]] }], 120));
    await engine.play();
    await run(fake, 900);
    expect(engine.getScheduledLog().map((n) => n.midi)).toEqual([67, 67, 69]);
    const chokeAt = SCHEDULER.startLatencySeconds + 0.5 - RETRIGGER_LEAD_SECONDS;
    const choked = fake.envelopeParams().filter((p) => p.events.some((e) => e.kind === 'hold'));
    expect(choked.length).toBe(1);
    expect(fake.envelopeParams().indexOf(choked[0])).toBe(0);
    const hold = choked[0].events.find((e) => e.kind === 'hold');
    expect(hold?.time).toBeCloseTo(chokeAt, 6);
    expect(choked[0].events.at(-1)).toMatchObject({ kind: 'target', value: 0, tau: FAST_RELEASE_SECONDS });
    const firstVoiceOscillators = fake.oscillators.filter((o) => o.startTime !== undefined && o.startTime < 0.1);
    for (const osc of firstVoiceOscillators) expect(osc.stopTime).toBeCloseTo(chokeAt + FAST_RELEASE_SECONDS * 6 + 0.02, 6);
  });

  it('every voice starts from silence and voices are forgotten once their oscillators end', async () => {
    const { engine, fake } = harness();
    engine.load(scoreWith([{ notes: [[60, 0, 0.25]] }], 120));
    await engine.play();
    for (const param of fake.envelopeParams()) expect(param.events[0]).toMatchObject({ kind: 'set', value: 0 });
    expect(engine.getVoiceCount()).toBe(1);
    await run(fake, 1500);
    expect(engine.getVoiceCount()).toBe(0);
  });
});

describe('clock', () => {
  it('widens the lookahead while the document is hidden and reports the clock in use', async () => {
    const visible = harness();
    visible.engine.load(createDemoScore());
    await visible.engine.play();
    expect(visible.engine.getScheduledLog().length).toBe(4);
    expect(visible.engine.getClockInfo()).toMatchObject({ ticker: 'interval', horizonSeconds: SCHEDULER.horizonSeconds, hidden: false });

    const hidden = harness();
    hidden.setHidden(true);
    hidden.engine.load(createDemoScore());
    await hidden.engine.play();
    const qns = hidden.engine.getScheduledLog().map((n) => n.qn);
    expect(Math.max(...qns)).toBeGreaterThanOrEqual(2.5);
    expect(hidden.engine.getClockInfo()).toMatchObject({ horizonSeconds: SCHEDULER.hiddenHorizonSeconds, hidden: true });
    await run(hidden.fake, 3000, 1000);
    const keys = hidden.engine.getScheduledLog().map(noteKey);
    expect(new Set(keys).size).toBe(keys.length);
    const due = createDemoScore().tracks.flatMap((t) => t.notes).filter((n) => n.startQn < hidden.engine.getState().positionQn);
    for (const n of due) expect(keys).toContain(noteKey({ trackId: n.trackId, midi: n.midi, qn: n.startQn }));
  });
});

describe('load and dispose', () => {
  it('load() mid-playback stops, rewinds, adopts the tempo and rebuilds the mixer', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    await engine.play();
    await run(fake, 300);
    engine.setTrackGain('track-1', 0.3);
    const next = scoreWith([{ id: 'solo', notes: [[60, 0, 4]] }], 90);
    engine.load(next);
    expect(engine.getState()).toMatchObject({ playing: false, positionQn: 0, tempoBpm: 90 });
    expect(engine.getState().tracks).toEqual([{ trackId: 'solo', gain: 0.8, muted: false, solo: false, level: 0 }]);
    expect(engine.getScheduledLog()).toEqual([]);
    expect(engine.getVoiceCount()).toBe(0);
    await engine.play();
    expect(engine.getScheduledLog().map((n) => n.trackId)).toEqual(['solo']);
  });

  it('dispose() closes the context and makes the engine inert', async () => {
    const { engine, fake } = harness();
    engine.load(createDemoScore());
    await engine.play();
    engine.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.state).toBe('closed');
    expect(engine.getState()).toMatchObject({ playing: false, contextState: 'closed' });
    await engine.play();
    expect(engine.getState().playing).toBe(false);
    await run(fake, 200);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sampled piano', () => {
  const fakeSet = (): PianoSampleSet => ({
    buffers: new Map(PIANO_SAMPLE_MIDIS.map((m) => [m, new FakeAudioBuffer(2, 44100 * 4, 44100) as unknown as AudioBuffer])),
  });

  it('plays piano and unnamed (percussion) tracks from the recordings and named instruments from the synth', async () => {
    const set = fakeSet();
    const { engine, fake } = harness({ samples: Promise.resolve(set) });
    engine.load(
      scoreWith([
        { id: 'p', instrument: 'piano', notes: [[62, 0, 1]] },
        { id: 'o', instrument: 'other', notes: [[71, 0, 1]] },
        { id: 's', instrument: 'strings', notes: [[40, 0, 1]] },
      ]),
    );
    await engine.play();
    expect(fake.sources.length).toBe(2);
    expect(fake.sources[0].buffer).toBe(set.buffers.get(63));
    expect(fake.sources[0].playbackRate.value).toBeCloseTo(Math.pow(2, -1 / 12), 9);
    expect(fake.sources[1].buffer).toBe(set.buffers.get(72));
    expect(fake.oscillators.length).toBe(timbreFor('strings').partials.length);
    expect(engine.getScheduledLog().find((n) => n.trackId === 'p')?.gain).toBeCloseTo(velocityToPeak(0.8), 9);
    expect(engine.getPianoSamples()).toEqual({ loaded: 30, settled: true });
  });

  it('keeps every track on the synth when the samples fail to load, live and offline', async () => {
    const { engine, fake, offlines } = harness({ samples: Promise.reject(new Error('offline')) });
    engine.load(scoreWith([{ instrument: 'piano', notes: [[60, 0, 1]] }]));
    await engine.play();
    expect(fake.sources.length).toBe(0);
    expect(fake.oscillators.length).toBeGreaterThan(0);
    await engine.renderOffline({ fromQn: 0, toQn: 1, tempoBpm: 120 });
    expect(offlines[0].sources.length).toBe(0);
    expect(offlines[0].oscillators.length).toBeGreaterThan(0);
    expect(engine.getPianoSamples()).toEqual({ loaded: 0, settled: true });
  });

  it('renders offline from the recordings once they have loaded', async () => {
    const { engine, offlines } = harness({ samples: Promise.resolve(fakeSet()) });
    engine.load(scoreWith([{ instrument: 'piano', notes: [[60, 0, 1], [67, 1, 1]] }]));
    await engine.renderOffline({ fromQn: 0, toQn: 2, tempoBpm: 120 });
    expect(offlines[0].sources.length).toBe(2);
    expect(offlines[0].oscillators.length).toBe(0);
  });
});
