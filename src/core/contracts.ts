/**
 * Interfaces each subsystem implements or consumes. Ownership:
 *   - src/parsing implements ScoreParser and ScoreDocument.
 *   - src/audio implements AudioEngine.
 *   - src/ui consumes AppStore + AppController (never the engine or parser directly).
 *   - src/core/main.ts wires them together and exposes test hooks.
 *
 * Changes to this file are made only by the integrator. Builders request
 * changes by writing them into docs/core-change-requests.md.
 */
import type {
  AppState,
  PageInfo,
  ParseProgress,
  ScoreModel,
  TransportState,
} from './types';

export interface ParseOptions {
  fileName: string;
  /** Fractions should be non-decreasing; `stage` is shown verbatim in the progress card. */
  onProgress?: (progress: ParseProgress) => void;
  /** Expand repeat barlines into the playback timeline. Default true. */
  unfoldRepeats?: boolean;
  /**
   * 1-based PDF page numbers to read, in order; default all pages. The
   * resulting ScoreDocument.pages are indexed 0..n-1 in this order and
   * renderPage(i) draws the i-th selected page.
   */
  pages?: number[];
}

export interface ScoreDocument {
  score: ScoreModel;
  pages: PageInfo[];
  /**
   * Draw one page onto a canvas at the given scale (1 = PDF points → device px;
   * the UI passes CSS scale × devicePixelRatio). The implementation sets
   * `canvas.width`/`canvas.height` (bitmap size) only and must not set inline
   * CSS size; the UI owns the CSS box. Rejects if the page cannot be drawn.
   */
  renderPage(pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  /** Optional per-page debug overlay data (detected staves, glyphs) for showcases. */
  debug?: unknown;
  /** Release pdf.js resources; the controller calls it when another document replaces this one. */
  dispose(): void;
}

export interface ScoreParser {
  /**
   * Rejects with an Error whose message is a complete, user-readable sentence
   * (it is shown verbatim in the error card), e.g. for scanned/raster PDFs,
   * non-PDF data, or a PDF in which no notes were found.
   */
  parse(data: ArrayBuffer, options: ParseOptions): Promise<ScoreDocument>;
}

/** A note the engine actually scheduled on the audio clock; used by verification. */
export interface ScheduledNote {
  trackId: string;
  midi: number;
  /** AudioContext time the note starts. */
  time: number;
  /**
   * The scheduled NoteEvent's `startQn`, unchanged (the verifier matches
   * trackId + midi + qn to two decimals). A note joined mid-way after a seek,
   * resume or offline start inside it keeps `qn = startQn`; `durationSeconds`
   * is then the remaining sounding time, not the note's full length.
   */
  qn: number;
  durationSeconds: number;
  /**
   * Velocity-mapped peak amplitude of the voice envelope (0..1) before track
   * and master gain; a muted track still schedules its notes so unmuting
   * mid-note is audible.
   */
  gain: number;
}

export interface OfflineRenderOptions {
  fromQn: number;
  toQn: number;
  tempoBpm: number;
  sampleRate?: number;
  /**
   * Track ids to include. When given, exactly these tracks are rendered at
   * their fader gain regardless of mute/solo (the caller is choosing what to
   * hear); when omitted, every track is rendered at its live effective gain,
   * i.e. mute and solo apply.
   */
  trackIds?: string[];
}

export interface AudioEngine {
  /**
   * Replace the current score: stops playback, rewinds to 0, adopts
   * `score.tempoBpm`, and rebuilds `TransportState.tracks` with one entry per
   * track (gain = track.defaultGain, muted/solo false, level 0).
   */
  load(score: ScoreModel): void;
  /**
   * Resumes the AudioContext (must be called from a user gesture in browsers)
   * and starts from the current position; at the end of the score it restarts
   * from 0. No-op without a loaded score. Reaching `durationQn` pauses there.
   * Resolves (never rejects) once playback has started or the context has
   * failed to reach 'running'; in the latter case `getState().playing` stays
   * false and a later play() retries.
   */
  play(): Promise<void>;
  pause(): void;
  /** Pause and rewind to 0. */
  stop(): void;
  /** Move the playhead (clamped to [0, durationQn]). Works while playing (re-schedules, no hanging notes) or paused. */
  seek(positionQn: number): void;
  /** Quarter notes per minute, clamped to [20, 300]. Takes effect immediately, even while playing. */
  setTempo(bpm: number): void;
  setMasterGain(gain: number): void;
  setTrackGain(trackId: string, gain: number): void;
  setTrackMuted(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  /** Reflects every setter synchronously; `positionQn` follows the audio clock while playing. */
  getState(): TransportState;
  /** Listener fires on every state change and at least every animation frame while playing. */
  subscribe(listener: (state: TransportState) => void): () => void;
  /** Notes scheduled since load()/last clear, oldest first. */
  getScheduledLog(): ScheduledNote[];
  clearScheduledLog(): void;
  /**
   * Render a section to a buffer without real-time playback, for verification.
   * Same synth code path as live playback; the buffer covers
   * qnToSeconds(toQn - fromQn, tempoBpm) plus at most a short release tail (< 0.5 s).
   */
  renderOffline(options: OfflineRenderOptions): Promise<AudioBuffer>;
  dispose(): void;
}

export interface AppStore {
  getState(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
}

/**
 * The only write surface the UI uses. Every load method moves the store
 * through status 'loading' (the previous score stays in state and playback is
 * paused), then 'parsing' with progress (previous score, pages and document are
 * cleared, playback stopped), then 'ready' or 'error'. A failure before parsing
 * starts therefore leaves the previous score on screen. The returned promise
 * rejects with the same error that is written to `AppState.error`, so callers
 * that only need the UI to show it may ignore the rejection; a load superseded
 * by a newer one resolves silently without touching the store.
 */
export interface AppController {
  loadFile(file: File): Promise<void>;
  loadArrayBuffer(data: ArrayBuffer, fileName: string): Promise<void>;
  /** Loads the bundled public-domain demo (Bach, Menuet in G, BWV Anh. 114). */
  loadDemo(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  togglePlay(): Promise<void>;
  seek(positionQn: number): void;
  /** Seek to the first occurrence of a printed measure. */
  seekToMeasure(measureIndex: number): void;
  setTempo(bpm: number): void;
  setMasterGain(gain: number): void;
  setTrackGain(trackId: string, gain: number): void;
  setTrackMuted(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  /** Forwards to the current ScoreDocument; rejects with "No document loaded" while none is ready. */
  renderPage(pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
}

/**
 * Every module ships a showcase: a self-contained scene exercising only that
 * module, reachable at /?showcase=<module>. The tutorial steps let the
 * verification tooling and critics screenshot the scene at several moments.
 */
export interface Showcase {
  name: string;
  /** Ordered tutorial steps; each label should describe what the scene shows after the step. */
  steps: string[];
  /** Run step i (0-based). Resolve once the scene is visually settled. */
  runStep(index: number): Promise<void>;
  /** Arbitrary JSON-serialisable diagnostics for the verifier. */
  getDiagnostics(): Record<string, unknown>;
}

export type ShowcaseFactory = (root: HTMLElement) => Promise<Showcase>;

/** Hooks exposed on window.__smr for verification and critics. */
export interface TestHooks {
  version: string;
  ready: boolean;
  mode: 'app' | 'showcase';
  store?: AppStore;
  controller?: AppController;
  engine?: AudioEngine;
  parser?: ScoreParser;
  showcase?: Showcase;
  /** Console errors captured by the app itself since boot. */
  errors: string[];
}

declare global {
  interface Window {
    __smr?: TestHooks;
  }
}
