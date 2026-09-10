import './showcase.css';
import type { AudioEngine, ScheduledNote, Showcase } from '../core/contracts';
import { createDemoScore } from '../core/demoScore';
import type { NoteEvent, ScoreModel, TrackMixState, TransportState } from '../core/types';
import { midiToName, qnToSeconds } from '../core/types';
import { type AudioEngineInternals, createAudioEngine } from './engine';
import { anySolo, dbToMeter, effectiveTrackGain, gainToDb } from './mix';
import { loadBundledPiano } from './piano';
import { SCHEDULER } from './scheduler';

const TRACK_COLORS = ['#4cc2ff', '#ffb454', '#57d38c', '#ff6b6b', '#c084fc', '#f472b6'];
const OFFLINE_RANGE = { fromQn: 0, toQn: 6, tempoBpm: 120, sampleRate: 22050 } as const;
const LOG_ROWS = 12;
const CONTRACT_METHODS: (keyof AudioEngine)[] = [
  'load',
  'play',
  'pause',
  'stop',
  'seek',
  'setTempo',
  'setMasterGain',
  'setTrackGain',
  'setTrackMuted',
  'setTrackSolo',
  'getState',
  'subscribe',
  'getScheduledLog',
  'clearScheduledLog',
  'renderOffline',
  'dispose',
];

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};
const setPressed = (node: HTMLElement, on: boolean): void => {
  const value = on ? 'true' : 'false';
  if (node.getAttribute('aria-pressed') !== value) node.setAttribute('aria-pressed', value);
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settled = async (): Promise<void> => {
  await nextFrame();
  await nextFrame();
};
const round = (value: number, digits = 3): number => +value.toFixed(digits);

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatDb(gain: number): string {
  const db = gainToDb(gain);
  return db === -Infinity ? '-inf dB' : `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

interface PositionInfo {
  bar: number;
  beat: number;
  pass: number;
  clock: string;
  total: string;
}

function describePosition(score: ScoreModel, qn: number, tempo: number): PositionInfo {
  const segments = score.timeline;
  let index = segments.findIndex((s) => qn < s.startQn + s.durationQn);
  if (index < 0) index = segments.length - 1;
  const segment = segments[index];
  return {
    bar: segment ? segment.measure + 1 : 1,
    beat: segment ? Math.floor(Math.max(0, qn - segment.startQn)) + 1 : 1,
    pass: segment && score.measures.length ? Math.floor(index / score.measures.length) + 1 : 1,
    clock: formatClock(qnToSeconds(qn, tempo)),
    total: formatClock(qnToSeconds(score.durationQn, tempo)),
  };
}

interface Fitted {
  w: number;
  h: number;
  ctx: CanvasRenderingContext2D;
}

function fitCanvas(canvas: HTMLCanvasElement): Fitted | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (w === 0 || hgt === 0) return null;
  const bw = Math.round(w * dpr);
  const bh = Math.round(hgt * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h: hgt, ctx };
}

const noteKey = (trackId: string, midi: number, qn: number): string => `${trackId}:${midi}:${qn.toFixed(2)}`;

interface TimelineModel {
  notes: Array<{ note: NoteEvent; trackIndex: number; key: string }>;
  minMidi: number;
  maxMidi: number;
}

function buildTimelineModel(score: ScoreModel): TimelineModel {
  const notes: TimelineModel['notes'] = [];
  let minMidi = 127;
  let maxMidi = 0;
  score.tracks.forEach((track, trackIndex) => {
    for (const note of track.notes) {
      notes.push({ note, trackIndex, key: noteKey(track.id, note.midi, note.startQn) });
      minMidi = Math.min(minMidi, note.midi);
      maxMidi = Math.max(maxMidi, note.midi);
    }
  });
  if (notes.length === 0) {
    minMidi = 48;
    maxMidi = 72;
  }
  return { notes, minMidi: minMidi - 2, maxMidi: maxMidi + 2 };
}

function drawTimeline(
  canvas: HTMLCanvasElement,
  score: ScoreModel,
  model: TimelineModel,
  state: TransportState,
  scheduled: Set<string>,
): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { w, h, ctx } = fit;
  const padL = 36;
  const padR = 12;
  const padT = 22;
  const padB = 8;
  const span = Math.max(score.durationQn, 1e-6);
  const x = (qn: number): number => padL + (qn / span) * (w - padL - padR);
  const rows = model.maxMidi - model.minMidi + 1;
  const rowH = (h - padT - padB) / rows;
  const y = (midi: number): number => padT + (model.maxMidi - midi) * rowH;
  const soloActive = anySolo(state.tracks);
  const pos = state.positionQn;

  ctx.clearRect(0, 0, w, h);
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';

  const measureCount = Math.max(1, score.measures.length);
  score.timeline.forEach((segment, i) => {
    const x0 = x(segment.startQn);
    const x1 = x(segment.startQn + segment.durationQn);
    const secondPass = Math.floor(i / measureCount) > 0;
    ctx.fillStyle = secondPass ? 'rgba(255, 180, 84, 0.035)' : 'rgba(255, 255, 255, 0.02)';
    if (i % 2 === 1 || secondPass) ctx.fillRect(x0, padT, x1 - x0, h - padT - padB);
    ctx.strokeStyle = i % measureCount === 0 ? 'rgba(255, 180, 84, 0.55)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, padT - 4);
    ctx.lineTo(Math.round(x0) + 0.5, h - padB);
    ctx.stroke();
    ctx.fillStyle = '#98a2b3';
    ctx.fillText(String(segment.measure + 1), x0 + 4, 13);
  });
  if (score.timeline.length > measureCount) {
    const repeatX = x(score.timeline[measureCount].startQn);
    ctx.fillStyle = '#ffb454';
    ctx.fillText('repeat', repeatX + 4, padT - 9 + 6);
  }

  for (let midi = Math.ceil(model.minMidi / 12) * 12; midi <= model.maxMidi; midi += 12) {
    const yy = Math.round(y(midi) + rowH / 2) + 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#98a2b3';
    ctx.fillText(midiToName(midi), 4, yy + 3);
  }

  for (const { note, trackIndex, key } of model.notes) {
    const mix = state.tracks[trackIndex];
    const silenced = mix ? effectiveTrackGain(mix, soloActive) === 0 : false;
    const sounding = note.startQn <= pos && pos < note.startQn + note.durationQn;
    const isScheduled = scheduled.has(key);
    const color = TRACK_COLORS[trackIndex % TRACK_COLORS.length];
    const x0 = x(note.startQn);
    const width = Math.max(2, x(note.startQn + note.durationQn) - x0 - 1.5);
    const y0 = y(note.midi) + 0.5;
    const height = Math.max(2, rowH - 1);
    ctx.globalAlpha = silenced ? 0.2 : 1;
    if (isScheduled) {
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, width, height);
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha = silenced ? 0.08 : 0.16;
      ctx.fillRect(x0, y0, width, height);
      ctx.globalAlpha = silenced ? 0.25 : 0.7;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
    }
    if (sounding && !silenced && state.playing) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0, y0, width, height);
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;

  const px = Math.round(x(pos)) + 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, padT - 6);
  ctx.lineTo(px, h - padB);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(px - 5, padT - 12);
  ctx.lineTo(px + 5, padT - 12);
  ctx.lineTo(px, padT - 5);
  ctx.closePath();
  ctx.fill();
}

function drawPlaceholder(fit: Fitted, text: string): void {
  const { w, h, ctx } = fit;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(h / 2) + 0.5);
  ctx.lineTo(w, Math.round(h / 2) + 0.5);
  ctx.stroke();
  ctx.fillStyle = '#98a2b3';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  ctx.fillText(text, 8, 14);
}

function drawScope(canvas: HTMLCanvasElement, analyser: AnalyserNode | undefined, buffer: Float32Array<ArrayBuffer>): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  if (!analyser) {
    drawPlaceholder(fit, 'oscilloscope: AudioContext is created on first play()');
    return;
  }
  const { w, h, ctx } = fit;
  analyser.getFloatTimeDomainData(buffer);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(h / 2) + 0.5);
  ctx.lineTo(w, Math.round(h / 2) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#4cc2ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const n = buffer.length;
  for (let i = 0; i < n; i++) {
    const xx = (i / (n - 1)) * w;
    const yy = h / 2 - buffer[i] * (h / 2) * 0.95;
    if (i === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
  ctx.fillStyle = '#98a2b3';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  ctx.fillText('master bus · time domain', 8, 14);
}

function drawSpectrum(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode | undefined,
  sampleRate: number,
  bytes: Uint8Array<ArrayBuffer>,
): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  if (!analyser) {
    drawPlaceholder(fit, 'spectrum: AudioContext is created on first play()');
    return;
  }
  const { w, h, ctx } = fit;
  analyser.getByteFrequencyData(bytes);
  ctx.clearRect(0, 0, w, h);
  const bars = 72;
  const fMin = 40;
  const fMax = Math.min(12000, sampleRate / 2);
  const binHz = sampleRate / 2 / bytes.length;
  const gap = 2;
  const barW = (w - gap * (bars - 1)) / bars;
  for (let i = 0; i < bars; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / bars);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
    const b0 = Math.max(0, Math.floor(f0 / binHz));
    const b1 = Math.min(bytes.length - 1, Math.max(b0, Math.ceil(f1 / binHz) - 1));
    let peak = 0;
    for (let b = b0; b <= b1; b++) peak = Math.max(peak, bytes[b]);
    const v = peak / 255;
    const barH = Math.max(1, v * (h - 18));
    ctx.fillStyle = v > 0.75 ? '#ffb454' : '#4cc2ff';
    ctx.globalAlpha = 0.35 + v * 0.65;
    ctx.fillRect(i * (barW + gap), h - barH, barW, barH);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#98a2b3';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
  ctx.fillText('master bus · spectrum 40 Hz – 12 kHz (log)', 8, 14);
}

interface WaveLayer {
  buffer: AudioBuffer;
  color: string;
  label: string;
}

function drawWaveforms(canvas: HTMLCanvasElement, layers: WaveLayer[]): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { w, h, ctx } = fit;
  if (layers.length === 0) {
    drawPlaceholder(fit, 'offline render: run the "Offline render" step');
    return;
  }
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const seconds = Math.max(...layers.map((l) => l.buffer.duration));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(mid) + 0.5);
  ctx.lineTo(w, Math.round(mid) + 0.5);
  ctx.stroke();
  ctx.fillStyle = '#98a2b3';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (let t = 0; t <= seconds; t += 0.5) {
    const xx = Math.round((t / seconds) * w) + 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(xx, 0);
    ctx.lineTo(xx, h);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(1)}s`, xx + 3, h - 4);
  }
  layers.forEach((layer, index) => {
    const data = layer.buffer.getChannelData(0);
    const scale = layer.buffer.duration / seconds;
    const columns = Math.floor(w * scale);
    const perColumn = data.length / Math.max(1, columns);
    ctx.fillStyle = layer.color;
    ctx.globalAlpha = index === 0 ? 0.85 : 0.75;
    for (let c = 0; c < columns; c++) {
      const start = Math.floor(c * perColumn);
      const end = Math.min(data.length, Math.floor((c + 1) * perColumn));
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const top = mid - max * (mid - 14);
      const bottom = mid - min * (mid - 14);
      ctx.fillRect(c, top, 1, Math.max(1, bottom - top));
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
    ctx.fillText(layer.label, 8 + index * 190, 14);
  });
}

