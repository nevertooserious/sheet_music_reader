import type { AppController, Showcase } from '../core/contracts';
import { createStore, initialAppState, initialTransport } from '../core/store';
import type { AppState, PageInfo, ScoreModel, TrackMixState, TransportState } from '../core/types';
import { secondsToQn } from '../core/types';
import { activeNotes, clamp, maxDuration, sortNotes } from './format';
import { type MountedApp, mountApp } from './index';
import { drawMockPage } from './mockPage';
import { createEnsembleScore, createShowcaseScore, pageInfos } from './showcaseScores';

const RASTER_ERROR =
  'No music-font glyphs found on any page. This looks like a scanned (raster) PDF; only vector-engraved scores are supported in this release.';
const ENSEMBLE_PAGES = 24;
const ENSEMBLE_STAVES = 6;

type Outcome = 'demo' | 'ensemble' | 'raster' | 'unreadable';

/** The mock parser decides what a "file" contains from its name. */
function outcomeFor(fileName: string): Outcome {
  if (/scanned|raster|scan/i.test(fileName)) return 'raster';
  if (/corrupt|empty|broken/i.test(fileName)) return 'unreadable';
  if (/symphon|sinfonia|ensemble|orchestra|full score/i.test(fileName)) return 'ensemble';
  return 'demo';
}

interface MockTransport {
  getState(): TransportState;
  load(score: ScoreModel | undefined): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(qn: number): void;
  setTempo(bpm: number): void;
  setMasterGain(gain: number): void;
  setTrackGain(id: string, gain: number): void;
  setTrackMuted(id: string, muted: boolean): void;
  setTrackSolo(id: string, solo: boolean): void;
}

function createMockTransport(publish: (state: TransportState) => void): MockTransport {
  let state: TransportState = { ...initialTransport, tempoBpm: 108, contextState: 'suspended' };
  let score: ScoreModel | undefined;
  let sortedNotes: { sorted: ReturnType<typeof sortNotes>; max: number; trackId: string }[] = [];
  let anchorQn = 0;
  let anchorTime = 0;
  let frame: number | undefined;
  const buffer: ReturnType<typeof sortNotes> = [];

  const emit = (): void => publish(state);
  const set = (patch: Partial<TransportState>): void => {
    state = { ...state, ...patch };
    emit();
  };
  const rebase = (): void => {
    anchorQn = state.positionQn;
    anchorTime = performance.now();
  };

  const levels = (positionQn: number): TrackMixState[] => {
    const anySolo = state.tracks.some((t) => t.solo);
    return state.tracks.map((mix) => {
      const notes = sortedNotes.find((n) => n.trackId === mix.trackId);
      let energy = 0;
      if (notes && state.playing) {
        for (const note of activeNotes(notes.sorted, positionQn, notes.max, buffer)) {
          const age = positionQn - note.startQn;
          energy += note.velocity * Math.exp(-age * 1.6);
        }
      }
      const audible = !mix.muted && (!anySolo || mix.solo);
      const level = audible ? clamp(energy * mix.gain * state.masterGain * 0.9, 0, 1) : 0;
      return level === mix.level ? mix : { ...mix, level };
    });
  };

  const tick = (): void => {
    frame = undefined;
    if (!state.playing || !score) return;
    const elapsed = (performance.now() - anchorTime) / 1000;
    let positionQn = anchorQn + secondsToQn(elapsed, state.tempoBpm);
    if (positionQn >= score.durationQn) {
      state = { ...state, playing: false, positionQn: score.durationQn, contextState: 'suspended' };
      state = { ...state, tracks: levels(state.positionQn) };
      emit();
      return;
    }
    positionQn = clamp(positionQn, 0, score.durationQn);
    state = { ...state, positionQn, tracks: levels(positionQn) };
    emit();
    frame = requestAnimationFrame(tick);
  };

  return {
    getState: () => state,
    load(next) {
      score = next;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      sortedNotes = next
        ? next.tracks.map((t) => {
            const sorted = sortNotes(t.notes);
            return { sorted, max: maxDuration(sorted), trackId: t.id };
          })
        : [];
      set({
        playing: false,
        positionQn: 0,
        tempoBpm: next?.tempoBpm ?? state.tempoBpm,
        tracks: next
          ? next.tracks.map((t) => ({ trackId: t.id, gain: t.defaultGain, muted: false, solo: false, level: 0 }))
          : [],
        contextState: next ? 'suspended' : 'none',
      });
    },
    async play() {
      if (!score || state.playing) return;
      if (state.positionQn >= score.durationQn) state = { ...state, positionQn: 0 };
      state = { ...state, playing: true, contextState: 'running' };
      rebase();
      emit();
      if (frame === undefined) frame = requestAnimationFrame(tick);
    },
    pause() {
      if (!state.playing) return;
      state = { ...state, playing: false, contextState: 'suspended' };
      set({ tracks: levels(state.positionQn) });
    },
    stop() {
      state = { ...state, playing: false, positionQn: 0, contextState: score ? 'suspended' : 'none' };
      set({ tracks: levels(0) });
    },
    seek(qn) {
      const positionQn = clamp(qn, 0, score?.durationQn ?? 0);
      state = { ...state, positionQn };
      rebase();
      emit();
    },
    setTempo(bpm) {
      rebase();
      set({ tempoBpm: clamp(bpm, 20, 300) });
    },
    setMasterGain(gain) {
      set({ masterGain: clamp(gain, 0, 1) });
    },
    setTrackGain(id, gain) {
      set({ tracks: state.tracks.map((t) => (t.trackId === id ? { ...t, gain: clamp(gain, 0, 1) } : t)) });
    },
    setTrackMuted(id, muted) {
      set({ tracks: state.tracks.map((t) => (t.trackId === id ? { ...t, muted } : t)) });
    },
    setTrackSolo(id, solo) {
      set({ tracks: state.tracks.map((t) => (t.trackId === id ? { ...t, solo } : t)) });
    },
  };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (predicate()) return true;
    await wait(30);
  }
  return predicate();
}

