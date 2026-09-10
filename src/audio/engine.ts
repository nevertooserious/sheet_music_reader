import type { AudioEngine, OfflineRenderOptions, ScheduledNote } from '../core/contracts';
import type { NoteEvent, ScoreModel, Track, TrackMixState, TransportState } from '../core/types';
import { qnToSeconds } from '../core/types';
import { type Ticker, type TickerFactory, createTicker } from './clock';
import { FAST_RELEASE_SECONDS, RETRIGGER_LEAD_SECONDS } from './envelope';
import { anySolo, clampGain, effectiveTrackGain, panPositions, smoothLevel } from './mix';
import {
  type ClockAnchor,
  SCHEDULER,
  clampTempo,
  cursorAt,
  heldNotesAt,
  horizonFor,
  maxDurationQn,
  noteTiming,
  positionAt,
  rebase,
  sortByStart,
  timeForQn,
} from './scheduler';
import { type TrackBus, type Voice, createMasterBus, createTrackBus, startVoice } from './synth';

/** Release tail appended to offline renders; the contract allows < 0.5 s. */
export const OFFLINE_TAIL_SECONDS = 0.35;
export const RESUME_TIMEOUT_MS = 1500;
const GAIN_SMOOTHING_SECONDS = 0.012;
const INITIAL_TEMPO = 100;
const INITIAL_MASTER_GAIN = 0.9;
const DEFAULT_TRACK_GAIN = 0.8;
const LEVEL_FLOOR = 0.001;
const QN_EPSILON = 1e-6;

export interface EngineOptions {
  createContext?: () => AudioContext;
  createOfflineContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  createTicker?: TickerFactory;
  /** Hidden-tab detection; defaults to document.visibilityState. */
  isHidden?: () => boolean;
}

export interface ClockInfo {
  ticker: Ticker['kind'] | 'none';
  horizonSeconds: number;
  hidden: boolean;
}

export interface AudioEngineInternals extends AudioEngine {
  getContext(): AudioContext | undefined;
  /** Master-bus analyser (post limiter); exists once the context has been created by play(). */
  getMasterAnalyser(): AnalyserNode | undefined;
  getScore(): ScoreModel | undefined;
  /** Voices scheduled or sounding that have not been released yet. */
  getVoiceCount(): number;
  getClockInfo(): ClockInfo;
  /** Stereo position per track id, -1..1. */
  getPans(): Record<string, number>;
}

interface TrackRuntime {
  track: Track;
  notes: NoteEvent[];
  maxDurationQn: number;
  cursor: number;
  pan: number;
  bus?: TrackBus;
  samples?: Float32Array<ArrayBuffer>;
  lastByMidi: Map<number, LiveVoice>;
}

interface LiveVoice {
  voice: Voice;
  entry: ScheduledNote;
  note: NoteEvent;
  track: TrackRuntime;
}

type FrameHandle = ReturnType<typeof setTimeout> | number;

function requestFrame(callback: (timestamp: number) => void): FrameHandle {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(handle: FrameHandle): void {
  if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') cancelAnimationFrame(handle);
  else clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function defaultCreateContext(): AudioContext {
  const scope = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available in this browser.');
  return new Ctor({ latencyHint: 'interactive' });
}

function defaultCreateOfflineContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('OfflineAudioContext is not available.');
  return new OfflineAudioContext(channels, length, sampleRate);
}

function defaultIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function contextStateOf(ctx: AudioContext | undefined): TransportState['contextState'] {
  if (!ctx) return 'none';
  const state: string = ctx.state;
  return state === 'running' || state === 'closed' ? state : 'suspended';
}

/** Resolves true once the context is running, false on failure or after `timeoutMs`; never hangs on a resume() that does not settle. */
export function resumeContext(context: AudioContext, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(handle);
      context.removeEventListener('statechange', onChange);
      resolve(context.state === 'running');
    };
    const onChange = (): void => {
      if (context.state === 'running' || context.state === 'closed') finish();
    };
    const handle = setTimeout(finish, timeoutMs);
    context.addEventListener('statechange', onChange);
    let attempt: Promise<void>;
    try {
      attempt = context.resume();
    } catch (err) {
      attempt = Promise.reject(err);
    }
    attempt.then(finish, finish);
  });
}

const validNote = (n: NoteEvent): boolean => Number.isFinite(n.startQn) && Number.isFinite(n.durationQn) && Number.isFinite(n.midi);