function peakDb(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return gainToDb(peak);
}

/** Largest left/right sample difference: 0 means the render is mono. */
function stereoWidth(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 0;
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  let max = 0;
  for (let i = 0; i < l.length; i++) {
    const d = Math.abs(l[i] - r[i]);
    if (d > max) max = d;
  }
  return max;
}

function rms(buffer: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 2) {
      sum += data[i] * data[i];
      n++;
    }
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Verifier-style onset count: 20 ms energy windows that jump by 1.8x over a floor. */
function countOnsets(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const win = Math.floor(buffer.sampleRate * 0.02);
  let previous = 0;
  let onsets = 0;
  for (let i = 0; i + win < data.length; i += win) {
    let energy = 0;
    for (let j = i; j < i + win; j++) energy += data[j] * data[j];
    energy = Math.sqrt(energy / win);
    if (energy > previous * 1.8 && energy > 0.01) onsets++;
    previous = energy;
  }
  return onsets;
}

/** Spectral centroid (Hz) of a Hann-windowed 2048-sample frame via a direct DFT; small enough to run once per step. */
function spectralCentroid(buffer: AudioBuffer, fromSeconds: number): number {
  const n = 2048;
  const data = buffer.getChannelData(0);
  const start = Math.min(Math.max(0, Math.floor(fromSeconds * buffer.sampleRate)), Math.max(0, data.length - n));
  const frame = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    frame[i] = (data[start + i] ?? 0) * window;
  }
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    const step = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      re += frame[i] * Math.cos(step * i);
      im += frame[i] * Math.sin(step * i);
    }
    const magnitude = Math.sqrt(re * re + im * im);
    weighted += magnitude * ((k * buffer.sampleRate) / n);
    total += magnitude;
  }
  return total > 0 ? weighted / total : 0;
}

