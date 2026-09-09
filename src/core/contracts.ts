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
  onProgress?: (progress: ParseProgress) => void;
  /** Expand repeat barlines into the playback timeline. Default true. */
  unfoldRepeats?: boolean;
}

export interface ScoreDocument {
  score: ScoreModel;
  pages: PageInfo[];
  /**
   * Draw one page onto a canvas at the given scale (1 = PDF points → CSS px).
   * The implementation sizes the canvas itself.
   */
  renderPage(pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  /** Optional per-page debug overlay data (detected staves, glyphs) for showcases. */
  debug?: unknown;
  dispose(): void;
}

export interface ScoreParser {
  parse(data: ArrayBuffer, options: ParseOptions): Promise<ScoreDocument>;
}

/** A note the engine actually scheduled on the audio clock; used by verification. */
export interface ScheduledNote {
  trackId: string;
  midi: number;
  /** AudioContext time the note starts. */
  time: number;
  /** Timeline position the note corresponds to, in quarter notes. */
  qn: number;
  durationSeconds: number;
  gain: number;
}

export interface OfflineRenderOptions {
  fromQn: number;
  toQn: number;
  tempoBpm: number;
  sampleRate?: number;
  /** Track ids to include; default all unmuted. */
  trackIds?: string[];
}

export interface AudioEngine {
  load(score: ScoreModel): void;
  /** Resumes the AudioContext (must be called from a user gesture in browsers) and starts from the current position. */
  play(): Promise<void>;
  pause(): void;
  /** Pause and rewind to 0. */
  stop(): void;
  /** Move the playhead. Works while playing (re-schedules) or paused. */
  seek(positionQn: number): void;
  /** Quarter notes per minute, clamped to [20, 300]. Takes effect immediately, even while playing. */
  setTempo(bpm: number): void;
  setMasterGain(gain: number): void;
  setTrackGain(trackId: string, gain: number): void;
  setTrackMuted(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  getState(): TransportState;
  /** Listener fires on every state change and at least every animation frame while playing. */
  subscribe(listener: (state: TransportState) => void): () => void;
  /** Notes scheduled since load()/last clear, oldest first. */
  getScheduledLog(): ScheduledNote[];
  clearScheduledLog(): void;
  /** Render a section to a buffer without real-time playback, for verification. */
  renderOffline(options: OfflineRenderOptions): Promise<AudioBuffer>;
  dispose(): void;
}

export interface AppStore {
  getState(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
}

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