export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  const store = createStore({ ...initialAppState, transport: { ...initialTransport, tempoBpm: 108, contextState: 'suspended' } });
  const transport = createMockTransport((state) => store.setState({ transport: state }));
  let currentScore: ScoreModel | undefined;
  let currentPages: PageInfo[] = [];

  async function parseWithProgress(fileName: string, outcome: Outcome): Promise<void> {
    transport.stop();
    transport.load(undefined);
    currentScore = undefined;
    currentPages = [];
    store.setState({
      status: 'parsing',
      fileName,
      error: undefined,
      score: undefined,
      pages: [],
      progress: { fraction: 0, stage: 'Opening PDF' },
    });
    const stages: Array<[string, number]> = [
      ['Opening PDF', 0.08],
      ['Extracting glyphs and paths', 0.32],
      ['Detecting staves and systems', 0.55],
      ['Reading clefs, keys and notes', 0.8],
      ['Assembling score', 1],
    ];
    const perStage = outcome === 'raster' ? 90 : 110;
    for (const [stage, fraction] of stages) {
      await wait(perStage);
      if (outcome === 'raster' && fraction > 0.4) break;
      store.setState({ progress: { fraction, stage } });
    }
    if (outcome === 'raster') {
      store.setState({ status: 'error', error: RASTER_ERROR, progress: undefined });
      throw new Error(RASTER_ERROR);
    }
    const score =
      outcome === 'ensemble'
        ? createEnsembleScore({ pages: ENSEMBLE_PAGES, staves: ENSEMBLE_STAVES, fileName })
        : createShowcaseScore();
    score.source.fileName = fileName;
    currentScore = score;
    currentPages = pageInfos(score.source.pageCount);
    transport.load(score);
    store.setState({
      status: 'ready',
      score,
      pages: currentPages,
      progress: undefined,
      transport: transport.getState(),
    });
  }

  /** Mirrors core/controller: a failure before parsing starts leaves the previous score on screen. */
  async function load(fileName: string, bytes: number): Promise<void> {
    store.setState({ status: 'loading', fileName, error: undefined });
    await wait(120);
    const outcome = outcomeFor(fileName);
    if (outcome === 'unreadable' || bytes === 0) {
      const message = `Could not read "${fileName}": the download is empty (0 bytes). Check the file and try again.`;
      store.setState({ status: 'error', error: message });
      throw new Error(message);
    }
    await parseWithProgress(fileName, outcome);
  }

  const controller: AppController = {
    async loadFile(file) {
      const data = await file.arrayBuffer();
      await load(file.name, data.byteLength);
    },
    async loadArrayBuffer(data, fileName) {
      await load(fileName, data.byteLength);
    },
    async loadDemo() {
      await load('Bach - Menuet in G (BWV Anh. 114).pdf', 1);
    },
    play: () => transport.play(),
    pause: () => transport.pause(),
    stop: () => transport.stop(),
    async togglePlay() {
      if (transport.getState().playing) transport.pause();
      else await transport.play();
    },
    seek: (qn) => transport.seek(qn),
    seekToMeasure(index) {
      const measure = currentScore?.measures[index];
      if (measure) transport.seek(measure.firstStartQn);
    },
    setTempo: (bpm) => transport.setTempo(bpm),
    setMasterGain: (gain) => transport.setMasterGain(gain),
    setTrackGain: (id, gain) => transport.setTrackGain(id, gain),
    setTrackMuted: (id, muted) => transport.setTrackMuted(id, muted),
    setTrackSolo: (id, solo) => transport.setTrackSolo(id, solo),
    async renderPage(pageIndex, canvas, scale) {
      if (!currentScore) throw new Error('No document loaded');
      const page = currentPages[pageIndex];
      if (!page) throw new Error(`Page ${pageIndex} does not exist`);
      await nextFrame();
      drawMockPage(canvas, currentScore, page, scale);
    },
  };

  root.replaceChildren();
  const app: MountedApp = mountApp(root, { store, controller });
  if (window.__smr) {
    window.__smr.store = store;
    window.__smr.controller = controller;
  }

  const q = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const fire = (target: EventTarget, type: string): void => {
    target.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const dragEvent = (type: string): DragEvent => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([''], 'score.pdf', { type: 'application/pdf' }));
    return new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
  };
  const shell = (): HTMLElement => root.querySelector<HTMLElement>('.smr-app') ?? root;
  const chooseFile = (name: string, bytes: number): void => {
    const input = q<HTMLInputElement>('input[type="file"]');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    if (input) {
      input.files = dataTransfer.files;
      fire(input, 'change');
    } else {
      controller.loadArrayBuffer(new ArrayBuffer(bytes), name).catch(() => undefined);
    }
  };
  const settled = async (): Promise<void> => {
    await nextFrame();
    await nextFrame();
  };
  const chooseZoom = (value: string): void => {
    const select = q<HTMLSelectElement>('[data-control="zoom"]');
    if (!select) return;
    select.value = value;
    fire(select, 'change');
  };
  /** Ctrl+wheel notches at a client point, the way Chrome reports both a mouse wheel and a trackpad pinch. */
  const wheelZoom = (target: HTMLElement, clientX: number, clientY: number, notches: number): void => {
    for (let i = 0; i < Math.abs(notches); i++) {
      target.dispatchEvent(
        new WheelEvent('wheel', { clientX, clientY, deltaY: notches > 0 ? -100 : 100, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    }
  };
  /** Two synthetic fingers spreading around the viewport centre; WebKit gesture events where touch events are unavailable. */
  const pinchZoom = (target: HTMLElement, ratio: number): void => {
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (typeof TouchEvent === 'function' && typeof Touch === 'function') {
      const fingers = (half: number): Touch[] => [
        new Touch({ identifier: 1, target, clientX: cx - half, clientY: cy }),
        new Touch({ identifier: 2, target, clientX: cx + half, clientY: cy }),
      ];
      const touch = (type: string, touches: Touch[]): void => {
        target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true }));
      };
      touch('touchstart', fingers(60));
      touch('touchmove', fingers(60 * Math.sqrt(ratio)));
      touch('touchmove', fingers(60 * ratio));
      touch('touchend', []);
      return;
    }
    const gesture = (type: string, scale: number): Event =>
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: cx, clientY: cy });
    target.dispatchEvent(gesture('gesturestart', 1));
    target.dispatchEvent(gesture('gesturechange', Math.sqrt(ratio)));
    target.dispatchEvent(gesture('gesturechange', ratio));
    target.dispatchEvent(gesture('gestureend', ratio));
  };
  const setFollow = (on: boolean): void => {
    const toggle = q<HTMLButtonElement>('[data-action="toggle-follow"]');
    if (toggle && (toggle.getAttribute('aria-pressed') === 'true') !== on) toggle.click();
  };
  const rerendered = (): boolean => {
    const render = app.scoreView.getRenderStats();
    return render.renderedPages > 0 && render.freshPages === render.renderedPages;
  };

  const reset = async (): Promise<void> => {
    transport.stop();
    transport.load(undefined);
    currentScore = undefined;
    currentPages = [];
    store.setState({ ...initialAppState, fileName: undefined, error: undefined, transport: transport.getState() });
    await settled();
  };

  const snapshot = (): Record<string, unknown> => {
    const render = app.scoreView.getRenderStats();
    const state = store.getState();
    return {
      status: state.status,
      pages: root.querySelectorAll('.page').length,
      renderedPages: root.querySelectorAll('.page[data-rendered="true"]').length,
      renderCalls: render.renderCalls,
      releases: render.releases,
      bitmapMB: +(render.bitmapBytes / 1048576).toFixed(1),
      visiblePages: render.visiblePages,
      mixerStrips: root.querySelectorAll('.strip').length,
      mixer: app.mixer.getOverflow(),
      errorBannerVisible: !(q<HTMLElement>('[data-role="error-banner"]')?.hidden ?? true),
      errorCardVisible: !(q<HTMLElement>('[data-role="error-state"]')?.hidden ?? true),
      positionText: q('[data-role="position"]')?.textContent ?? '',
      zoom: app.scoreView.getZoom(),
      scale: +render.scale.toFixed(3),
      following: app.scoreView.isFollowing(),
      scrollLeft: Math.round(app.scoreView.scroll.scrollLeft),
      scrollTop: Math.round(app.scoreView.scroll.scrollTop),
    };
  };
  const stepSnapshots: Record<string, Record<string, unknown>> = {};

  const steps: Array<{ label: string; run: () => Promise<void> }> = [
    { label: 'Empty state', run: reset },
    {
      label: 'Dragging a PDF over the app',
      run: async () => {
        shell().dispatchEvent(dragEvent('dragenter'));
        shell().dispatchEvent(dragEvent('dragover'));
        await nextFrame();
      },
    },
    {
      label: 'Demo score loaded',
      run: async () => {
        shell().dispatchEvent(dragEvent('dragleave'));
        await controller.loadDemo();
        await waitFor(() => !!q('.page[data-rendered="true"]'));
        await settled();
      },
    },
    {
      label: 'Playing (playhead at bar 3)',
      run: async () => {
        controller.seekToMeasure(2);
        await controller.play();
        await settled();
      },
    },
    {
      label: 'Track 2 muted, track 1 gain 40%',
      run: async () => {
        q<HTMLButtonElement>('[data-action="mute"][data-track="track-2"]')?.click();
        const fader = q<HTMLInputElement>('[data-control="track-gain"][data-track="track-1"]');
        if (fader) {
          fader.value = '0.4';
          fire(fader, 'input');
        }
        await settled();
      },
    },
    {
      label: 'Tempo 140',
      run: async () => {
        const tempo = q<HTMLInputElement>('[data-control="tempo"]');
        if (tempo) {
          tempo.value = '140';
          fire(tempo, 'input');
        }
        await settled();
      },
    },
    {
      label: 'Seeked to bar 6 by clicking measure',
      run: async () => {
        q<HTMLButtonElement>('[data-measure="5"]')?.click();
        await settled();
      },
    },
    {
      label: 'Zoomed in to 200%: the view follows the playhead sideways',
      run: async () => {
        controller.seekToMeasure(5);
        if (!store.getState().transport.playing) await controller.play();
        chooseZoom('2');
        await waitFor(rerendered);
        await settled();
      },
    },
    {
      label: 'Zoomed out to 50%, auto-scroll off',
      run: async () => {
        chooseZoom('0.5');
        setFollow(false);
        await waitFor(rerendered);
        await settled();
      },
    },
    {
      label: 'Ctrl+wheel, three notches over bar 6: zoomed in around the pointer',
      run: async () => {
        const scroll = app.scoreView.scroll;
        const view = scroll.getBoundingClientRect();
        const bar = q<HTMLElement>('[data-measure="5"]')?.getBoundingClientRect();
        const x = Math.min(view.right - 20, Math.max(view.left + 20, bar ? bar.left + bar.width / 2 : view.left + view.width / 2));
        const y = Math.min(view.bottom - 20, Math.max(view.top + 20, bar ? bar.top + bar.height / 2 : view.top + view.height / 2));
        wheelZoom(scroll, x, y, 3);
        await waitFor(rerendered);
        await settled();
      },
    },
    {
      label: 'Pinch gesture: two fingers spread to 150%',
      run: async () => {
        pinchZoom(app.scoreView.scroll, 1.5 / app.scoreView.getScale());
        await waitFor(rerendered);
        await settled();
      },
    },
    {
      label: 'Parse warnings expanded',
      run: async () => {
        chooseZoom('fit-width');
        setFollow(true);
        controller.pause();
        q<HTMLButtonElement>('[data-action="toggle-warnings"]')?.click();
        await waitFor(rerendered);
        await nextFrame();
      },
    },
    {
      label: 'Error banner',
      run: async () => {
        const toggle = q<HTMLButtonElement>('[data-action="toggle-warnings"]');
        if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
        chooseFile('corrupt-download.pdf', 0);
        await waitFor(() => store.getState().status === 'error');
        await settled();
      },
    },
    {
      label: 'Orchestral score: 24 pages, 6 tracks, seeked to page 13',
      run: async () => {
        q<HTMLButtonElement>('[data-action="dismiss-error"]')?.click();
        chooseFile('Sinfonia in G - full score.pdf', 4096);
        await waitFor(() => store.getState().status === 'ready' && !!q('.page[data-rendered="true"]'));
        q<HTMLButtonElement>('[data-measure="96"]')?.click();
        await waitFor(() => !!q('.page[data-page="12"][data-rendered="true"]'));
        await wait(450);
        await settled();
      },
    },
    {
      label: 'Scanned PDF rejected',
      run: async () => {
        chooseFile('scanned-score.pdf', 16);
        await waitFor(() => store.getState().status === 'error');
        await settled();
      },
    },
  ];

  const required = [
    '[data-action="toggle-play"]',
    '[data-action="stop"]',
    '[data-control="seek"]',
    '[data-control="tempo"]',
    '[data-control="track-gain"]',
    '[data-action="mute"]',
    '[data-action="solo"]',
    '[data-role="score-view"]',
    '[data-control="zoom"]',
    '[data-action="zoom-in"]',
    '[data-action="zoom-out"]',
    '[data-action="toggle-follow"]',
    'input[type="file"]',
  ];

  return {
    name: 'ui',
    steps: steps.map((s) => s.label),
    async runStep(index) {
      const step = steps[index];
      if (!step) throw new Error(`No step ${index}`);
      await step.run();
      stepSnapshots[`${index}:${step.label}`] = snapshot();
    },
    getDiagnostics() {
      const state: AppState = store.getState();
      const requiredAttributes: Record<string, boolean> = {};
      for (const selector of required) requiredAttributes[selector] = !!q(selector);
      const scoreDependent = ['[data-control="track-gain"]', '[data-action="mute"]', '[data-action="solo"]'];
      const allPresent = required.every((s) => requiredAttributes[s] || (!state.score && scoreDependent.includes(s)));
      const playhead = q<HTMLElement>('.playhead');
      const render = app.scoreView.getRenderStats();
      return {
        implemented: true,
        status: state.status,
        fileName: state.fileName,
        error: state.error,
        transport: {
          playing: state.transport.playing,
          positionQn: +state.transport.positionQn.toFixed(3),
          tempoBpm: state.transport.tempoBpm,
          masterGain: state.transport.masterGain,
          tracks: state.transport.tracks.map((t) => ({ ...t, level: +t.level.toFixed(3) })),
        },
        positionText: q('[data-role="position"]')?.textContent ?? '',
        counts: {
          pages: root.querySelectorAll('.page').length,
          renderedPages: root.querySelectorAll('.page[data-rendered="true"]').length,
          canvases: root.querySelectorAll('canvas').length,
          measureHits: root.querySelectorAll('.measure-hit').length,
          mixerStrips: root.querySelectorAll('.strip').length,
          trackGainControls: root.querySelectorAll('[data-control="track-gain"]').length,
          activeNoteHighlights: root.querySelectorAll('.note-highlight:not([hidden])').length,
          warnings: state.score?.warnings.length ?? 0,
          domNodes: root.querySelectorAll('*').length,
        },
        render: { ...render, bitmapMB: +(render.bitmapBytes / 1048576).toFixed(1) },
        zoom: app.scoreView.getZoom(),
        following: app.scoreView.isFollowing(),
        mixer: app.mixer.getOverflow(),
        playheadVisible: !!playhead && !playhead.hidden,
        errorBannerVisible: !(q<HTMLElement>('[data-role="error-banner"]')?.hidden ?? true),
        errorCardVisible: !(q<HTMLElement>('[data-role="error-state"]')?.hidden ?? true),
        requiredAttributes,
        allRequiredPresent: allPresent,
        stepSnapshots,
      };
    },
  };
}