export function createAudioEngine(options: EngineOptions = {}): AudioEngineInternals {
  const makeContext = options.createContext ?? defaultCreateContext;
  const makeOffline = options.createOfflineContext ?? defaultCreateOfflineContext;
  const makeTicker = options.createTicker ?? createTicker;
  const isHidden = options.isHidden ?? defaultIsHidden;

  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let masterAnalyser: AnalyserNode | undefined;
  let score: ScoreModel | undefined;
  let tracks: TrackRuntime[] = [];
  let mix: TrackMixState[] = [];
  let playing = false;
  let positionQn = 0;
  let tempoBpm = INITIAL_TEMPO;
  let masterGain = INITIAL_MASTER_GAIN;
  let anchor: ClockAnchor = { anchorQn: 0, anchorTime: 0, tempoBpm };
  const voices = new Map<string, LiveVoice>();
  const log: ScheduledNote[] = [];
  const listeners = new Set<(state: TransportState) => void>();
  let ticker: Ticker | undefined;
  let horizonSeconds: number = SCHEDULER.horizonSeconds;
  let frame: FrameHandle | undefined;
  let lastFrameTime = 0;
  let playToken = 0;
  let pendingPlay: Promise<void> | undefined;
  let disposed = false;

  const durationQn = (): number => score?.durationQn ?? 0;

  function livePosition(): number {
    if (!playing || !ctx) return positionQn;
    return Math.min(positionAt(anchor, ctx.currentTime), durationQn());
  }

  function snapshot(): TransportState {
    return {
      playing,
      positionQn: livePosition(),
      tempoBpm,
      masterGain,
      tracks: mix,
      contextState: contextStateOf(ctx),
    };
  }

  function notify(): void {
    if (disposed) return;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function onStateChange(): void {
    if (disposed || !ctx) return;
    // An interruption or external suspend freezes the audio clock; reporting "playing" then would be a lie the UI cannot recover from.
    if (playing && ctx.state !== 'running') halt(ctx.currentTime);
    notify();
  }

  function onVisibilityChange(): void {
    if (playing) tick();
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);

  function ensureContext(): AudioContext {
    if (ctx) return ctx;
    const created = makeContext();
    ctx = created;
    const bus = createMasterBus(created, masterGain, true);
    master = bus.input;
    masterAnalyser = bus.analyser;
    created.addEventListener('statechange', onStateChange);
    buildTrackNodes();
    return created;
  }

  function buildTrackNodes(): void {
    if (!ctx || !master) return;
    const soloActive = anySolo(mix);
    for (const rt of tracks) {
      const state = mix.find((m) => m.trackId === rt.track.id);
      const bus = createTrackBus(ctx, master, state ? effectiveTrackGain(state, soloActive) : 0, rt.pan, true);
      rt.bus = bus;
      rt.samples = bus.analyser ? new Float32Array(bus.analyser.fftSize) : undefined;
    }
  }

  function teardownTrackNodes(): void {
    for (const rt of tracks) {
      rt.bus?.disconnect();
      rt.bus = undefined;
      rt.samples = undefined;
    }
  }

  function applyTrackGains(): void {
    if (!ctx) return;
    const soloActive = anySolo(mix);
    const t = ctx.currentTime;
    for (const rt of tracks) {
      const state = mix.find((m) => m.trackId === rt.track.id);
      if (rt.bus && state) rt.bus.input.gain.setTargetAtTime(effectiveTrackGain(state, soloActive), t, GAIN_SMOOTHING_SECONDS);
    }
  }

  const voiceKey = (rt: TrackRuntime, noteIndex: number): string => `${rt.track.id}:${noteIndex}`;

  function forget(key: string, live: LiveVoice): void {
    voices.delete(key);
    if (live.track.lastByMidi.get(live.note.midi) === live) live.track.lastByMidi.delete(live.note.midi);
  }

  function startNote(rt: TrackRuntime, noteIndex: number, now: number): void {
    const context = ctx;
    const bus = rt.bus;
    if (!context || !bus) return;
    const key = voiceKey(rt, noteIndex);
    if (voices.has(key)) return;
    const note = rt.notes[noteIndex];
    const timing = noteTiming(anchor, note, now);
    const previous = rt.lastByMidi.get(note.midi);
    if (previous && previous.voice.startTime <= timing.start && previous.voice.stopTime > timing.start) {
      previous.voice.choke(timing.start - RETRIGGER_LEAD_SECONDS);
    }
    const voice = startVoice(context, bus.input, {
      midi: note.midi,
      velocity: note.velocity,
      startTime: timing.start,
      durationSeconds: timing.durationSeconds,
      elapsedSeconds: timing.elapsedSeconds,
      instrument: rt.track.instrument,
      onEnded: () => {
        const live = voices.get(key);
        if (live?.voice === voice) forget(key, live);
      },
    });
    const entry: ScheduledNote = {
      trackId: rt.track.id,
      midi: note.midi,
      time: timing.start,
      qn: note.startQn,
      durationSeconds: timing.durationSeconds,
      gain: voice.peak,
    };
    log.push(entry);
    const live: LiveVoice = { voice, entry, note, track: rt };
    voices.set(key, live);
    rt.lastByMidi.set(note.midi, live);
  }

  function scheduleTrack(rt: TrackRuntime, untilQn: number, now: number): void {
    while (rt.cursor < rt.notes.length && rt.notes[rt.cursor].startQn < untilQn) startNote(rt, rt.cursor++, now);
  }

  /** Notes that began before `qn` and are still sounding there start now, joined mid-envelope. */
  function chaseHeld(qn: number, now: number): void {
    for (const rt of tracks) for (const i of heldNotesAt(rt.notes, qn, rt.maxDurationQn)) startNote(rt, i, now);
  }

  function tick(): void {
    if (!playing || !ctx || !score) return;
    const now = ctx.currentTime;
    if (positionAt(anchor, now) >= score.durationQn) {
      finish();
      return;
    }
    horizonSeconds = horizonFor(isHidden());
    const untilQn = Math.min(positionAt(anchor, now + horizonSeconds), score.durationQn);
    for (const rt of tracks) scheduleTrack(rt, untilQn, now);
  }

  function removeLogEntry(entry: ScheduledNote): void {
    const i = log.lastIndexOf(entry);
    if (i >= 0) log.splice(i, 1);
  }

  const isPending = (live: LiveVoice, now: number): boolean => live.voice.startTime > now + SCHEDULER.minLeadSeconds;

  /** Drop voices that have not started sounding; a cancelled note never sounded, so it leaves the log. */
  function cancelPending(now: number): void {
    for (const [key, live] of voices) {
      if (isPending(live, now)) {
        live.voice.cancel();
        removeLogEntry(live.entry);
        forget(key, live);
      }
    }
  }

  function releaseAll(now: number, keep?: (live: LiveVoice) => boolean): void {
    for (const [key, live] of voices) {
      if (isPending(live, now)) {
        live.voice.cancel();
        removeLogEntry(live.entry);
      } else if (keep?.(live)) {
        continue;
      } else {
        live.voice.release(now + SCHEDULER.minLeadSeconds, FAST_RELEASE_SECONDS);
      }
      forget(key, live);
    }
  }

  /** Sounding voices follow the (new) anchor: their release moves to where the note now ends. */
  function retimeSounding(): void {
    for (const live of voices.values()) {
      live.voice.retime(timeForQn(anchor, live.note.startQn + live.note.durationQn));
      live.entry.durationSeconds = live.voice.endTime - live.voice.startTime;
    }
  }

  function resetCursors(qn: number): void {
    for (const rt of tracks) rt.cursor = cursorAt(rt.notes, qn);
  }

  function startTicker(): void {
    if (!ticker) ticker = makeTicker(tick, SCHEDULER.tickMs);
    ticker.start();
  }

  function stopTicker(): void {
    ticker?.stop();
  }

  function updateLevels(dtSeconds: number): boolean {
    let active = false;
    let changed = false;
    const next = mix.map((state, i) => {
      const rt = tracks[i];
      let peak = 0;
      const analyser = rt?.bus?.analyser;
      if (analyser && rt.samples) {
        analyser.getFloatTimeDomainData(rt.samples);
        for (let s = 0; s < rt.samples.length; s++) {
          const v = Math.abs(rt.samples[s]);
          if (v > peak) peak = v;
        }
      }
      const raw = smoothLevel(state.level, peak, dtSeconds);
      const level = raw < LEVEL_FLOOR ? 0 : raw;
      if (level > 0) active = true;
      if (level === state.level) return state;
      changed = true;
      return { ...state, level };
    });
    if (changed) mix = next;
    return active;
  }

  function frameTick(timestamp: number): void {
    frame = undefined;
    if (disposed) return;
    const dt = lastFrameTime ? Math.min(0.1, (timestamp - lastFrameTime) / 1000) : 1 / 60;
    lastFrameTime = timestamp;
    if (playing && ctx && score && positionAt(anchor, ctx.currentTime) >= score.durationQn) finish();
    const active = updateLevels(dt);
    notify();
    if (playing || active) frame = requestFrame(frameTick);
    else lastFrameTime = 0;
  }

  function startFrames(): void {
    if (frame === undefined) {
      lastFrameTime = 0;
      frame = requestFrame(frameTick);
    }
  }

  /** End of score: the transport stops at durationQn while the last notes ring out naturally. */
  function finish(): void {
    playing = false;
    positionQn = durationQn();
    stopTicker();
    voices.clear();
    for (const rt of tracks) rt.lastByMidi.clear();
    notify();
    startFrames();
  }

  function halt(now: number): void {
    positionQn = Math.min(positionAt(anchor, now), durationQn());
    playing = false;
    stopTicker();
    releaseAll(now);
    notify();
    startFrames();
  }

  function pause(): void {
    playToken++;
    if (!playing || !ctx) return;
    halt(ctx.currentTime);
  }

  function startPlayback(context: AudioContext): void {
    if (!score) return;
    if (positionQn >= score.durationQn) positionQn = 0;
    const now = context.currentTime;
    anchor = { anchorQn: positionQn, anchorTime: now + SCHEDULER.startLatencySeconds, tempoBpm };
    resetCursors(positionQn);
    playing = true;
    chaseHeld(positionQn, now);
    startTicker();
    tick();
    startFrames();
    notify();
  }

  async function play(): Promise<void> {
    if (disposed || !score || score.durationQn <= 0) return;
    if (playing && ctx?.state === 'running') return;
    if (pendingPlay) return pendingPlay;
    const token = ++playToken;
    pendingPlay = (async () => {
      const context = ensureContext();
      const running = context.state === 'running' || (await resumeContext(context, RESUME_TIMEOUT_MS));
      if (token !== playToken || disposed || !score) return;
      if (!running) {
        if (playing) halt(context.currentTime);
        else notify();
        return;
      }
      if (!playing) startPlayback(context);
    })();
    try {
      await pendingPlay;
    } finally {
      pendingPlay = undefined;
    }
  }

  function seek(target: number): void {
    if (!score || !Number.isFinite(target)) return;
    const clamped = Math.min(Math.max(0, target), score.durationQn);
    if (playing && ctx) {
      const now = ctx.currentTime;
      const spansTarget = (live: LiveVoice): boolean =>
        live.note.startQn < clamped - QN_EPSILON && live.note.startQn + live.note.durationQn > clamped + QN_EPSILON;
      releaseAll(now, spansTarget);
      anchor = rebase(anchor, now, { positionQn: clamped, latencySeconds: SCHEDULER.seekLatencySeconds });
      retimeSounding();
      resetCursors(clamped);
      chaseHeld(clamped, now);
      tick();
    } else {
      positionQn = clamped;
    }
    notify();
  }

  function setTempo(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    const next = clampTempo(bpm);
    if (next === tempoBpm) return;
    tempoBpm = next;
    if (playing && ctx) {
      const now = ctx.currentTime;
      cancelPending(now);
      anchor = rebase(anchor, now, { tempoBpm: next });
      retimeSounding();
      resetCursors(anchor.anchorQn);
      tick();
    }
    notify();
  }

  function updateMix(trackId: string, patch: Partial<TrackMixState>): void {
    let found = false;
    mix = mix.map((m) => {
      if (m.trackId !== trackId) return m;
      found = true;
      return { ...m, ...patch };
    });
    if (!found) return;
    applyTrackGains();
    notify();
  }

  function load(next: ScoreModel): void {
    if (disposed) return;
    playToken++;
    if (playing && ctx) releaseAll(ctx.currentTime);
    playing = false;
    stopTicker();
    voices.clear();
    teardownTrackNodes();
    score = next;
    positionQn = 0;
    tempoBpm = clampTempo(next.tempoBpm);
    const pans = panPositions(next.tracks);
    tracks = next.tracks.map((track, i) => {
      const notes = sortByStart(track.notes.filter(validNote));
      return { track, notes, maxDurationQn: maxDurationQn(notes), cursor: 0, pan: pans[i] ?? 0, lastByMidi: new Map() };
    });
    mix = next.tracks.map((track) => ({
      trackId: track.id,
      gain: clampGain(track.defaultGain, DEFAULT_TRACK_GAIN),
      muted: false,
      solo: false,
      level: 0,
    }));
    log.length = 0;
    buildTrackNodes();
    notify();
  }

  async function renderOffline(options: OfflineRenderOptions): Promise<AudioBuffer> {
    if (!score) throw new Error('No score loaded.');
    const tempo = clampTempo(options.tempoBpm, tempoBpm);
    const fromQn = Math.max(0, Number.isFinite(options.fromQn) ? options.fromQn : 0);
    const toQn = options.toQn;
    if (!Number.isFinite(toQn) || toQn <= fromQn) throw new Error('renderOffline: toQn must be greater than fromQn.');
    const sampleRate = Math.min(96000, Math.max(8000, options.sampleRate ?? 44100));
    const seconds = qnToSeconds(toQn - fromQn, tempo) + OFFLINE_TAIL_SECONDS;
    const offline = makeOffline(2, Math.max(128, Math.ceil(seconds * sampleRate)), sampleRate);
    const bus = createMasterBus(offline, masterGain);

    const selected = options.trackIds ? new Set(options.trackIds) : undefined;
    const soloActive = anySolo(mix);
    for (const rt of tracks) {
      if (selected && !selected.has(rt.track.id)) continue;
      const state = mix.find((m) => m.trackId === rt.track.id);
      if (!state) continue;
      // An explicit trackIds list is the caller choosing what to hear, so only the fader applies; the default set follows mute/solo.
      const gain = selected ? clampGain(state.gain) : effectiveTrackGain(state, soloActive);
      if (gain <= 0) continue;
      const trackBus = createTrackBus(offline, bus.input, gain, rt.pan, false);
      const lastByMidi = new Map<number, Voice>();
      const start = (note: NoteEvent, startTime: number, durationSeconds: number, elapsedSeconds: number): void => {
        const previous = lastByMidi.get(note.midi);
        if (previous && previous.startTime <= startTime && previous.stopTime > startTime) previous.choke(startTime - RETRIGGER_LEAD_SECONDS);
        const voice = startVoice(offline, trackBus.input, {
          midi: note.midi,
          velocity: note.velocity,
          startTime,
          durationSeconds: Math.max(SCHEDULER.minNoteSeconds, durationSeconds),
          elapsedSeconds,
          instrument: rt.track.instrument,
        });
        lastByMidi.set(note.midi, voice);
      };
      for (const i of heldNotesAt(rt.notes, fromQn, rt.maxDurationQn)) {
        const note = rt.notes[i];
        start(note, 0, qnToSeconds(note.startQn + note.durationQn - fromQn, tempo), qnToSeconds(fromQn - note.startQn, tempo));
      }
      for (let i = cursorAt(rt.notes, fromQn); i < rt.notes.length && rt.notes[i].startQn < toQn; i++) {
        const note = rt.notes[i];
        start(note, qnToSeconds(note.startQn - fromQn, tempo), qnToSeconds(note.durationQn, tempo), 0);
      }
    }
    return offline.startRendering();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    playToken++;
    ticker?.dispose();
    ticker = undefined;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    if (frame !== undefined) {
      cancelFrame(frame);
      frame = undefined;
    }
    for (const live of voices.values()) live.voice.cancel();
    voices.clear();
    teardownTrackNodes();
    master?.disconnect();
    listeners.clear();
    playing = false;
    if (ctx) {
      ctx.removeEventListener('statechange', onStateChange);
      void ctx.close().catch(() => undefined);
    }
  }

  return {
    load,
    play,
    pause,
    stop() {
      pause();
      positionQn = 0;
      notify();
    },
    seek,
    setTempo,
    setMasterGain(gain) {
      if (!Number.isFinite(gain)) return;
      masterGain = clampGain(gain);
      if (ctx && master) master.gain.setTargetAtTime(masterGain, ctx.currentTime, GAIN_SMOOTHING_SECONDS);
      notify();
    },
    setTrackGain(trackId, gain) {
      if (!Number.isFinite(gain)) return;
      updateMix(trackId, { gain: clampGain(gain) });
    },
    setTrackMuted: (trackId, muted) => updateMix(trackId, { muted: !!muted }),
    setTrackSolo: (trackId, solo) => updateMix(trackId, { solo: !!solo }),
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getScheduledLog: () => [...log],
    clearScheduledLog() {
      log.length = 0;
    },
    renderOffline,
    dispose,
    getContext: () => ctx,
    getMasterAnalyser: () => masterAnalyser,
    getScore: () => score,
    getVoiceCount: () => voices.size,
    getClockInfo: () => ({ ticker: ticker?.kind ?? 'none', horizonSeconds, hidden: isHidden() }),
    getPans: () => Object.fromEntries(tracks.map((rt) => [rt.track.id, rt.pan])),
  };
}