function correlation(a: AudioBuffer, b: AudioBuffer): number {
  const x = a.getChannelData(0);
  const y = b.getChannelData(0);
  const n = Math.min(x.length, y.length);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    syy += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.005) return 'pan C';
  return `pan ${pan > 0 ? 'R' : 'L'} ${Math.round(Math.abs(pan) * 100)}%`;
}

interface StripRefs {
  root: HTMLElement;
  cover: HTMLElement;
  fader: HTMLInputElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
  db: HTMLElement;
  level: HTMLElement;
}

export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  const score = createDemoScore();
  const engine: AudioEngineInternals = createAudioEngine({ samples: loadBundledPiano() });
  engine.load(score);
  if (window.__smr) window.__smr.engine = engine;

  const model = buildTimelineModel(score);
  const scopeBuffer = new Float32Array(2048);
  const spectrumBuffer = new Uint8Array(1024);
  let scheduledKeys = new Set<string>();
  let lastLogLength = -1;
  let lastLogTail: ScheduledNote | undefined;
  let seeking = false;
  let offlineLayers: WaveLayer[] = [];
  let timbreLayers: WaveLayer[] = [];
  let offlineResult: Record<string, unknown> | null = null;
  let timbreResult: Record<string, unknown> | null = null;
  const stepSnapshots: Record<string, Record<string, unknown>> = {};

  const badgeContext = h('span', { class: 'badge', 'data-role': 'context-state' });
  const badgePlaying = h('span', { class: 'badge', 'data-role': 'transport-state' });
  const badgeVoices = h('span', { class: 'badge', 'data-role': 'voice-count' });
  const badgeScheduler = h('span', { class: 'badge badge-quiet', 'data-role': 'clock' });
  let heldChaseResult: Record<string, unknown> | null = null;

  const playButton = h('button', { type: 'button', class: 'au-btn au-btn-primary', 'data-action': 'toggle-play', 'aria-label': 'Play' });
  const stopButton = h('button', { type: 'button', class: 'au-btn', 'data-action': 'stop', text: 'Stop' });
  const positionText = h('span', { class: 'au-readout-main', 'data-role': 'position' });
  const clockText = h('span', { class: 'au-readout-sub', 'data-role': 'clock' });
  const qnText = h('span', { class: 'au-readout-sub', 'data-role': 'position-qn' });
  const seek = h('input', { type: 'range', class: 'au-slider au-seek', 'data-control': 'seek', min: 0, max: score.durationQn, step: 0.01, value: 0, 'aria-label': 'Seek' });
  const tempo = h('input', { type: 'range', class: 'au-slider', 'data-control': 'tempo', min: 30, max: 240, step: 1, value: score.tempoBpm, 'aria-label': 'Tempo' });
  const tempoValue = h('span', { class: 'au-value', 'data-role': 'tempo-value' });
  const master = h('input', { type: 'range', class: 'au-slider', 'data-control': 'master-gain', min: 0, max: 1, step: 0.01, value: 0.9, 'aria-label': 'Master volume' });
  const masterValue = h('span', { class: 'au-value', 'data-role': 'master-value' });

  const timelineCanvas = h('canvas', { class: 'au-canvas au-canvas-timeline', 'data-role': 'timeline' });
  const scopeCanvas = h('canvas', { class: 'au-canvas au-canvas-scope', 'data-role': 'oscilloscope' });
  const spectrumCanvas = h('canvas', { class: 'au-canvas au-canvas-scope', 'data-role': 'spectrum' });
  const offlineCanvas = h('canvas', { class: 'au-canvas au-canvas-wave', 'data-role': 'offline-wave' });
  const timbreCanvas = h('canvas', { class: 'au-canvas au-canvas-wave', 'data-role': 'timbre-wave' });
  const offlineText = h('p', { class: 'au-note', 'data-role': 'offline-summary', text: 'Not rendered yet.' });
  const timbreText = h('p', { class: 'au-note', 'data-role': 'timbre-summary', text: 'Not rendered yet.' });
  const logBody = h('tbody', { 'data-role': 'scheduled-log' });
  const logCount = h('span', { class: 'au-count', 'data-role': 'scheduled-count' });

  const strips = new Map<string, StripRefs>();
  const stripsHost = h('div', { class: 'au-strips' });
  score.tracks.forEach((track, index) => {
    const color = TRACK_COLORS[index % TRACK_COLORS.length];
    const cover = h('div', { class: 'meter-cover' });
    const level = h('span', { class: 'strip-level', text: '-inf' });
    const fader = h('input', { type: 'range', class: 'fader', 'data-control': 'track-gain', 'data-track': track.id, min: 0, max: 1, step: 0.01, value: track.defaultGain, 'aria-label': `${track.name} gain` });
    const mute = h('button', { type: 'button', class: 'strip-btn strip-mute', 'data-action': 'mute', 'data-track': track.id, 'aria-pressed': 'false', 'aria-label': `Mute ${track.name}`, text: 'M' });
    const solo = h('button', { type: 'button', class: 'strip-btn strip-solo', 'data-action': 'solo', 'data-track': track.id, 'aria-pressed': 'false', 'aria-label': `Solo ${track.name}`, text: 'S' });
    const db = h('span', { class: 'strip-db', text: formatDb(track.defaultGain) });
    const stripRoot = h('div', { class: 'strip', 'data-track': track.id }, [
      h('div', { class: 'strip-head' }, [
        h('span', { class: 'strip-swatch' }),
        h('span', { class: 'strip-name', text: track.name }),
        h('span', { class: 'strip-meta', text: `${track.instrument} · ${track.clef} · ${track.notes.length} notes` }),
        h('span', { class: 'strip-pan', text: formatPan(engine.getPans()[track.id] ?? 0) }),
      ]),
      h('div', { class: 'strip-body' }, [
        h('div', { class: 'meter', role: 'meter', 'aria-label': `${track.name} level` }, [cover, h('div', { class: 'meter-ticks' })]),
        h('div', { class: 'fader-wrap' }, [fader]),
      ]),
      h('div', { class: 'strip-foot' }, [h('div', { class: 'strip-buttons' }, [mute, solo]), db, level]),
    ]);
    stripRoot.style.setProperty('--track-color', color);
    fader.addEventListener('input', () => engine.setTrackGain(track.id, Number(fader.value)));
    mute.addEventListener('click', () => {
      const state = engine.getState().tracks.find((t) => t.trackId === track.id);
      engine.setTrackMuted(track.id, !(state?.muted ?? false));
    });
    solo.addEventListener('click', () => {
      const state = engine.getState().tracks.find((t) => t.trackId === track.id);
      engine.setTrackSolo(track.id, !(state?.solo ?? false));
    });
    strips.set(track.id, { root: stripRoot, cover, fader, mute, solo, db, level });
    stripsHost.append(stripRoot);
  });

  const legend = h(
    'div',
    { class: 'au-legend' },
    score.tracks.map((track, index) => {
      const item = h('span', { class: 'legend-item' }, [h('span', { class: 'legend-swatch' }), track.name]);
      item.style.setProperty('--track-color', TRACK_COLORS[index % TRACK_COLORS.length]);
      return item;
    }),
  );
  legend.append(
    h('span', { class: 'legend-item legend-hint' }, [h('span', { class: 'legend-swatch legend-swatch-filled' }), 'scheduled on the audio clock']),
    h('span', { class: 'legend-item legend-hint' }, [h('span', { class: 'legend-swatch legend-swatch-outline' }), 'not yet scheduled']),
  );

  const scene = h('div', { class: 'smr-audio' }, [
    h('header', { class: 'au-header' }, [
      h('div', { class: 'au-title' }, [
        h('h1', { text: 'Audio engine' }),
        h('p', { text: `${score.title ?? 'Demo score'} · ${score.tracks.length} tracks · ${score.durationQn} qn · ${score.timeSignatures[0]?.beats ?? 4}/${score.timeSignatures[0]?.beatType ?? 4}` }),
      ]),
      h('div', { class: 'au-badges' }, [badgeContext, badgePlaying, badgeVoices, badgeScheduler]),
    ]),
    h('section', { class: 'au-transport' }, [
      h('div', { class: 'au-buttons' }, [playButton, stopButton]),
      h('div', { class: 'au-readout' }, [positionText, h('span', { class: 'au-readout-row' }, [clockText, qnText])]),
      h('label', { class: 'au-control au-control-seek' }, [h('span', { class: 'au-label', text: 'Seek' }), seek]),
      h('label', { class: 'au-control' }, [h('span', { class: 'au-label', text: 'Tempo' }), tempo, tempoValue]),
      h('label', { class: 'au-control' }, [h('span', { class: 'au-label', text: 'Master' }), master, masterValue]),
    ]),
    h('main', { class: 'au-main' }, [
      h('div', { class: 'au-column' }, [
        h('section', { class: 'panel' }, [
          h('div', { class: 'panel-head' }, [h('h2', { text: 'Timeline' }), legend]),
          timelineCanvas,
        ]),
        h('section', { class: 'panel panel-scopes' }, [scopeCanvas, spectrumCanvas]),
        h('section', { class: 'panel' }, [
          h('div', { class: 'panel-head' }, [h('h2', { text: 'Offline render · first 6 qn at 120 bpm, 22.05 kHz' })]),
          offlineCanvas,
          offlineText,
        ]),
        h('section', { class: 'panel' }, [
          h('div', { class: 'panel-head' }, [h('h2', { text: 'Timbres · track 1 rendered as piano and as strings' })]),
          timbreCanvas,
          timbreText,
        ]),
      ]),
      h('div', { class: 'au-column au-column-side' }, [
        h('section', { class: 'panel' }, [h('div', { class: 'panel-head' }, [h('h2', { text: 'Mixer' })]), stripsHost]),
        h('section', { class: 'panel panel-log' }, [
          h('div', { class: 'panel-head' }, [h('h2', { text: 'Scheduled notes' }), logCount]),
          h('div', { class: 'log-scroll' }, [
            h('table', { class: 'log-table' }, [
              h('thead', {}, [
                h('tr', {}, [
                  h('th', { text: 'time' }),
                  h('th', { text: 'qn' }),
                  h('th', { text: 'track' }),
                  h('th', { text: 'note' }),
                  h('th', { text: 'dur' }),
                  h('th', { text: 'gain' }),
                ]),
              ]),
              logBody,
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
  root.replaceChildren(scene);

  playButton.addEventListener('click', () => {
    if (engine.getState().playing) engine.pause();
    else void engine.play();
  });
  stopButton.addEventListener('click', () => engine.stop());
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  seek.addEventListener('pointerup', () => {
    seeking = false;
  });
  seek.addEventListener('input', () => engine.seek(Number(seek.value)));
  tempo.addEventListener('input', () => engine.setTempo(Number(tempo.value)));
  master.addEventListener('input', () => engine.setMasterGain(Number(master.value)));

  const emptyRow = h('tr', { class: 'log-empty' }, [h('td', { colspan: 6, text: 'Nothing scheduled yet — press Play.' })]);
  const logRows = Array.from({ length: LOG_ROWS }, () => {
    const cells = Array.from({ length: 6 }, (_, i) => h('td', { class: i === 2 ? 'log-track' : undefined }));
    return { row: h('tr', {}, cells), cells };
  });

  function renderLog(log: ScheduledNote[]): void {
    const tail = log[log.length - 1];
    if (log.length === lastLogLength && tail === lastLogTail) return;
    lastLogLength = log.length;
    lastLogTail = tail;
    scheduledKeys = new Set(log.map((n) => noteKey(n.trackId, n.midi, n.qn)));
    setText(logCount, `${log.length} since load`);
    const entries = log.slice(-LOG_ROWS).reverse();
    if (entries.length === 0) {
      logBody.replaceChildren(emptyRow);
      return;
    }
    const rows = entries.map((entry, i) => {
      const { row, cells } = logRows[i];
      const trackIndex = score.tracks.findIndex((t) => t.id === entry.trackId);
      setText(cells[0], entry.time.toFixed(3));
      setText(cells[1], entry.qn.toFixed(2));
      setText(cells[2], score.tracks[trackIndex]?.name ?? entry.trackId);
      setText(cells[3], `${midiToName(entry.midi)} (${entry.midi})`);
      setText(cells[4], `${Math.round(entry.durationSeconds * 1000)} ms`);
      setText(cells[5], entry.gain.toFixed(3));
      row.style.setProperty('--track-color', TRACK_COLORS[(trackIndex < 0 ? 0 : trackIndex) % TRACK_COLORS.length]);
      return row;
    });
    if (rows.length !== logBody.children.length || rows.some((row, i) => logBody.children[i] !== row)) logBody.replaceChildren(...rows);
  }

  function renderStrip(refs: StripRefs, state: TrackMixState, soloActive: boolean): void {
    const silenced = effectiveTrackGain(state, soloActive) === 0;
    refs.root.classList.toggle('is-silenced', silenced);
    refs.root.classList.toggle('is-muted', state.muted);
    refs.root.classList.toggle('is-solo', state.solo);
    setPressed(refs.mute, state.muted);
    setPressed(refs.solo, state.solo);
    if (document.activeElement !== refs.fader && Math.abs(Number(refs.fader.value) - state.gain) > 0.004) refs.fader.value = String(state.gain);
    setText(refs.db, formatDb(state.gain));
    const meter = dbToMeter(gainToDb(state.level));
    refs.cover.style.transform = `scaleY(${(1 - meter).toFixed(3)})`;
    setText(refs.level, state.level > 0 ? `${gainToDb(state.level).toFixed(0)} dB` : '-inf');
  }

  function render(state: TransportState): void {
    const info = describePosition(score, state.positionQn, state.tempoBpm);
    setText(positionText, `bar ${info.bar} · beat ${info.beat}${info.pass > 1 ? ' · 2nd time' : ''}`);
    setText(clockText, `${info.clock} / ${info.total}`);
    setText(qnText, `${state.positionQn.toFixed(2)} qn`);
    if (!seeking) seek.value = String(state.positionQn);
    if (document.activeElement !== tempo) tempo.value = String(state.tempoBpm);
    setText(tempoValue, `${Math.round(state.tempoBpm)} bpm`);
    if (document.activeElement !== master) master.value = String(state.masterGain);
    setText(masterValue, formatDb(state.masterGain));
    setText(playButton, state.playing ? 'Pause' : 'Play');
    playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    setPressed(playButton, state.playing);
    setText(badgeContext, `context: ${state.contextState}`);
    badgeContext.dataset.state = state.contextState;
    const transport = state.playing ? 'playing' : state.contextState === 'none' ? 'idle' : 'paused';
    setText(badgePlaying, transport);
    badgePlaying.dataset.state = transport;
    setText(badgeVoices, `voices: ${engine.getVoiceCount()}`);
    const clock = engine.getClockInfo();
    setText(
      badgeScheduler,
      `clock: ${clock.ticker === 'none' ? 'idle' : clock.ticker}${clock.hidden ? ' (hidden tab)' : ''} · lookahead ${Math.round(clock.horizonSeconds * 1000)} ms · tick ${SCHEDULER.tickMs} ms · piano: ${describePiano()}`,
    );
    const soloActive = anySolo(state.tracks);
    for (const track of state.tracks) {
      const refs = strips.get(track.trackId);
      if (refs) renderStrip(refs, track, soloActive);
    }
    renderLog(engine.getScheduledLog());
    drawTimeline(timelineCanvas, score, model, state, scheduledKeys);
    const analyser = engine.getMasterAnalyser();
    const sampleRate = engine.getContext()?.sampleRate ?? 44100;
    drawScope(scopeCanvas, analyser, scopeBuffer);
    drawSpectrum(spectrumCanvas, analyser, sampleRate, spectrumBuffer);
  }

  const describePiano = (): string => {
    const piano = engine.getPianoSamples();
    if (!piano.settled) return 'loading samples';
    return piano.loaded > 0 ? `${piano.loaded} samples` : 'synth (samples unavailable)';
  };

  const redraw = (): void => render(engine.getState());
  engine.subscribe(render);
  window.addEventListener('resize', () => {
    redraw();
    drawWaveforms(offlineCanvas, offlineLayers);
    drawWaveforms(timbreCanvas, timbreLayers);
  });
  await nextFrame();
  redraw();
  drawWaveforms(offlineCanvas, offlineLayers);
  drawWaveforms(timbreCanvas, timbreLayers);

  const snapshot = (): Record<string, unknown> => {
    const state = engine.getState();
    return {
      contextState: state.contextState,
      playing: state.playing,
      positionQn: round(state.positionQn),
      tempoBpm: state.tempoBpm,
      masterGain: state.masterGain,
      scheduled: engine.getScheduledLog().length,
      voices: engine.getVoiceCount(),
      tracks: state.tracks.map((t) => ({ id: t.trackId, gain: t.gain, muted: t.muted, solo: t.solo, level: round(t.level) })),
      positionText: positionText.textContent,
      pianoSamples: engine.getPianoSamples(),
    };
  };

  const resetMix = (): void => {
    for (const track of score.tracks) {
      engine.setTrackSolo(track.id, false);
      engine.setTrackMuted(track.id, false);
      engine.setTrackGain(track.id, track.defaultGain);
    }
    engine.setMasterGain(0.9);
  };

  const ensurePlaying = async (): Promise<void> => {
    if (!engine.getState().playing) await engine.play();
  };

  const steps: Array<{ label: string; run: () => Promise<void> }> = [
    {
      label: 'Engine idle',
      run: async () => {
        engine.stop();
        resetMix();
        engine.setTempo(score.tempoBpm);
        await settled();
      },
    },
    {
      label: 'Playing from start',
      run: async () => {
        engine.stop();
        resetMix();
        engine.setTempo(score.tempoBpm);
        engine.clearScheduledLog();
        await engine.play();
        await wait(650);
        await settled();
      },
    },
    {
      label: 'Seeked to bar 5 while playing',
      run: async () => {
        await ensurePlaying();
        engine.seek(score.measures[4]?.firstStartQn ?? 12);
        await wait(450);
        await settled();
      },
    },
    {
      label: 'Tempo 160',
      run: async () => {
        await ensurePlaying();
        engine.setTempo(160);
        await wait(800);
        await settled();
      },
    },
    {
      label: 'Track 2 muted',
      run: async () => {
        await ensurePlaying();
        engine.setTrackMuted('track-2', true);
        await wait(800);
        await settled();
      },
    },
    {
      label: 'Track 1 solo',
      run: async () => {
        await ensurePlaying();
        engine.setTrackMuted('track-2', false);
        engine.setTrackSolo('track-1', true);
        await wait(800);
        await settled();
      },
    },
    {
      label: 'Paused',
      run: async () => {
        await ensurePlaying();
        await wait(150);
        engine.pause();
        await wait(500);
        await settled();
      },
    },
    {
      label: 'Resumed inside the opening chord (seek 0.5 qn while paused)',
      run: async () => {
        engine.pause();
        resetMix();
        engine.setTempo(score.tempoBpm);
        engine.seek(0.5);
        engine.clearScheduledLog();
        await engine.play();
        const chased = engine.getScheduledLog().filter((n) => n.qn < 0.5);
        heldChaseResult = {
          seekQn: 0.5,
          chased: chased.map((n) => ({ trackId: n.trackId, midi: n.midi, qn: n.qn, durationSeconds: round(n.durationSeconds), gain: round(n.gain) })),
          expected: score.tracks.flatMap((t) => t.notes.filter((n) => n.startQn < 0.5 && n.startQn + n.durationQn > 0.5).map((n) => `${t.id}:${n.midi}`)),
          allHeldNotesChased: score.tracks.every((t) =>
            t.notes.filter((n) => n.startQn < 0.5 && n.startQn + n.durationQn > 0.5).every((n) => chased.some((c) => c.trackId === t.id && c.midi === n.midi && c.qn === n.startQn)),
          ),
        };
        await wait(600);
        await settled();
      },
    },
    {
      label: 'Offline render waveform (first 6 qn)',
      run: async () => {
        resetMix();
        const all = await engine.renderOffline({ ...OFFLINE_RANGE });
        const solo = await engine.renderOffline({ ...OFFLINE_RANGE, trackIds: ['track-1'] });
        offlineLayers = [
          { buffer: all, color: TRACK_COLORS[0], label: `all tracks · RMS ${rms(all).toFixed(4)}` },
          { buffer: solo, color: TRACK_COLORS[1], label: `track 1 only · RMS ${rms(solo).toFixed(4)}` },
        ];
        offlineResult = {
          durationSec: round(all.duration),
          sampleRate: all.sampleRate,
          channels: all.numberOfChannels,
          rmsAll: round(rms(all), 5),
          rmsSolo: round(rms(solo), 5),
          rmsAllDb: round(gainToDb(rms(all)), 1),
          peakAllDb: round(peakDb(all), 1),
          peakSoloDb: round(peakDb(solo), 1),
          stereoWidthAll: round(stereoWidth(all), 4),
          stereoWidthSolo: round(stereoWidth(solo), 4),
          soloToAllRatio: round(rms(solo) / Math.max(1e-9, rms(all))),
          onsetsAll: countOnsets(all),
          expectedOnsets: new Set(score.tracks.flatMap((t) => t.notes.filter((n) => n.startQn < OFFLINE_RANGE.toQn).map((n) => n.startQn.toFixed(3)))).size,
        };
        drawWaveforms(offlineCanvas, offlineLayers);
        setText(
          offlineText,
          `${all.duration.toFixed(2)} s buffer for 6 qn at 120 bpm (3.00 s + release tail) at ${all.sampleRate} Hz · ` +
            `RMS all tracks ${rms(all).toFixed(4)} (${gainToDb(rms(all)).toFixed(1)} dBFS, peak ${peakDb(all).toFixed(1)} dBFS) vs track 1 only ${rms(solo).toFixed(4)} · ` +
            `${countOnsets(all)} onsets detected, ${offlineResult.expectedOnsets} distinct onsets in the score · L/R max difference ${stereoWidth(all).toFixed(3)} (stereo pan: RH right, LH left).`,
        );
        await settled();
      },
    },
    {
      label: 'Timbres: piano vs strings (offline)',
      run: async () => {
        const piano = await engine.renderOffline({ ...OFFLINE_RANGE, trackIds: ['track-1'] });
        const alt = createAudioEngine();
        alt.load({
          ...score,
          tracks: score.tracks.map((t) => (t.id === 'track-1' ? { ...t, instrument: 'strings' as const } : t)),
        });
        const strings = await alt.renderOffline({ ...OFFLINE_RANGE, trackIds: ['track-1'] });
        alt.dispose();
        const analysisAt = 0.25;
        const pianoCentroid = spectralCentroid(piano, analysisAt);
        const stringsCentroid = spectralCentroid(strings, analysisAt);
        const corr = correlation(piano, strings);
        timbreLayers = [
          { buffer: piano, color: TRACK_COLORS[0], label: `piano · centroid ${Math.round(pianoCentroid)} Hz` },
          { buffer: strings, color: TRACK_COLORS[2], label: `strings · centroid ${Math.round(stringsCentroid)} Hz` },
        ];
        timbreResult = {
          piano: { rms: round(rms(piano), 5), centroidHz: Math.round(pianoCentroid) },
          strings: { rms: round(rms(strings), 5), centroidHz: Math.round(stringsCentroid) },
          waveformCorrelation: round(corr, 4),
          distinct: Math.abs(corr) < 0.9,
        };
        drawWaveforms(timbreCanvas, timbreLayers);
        const pianoDescription =
          engine.getPianoSamples().loaded > 0
            ? `piano (Salamander Grand Piano recordings, nearest minor third pitch-shifted, velocity lowpass)`
            : `piano (triangle + decaying partials, 6 ms attack)`;
        setText(
          timbreText,
          `Same notes, two timbres: ${pianoDescription} vs strings (detuned sawtooth pair, 60 ms attack). ` +
            `Spectral centroid ${Math.round(pianoCentroid)} Hz vs ${Math.round(stringsCentroid)} Hz at 250 ms; waveform correlation ${corr.toFixed(3)}.`,
        );
        await settled();
      },
    },
    {
      label: 'Stopped (rewound to 0)',
      run: async () => {
        engine.stop();
        engine.setTempo(score.tempoBpm);
        await wait(300);
        await settled();
      },
    },
  ];

  return {
    name: 'audio',
    steps: steps.map((s) => s.label),
    async runStep(index) {
      const step = steps[index];
      if (!step) throw new Error(`No step ${index}`);
      await step.run();
      redraw();
      stepSnapshots[step.label] = snapshot();
    },
    getDiagnostics() {
      const state = engine.getState();
      const log = engine.getScheduledLog();
      const context = engine.getContext();
      return {
        implemented: true,
        contextState: state.contextState,
        playing: state.playing,
        positionQn: round(state.positionQn),
        tempoBpm: state.tempoBpm,
        masterGain: state.masterGain,
        scheduledLogLength: log.length,
        lastScheduled: log.slice(-5).map((n) => ({
          ...n,
          time: round(n.time),
          durationSeconds: round(n.durationSeconds),
          gain: round(n.gain),
        })),
        tracks: state.tracks.map((t) => ({ ...t, level: round(t.level) })),
        voices: engine.getVoiceCount(),
        offline: offlineResult,
        timbres: timbreResult,
        heldNoteChase: heldChaseResult,
        pans: engine.getPans(),
        clock: engine.getClockInfo(),
        pianoSamples: engine.getPianoSamples(),
        contractMethods: CONTRACT_METHODS.map((name) => ({ name, implemented: typeof engine[name] === 'function' })),
        scheduler: {
          tickMs: SCHEDULER.tickMs,
          horizonMs: SCHEDULER.horizonSeconds * 1000,
          hiddenHorizonMs: SCHEDULER.hiddenHorizonSeconds * 1000,
          sampleRate: context?.sampleRate ?? null,
          baseLatencyMs: context ? round(context.baseLatency * 1000, 1) : null,
        },
        steps: stepSnapshots,
      };
    },
  };
}
