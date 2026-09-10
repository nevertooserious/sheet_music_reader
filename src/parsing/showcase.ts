import type { ScoreDocument, Showcase } from '../core/contracts';
import type { PageInfo, ScoreModel } from '../core/types';
import { analyze, type ParseDebug } from './analyze';
import { compareScoreToReference, type Comparison, type Reference } from './compare';
import { createParser, type ParsingDebug } from './index';
import { parseReferenceMidi } from './midiReference';
import type { PageExtraction, Staff } from './model';
import { buildSyntheticPage, drawSyntheticPage } from './syntheticScene';

const FIXTURE_PDF = `${import.meta.env.BASE_URL}fixtures/bach-minuet-g.pdf`;
const FIXTURE_MID = `${import.meta.env.BASE_URL}fixtures/bach-minuet-g.mid`;

/**
 * ?pdf=<url>&pages=313,324&page=1 stages the scene on another engraved PDF
 * (e.g. a Sibelius export) instead of the bundled fixture; the MIDI comparison
 * step then reports that no reference exists.
 */
const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const SOURCE_PDF = query.get('pdf') || FIXTURE_PDF;
const CUSTOM_SOURCE = SOURCE_PDF !== FIXTURE_PDF;
const SOURCE_PAGES = (query.get('pages') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
const SOURCE_NAME = decodeURIComponent(SOURCE_PDF.split('/').pop() || 'score.pdf');

const TRACK_COLORS = ['#4cc2ff', '#ffb454', '#57d38c', '#ff6b6b', '#c58cff', '#ffd166'];
const KIND_COLORS: Record<string, string> = {
  clef: '#c58cff',
  accidental: '#ffd166',
  rest: '#57d38c',
  dot: '#ff8fab',
  digit: '#4cc2ff',
  flag: '#ffb454',
  timesig: '#4cc2ff',
  brace: '#98a2b3',
  ornament: '#98a2b3',
};

const STEPS = [
  'Page rendered',
  'Staves and systems',
  'Glyphs classified',
  'Notes with pitches and durations',
  'Measures, repeats and timeline',
  'Comparison to reference MIDI',
  'Voltas and tuplets on a synthetic page',
];
const SYNTHETIC_STEP = 6;

const STYLE = `
.psc { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; padding: 16px; height: 100vh; overflow: hidden; }
.psc-stage { position: relative; overflow: auto; background: #0d0f12; border: 1px solid var(--border); border-radius: var(--radius); display: flex; justify-content: center; align-items: flex-start; }
.psc-page { position: relative; margin: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.6); background: #fff; }
.psc-page canvas { display: block; }
.psc-page .psc-overlay { position: absolute; inset: 0; pointer-events: none; }
.psc-panel { overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; font-size: 13px; }
.psc-panel h1 { font-size: 16px; margin: 0 0 4px; }
.psc-panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 16px 0 6px; }
.psc-panel .psc-sub { color: var(--muted); margin-bottom: 8px; }
.psc-step { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--accent); font-weight: 600; font-size: 12px; margin-bottom: 8px; }
.psc-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
.psc-kv dt { color: var(--muted); }
.psc-kv dd { margin: 0; font-variant-numeric: tabular-nums; }
.psc-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.psc-table th, .psc-table td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--border); }
.psc-table th { color: var(--muted); font-weight: 500; }
.psc-ok { color: var(--ok); font-weight: 600; }
.psc-bad { color: var(--danger); font-weight: 600; }
.psc-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.psc-legend span { display: inline-block; margin: 0 10px 4px 0; }
.psc-warn { color: var(--accent-2); }
.psc-error { color: var(--danger); white-space: pre-wrap; }
.psc-muted { color: var(--muted); }
.psc-list { margin: 4px 0 0; padding-left: 18px; }
.psc-current { background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 10px 10px; margin-top: 10px; }
.psc-current h2 { color: var(--accent); margin-top: 10px; }
.psc-earlier { opacity: .75; }
`;

/** What the overlay painters need: a parsed score, its debug geometry and the page it is drawn on. */
interface SceneView {
  score: ScoreModel;
  debug: ParseDebug;
  pageInfo: PageInfo;
}

interface Loaded extends SceneView {
  document: ScoreDocument;
  debug: ParsingDebug;
  fetchMs: number;
}

interface SyntheticScene extends SceneView {
  page: PageExtraction;
  analyzeMs: number;
}

type SceneKind = 'fixture' | 'synthetic';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function kv(pairs: Array<[string, string | number]>): HTMLElement {
  const dl = el('dl', 'psc-kv');
  for (const [k, v] of pairs) {
    dl.append(el('dt', undefined, k), el('dd', undefined, String(v)));
  }
  return dl;
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '–';
}

export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  root.innerHTML = '';
  const style = el('style');
  style.textContent = STYLE;
  root.append(style);
  const wrap = el('div', 'psc');
  const stage = el('div', 'psc-stage');
  const pageBox = el('div', 'psc-page');
  const pageCanvas = el('canvas');
  const overlay = el('canvas', 'psc-overlay');
  pageBox.append(pageCanvas, overlay);
  stage.append(pageBox);
  const panel = el('aside', 'psc-panel');
  wrap.append(stage, panel);
  root.append(wrap);

  const parser = createParser();
  let loaded: Loaded | undefined;
  let loadPromise: Promise<Loaded> | undefined;
  let reference: Reference | undefined;
  let comparison: Comparison | undefined;
  let lastError: string | undefined;
  let currentStep = -1;
  let cssScale = 1;
  let renderedScene: SceneKind | undefined;
  let synthetic: SyntheticScene | undefined;

  const pageIndex = Math.max(0, Number(query.get('page') || 0) || 0);
  const sceneOf = (step: number): SceneKind => (step === SYNTHETIC_STEP ? 'synthetic' : 'fixture');

  const loadSynthetic = (): SyntheticScene => {
    if (!synthetic) {
      const page = buildSyntheticPage();
      const t0 = performance.now();
      const { score, debug } = analyze([page], { fileName: 'synthetic-endings-triplet.pdf' });
      synthetic = { page, score, debug, pageInfo: { index: 0, width: page.width, height: page.height }, analyzeMs: Math.round(performance.now() - t0) };
    }
    return synthetic;
  };

  const load = (): Promise<Loaded> => {
    if (!loadPromise) {
      loadPromise = (async () => {
        const t0 = performance.now();
        const res = await fetch(SOURCE_PDF);
        if (!res.ok) throw new Error(`Fixture fetch failed: HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const fetchMs = Math.round(performance.now() - t0);
        const document = await parser.parse(data, { fileName: SOURCE_NAME, pages: SOURCE_PAGES.length ? SOURCE_PAGES : undefined });
        const pageInfo = document.pages[Math.min(pageIndex, document.pages.length - 1)];
        loaded = { document, score: document.score, debug: document.debug as ParsingDebug, pageInfo, fetchMs };
        return loaded;
      })().catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        throw err;
      });
    }
    return loadPromise;
  };

  const fitPage = (info: PageInfo, maxScale: number): number => {
    const availH = Math.max(500, stage.clientHeight - 24);
    const availW = Math.max(400, stage.clientWidth - 24);
    cssScale = Math.min(availH / info.height, availW / info.width, maxScale);
    const cssW = Math.round(info.width * cssScale);
    const cssH = Math.round(info.height * cssScale);
    pageBox.style.width = `${cssW}px`;
    pageBox.style.height = `${cssH}px`;
    pageCanvas.style.width = `${cssW}px`;
    pageCanvas.style.height = `${cssH}px`;
    overlay.style.width = `${cssW}px`;
    overlay.style.height = `${cssH}px`;
    return (window.devicePixelRatio || 1) * cssScale;
  };

  // The overlay bitmap copies the page canvas's so both round the same way and align pixel for pixel.
  const matchOverlay = (): void => {
    overlay.width = pageCanvas.width;
    overlay.height = pageCanvas.height;
  };

  const renderPage = async (l: Loaded): Promise<void> => {
    const scale = fitPage(l.pageInfo, Infinity);
    await l.document.renderPage(pageIndex, pageCanvas, scale);
    matchOverlay();
    renderedScene = 'fixture';
  };

  const renderSynthetic = (s: SyntheticScene): void => {
    const scale = fitPage(s.pageInfo, 3);
    pageCanvas.width = Math.max(1, Math.ceil(s.pageInfo.width * scale));
    pageCanvas.height = Math.max(1, Math.ceil(s.pageInfo.height * scale));
    const ctx = pageCanvas.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSyntheticPage(ctx, s.page);
    matchOverlay();
    renderedScene = 'synthetic';
  };

  // pdf.js paints in chunks over several frames; resizing the canvas mid-render resets its transform and
  // the remaining chunks land as garbage. Renders are therefore serialised: a scene switch waits for the
  // previous render (fixture or synthetic) to finish before it touches the canvas.
  let renderChain: Promise<unknown> = Promise.resolve();
  const renderScene = (kind: SceneKind): Promise<SceneView> => {
    const next = renderChain.then(async (): Promise<SceneView> => {
      if (kind === 'synthetic') {
        const s = loadSynthetic();
        renderSynthetic(s);
        return s;
      }
      const l = await load();
      await renderPage(l);
      return l;
    });
    renderChain = next.catch(() => undefined);
    return next;
  };

  const overlayCtx = (): CanvasRenderingContext2D => {
    const ctx = overlay.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr * cssScale, 0, 0, dpr * cssScale, 0, 0);
    ctx.lineWidth = 1 / cssScale;
    return ctx;
  };

  const onPage = <T extends { page: number }>(items: T[]): T[] => items.filter((i) => i.page === pageIndex);

  const drawStaves = (ctx: CanvasRenderingContext2D, l: SceneView, faint = false): void => {
    for (const s of onPage(l.debug.staves)) {
      ctx.strokeStyle = TRACK_COLORS[s.index % TRACK_COLORS.length] + (faint ? '55' : 'cc');
      ctx.lineWidth = 1.2;
      for (const y of s.lineCount === 1 ? [s.lines[2]] : s.lines) {
        ctx.beginPath();
        ctx.moveTo(s.x1, y);
        ctx.lineTo(s.x2, y);
        ctx.stroke();
      }
    }
    if (faint) return;
    ctx.font = 'bold 7px sans-serif';
    for (const sys of onPage(l.debug.systems)) {
      ctx.strokeStyle = '#c58cff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sys.x1 - 7, sys.top - 4);
      ctx.lineTo(sys.x1 - 7, sys.bottom + 4);
      ctx.stroke();
      // Right-aligned so the badge never covers the bar numbers engravers print at the system's left edge.
      const label = `System ${sys.index + 1} · ${sys.staves} staves`;
      const w = ctx.measureText(label).width + 6;
      ctx.fillStyle = '#c58cff';
      ctx.fillRect(sys.x2 - w, sys.top - 16, w, 10);
      ctx.fillStyle = '#121417';
      ctx.fillText(label, sys.x2 - w + 3, sys.top - 8.5);
    }
  };

  const drawVoltasAndTuplets = (ctx: CanvasRenderingContext2D, l: SceneView): void => {
    const sp = l.debug.staves[0]?.space ?? 5;
    ctx.font = 'bold 7px sans-serif';
    for (const v of onPage(l.debug.voltas)) {
      ctx.strokeStyle = '#c58cff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (v.inherited) ctx.moveTo(v.x1, v.y);
      else {
        ctx.moveTo(v.x1, v.y + 2 * sp);
        ctx.lineTo(v.x1, v.y);
      }
      ctx.lineTo(v.x2, v.y);
      ctx.stroke();
      ctx.fillStyle = '#c58cff';
      ctx.fillText(`volta ${v.numbers.join(',')}${v.inherited ? ' (continued from the previous line)' : ''}`, v.x1 + 2, v.y - 2);
    }
    for (const t of onPage(l.debug.tuplets)) {
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(t.x1, t.y - 0.8 * sp, t.x2 - t.x1, 1.6 * sp);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffb454';
      ctx.fillText(`${t.actual}:${t.normal}`, t.x2 + 2, t.y + 2);
    }
  };

  const drawBarlines = (ctx: CanvasRenderingContext2D, l: SceneView, badgesBelow = false): void => {
    for (const b of onPage(l.debug.barlines)) {
      ctx.strokeStyle = b.thick ? '#ff6b6b' : '#57d38caa';
      ctx.lineWidth = b.thick ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y1 - 3);
      ctx.lineTo(b.x, b.y2 + 3);
      ctx.stroke();
    }
    ctx.font = 'bold 8px sans-serif';
    for (const m of onPage(l.debug.measures)) {
      const label = `${m.index + 1}${m.repeatStart ? ' |:' : ''}${m.repeatEnd ? ' :|' : ''}`;
      // Under a volta bracket (or whenever pitch labels sit above the staff) the badge moves below the
      // system so the printed ending number and the labels stay visible.
      const badgeTop = m.volta || badgesBelow ? m.bottom + 6 : m.top - 17;
      ctx.fillStyle = '#57d38c';
      ctx.fillRect(m.x1 + 1, badgeTop, ctx.measureText(label).width + 6, 11);
      ctx.fillStyle = '#121417';
      ctx.fillText(label, m.x1 + 4, badgeTop + 8.5);
      ctx.strokeStyle = '#4cc2ff33';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(m.x1, m.top - 6, m.x2 - m.x1, m.bottom - m.top + 12);
    }
  };

  const drawGlyphs = (ctx: CanvasRenderingContext2D, l: SceneView): void => {
    const sp = l.debug.staves[0]?.space ?? 5;
    for (const c of onPage(l.debug.clefs)) {
      ctx.strokeStyle = KIND_COLORS.clef;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(c.x - 1, c.y - 3 * sp, 2.6 * sp, 5.5 * sp);
    }
    for (const a of onPage(l.debug.accidentals)) {
      ctx.strokeStyle = a.key ? '#ffffff' : a.attached ? KIND_COLORS.accidental : '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x - 0.5, a.y - 1.4 * sp, 1.3 * sp, 2.8 * sp);
    }
    for (const r of onPage(l.debug.rests)) {
      ctx.strokeStyle = KIND_COLORS.rest;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(r.x - 0.8 * sp, r.y - 1.6 * sp, 1.6 * sp, 3.2 * sp);
    }
    for (const b of onPage(l.debug.beams)) {
      ctx.strokeStyle = KIND_COLORS.flag;
      ctx.lineWidth = 1;
      ctx.beginPath();
      b.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    for (const s of onPage(l.debug.stems)) {
      ctx.strokeStyle = '#4cc2ff99';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y1);
      ctx.lineTo(s.x, s.y2);
      ctx.stroke();
    }
    for (const n of onPage(l.debug.notes)) {
      ctx.strokeStyle = TRACK_COLORS[n.track % TRACK_COLORS.length];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(n.x, n.y, 0.75 * sp, 0.55 * sp, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const drawNotes = (ctx: CanvasRenderingContext2D, l: SceneView): void => {
    const sp = l.debug.staves[0]?.space ?? 5;
    for (const s of onPage(l.debug.stems)) {
      ctx.strokeStyle = '#4cc2ff66';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y1);
      ctx.lineTo(s.x, s.y2);
      ctx.stroke();
    }
    for (const b of onPage(l.debug.beams)) {
      ctx.fillStyle = '#ffb45455';
      ctx.beginPath();
      b.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
    for (const r of onPage(l.debug.rests)) {
      ctx.fillStyle = KIND_COLORS.rest + '55';
      ctx.fillRect(r.x - 0.8 * sp, r.y - 1.6 * sp, 1.6 * sp, 3.2 * sp);
    }
    for (const t of onPage(l.debug.ties)) {
      ctx.strokeStyle = '#ff8fab';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 2]);
      const [x2, y2] = t.broken ? [t.x1 + 4 * sp, t.y1] : [t.x2, t.y2];
      ctx.beginPath();
      ctx.moveTo(t.x1 + 0.8 * sp, t.y1 - 0.4 * sp);
      ctx.quadraticCurveTo((t.x1 + x2) / 2, t.y1 - 2.2 * sp, x2 - (t.broken ? 0 : 0.8 * sp), y2 - 0.4 * sp);
      ctx.stroke();
      if (t.broken && t.page2 === pageIndex) {
        ctx.beginPath();
        ctx.moveTo(t.x2 - 4 * sp, t.y2 - 0.4 * sp);
        ctx.quadraticCurveTo(t.x2 - 2 * sp, t.y2 - 2.2 * sp, t.x2 - 0.8 * sp, t.y2 - 0.4 * sp);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.font = `bold ${Math.max(5.5, 1.35 * sp)}px sans-serif`;
    ctx.textAlign = 'center';
    const staves = onPage(l.debug.staves);
    const systems = onPage(l.debug.systems);
    const texts = onPage(l.debug.texts);
    const staffOf = (n: { track: number; y: number }): Staff | undefined => {
      let best: Staff | undefined;
      let bestD = Infinity;
      for (const s of staves) {
        if (s.index !== n.track) continue;
        const d = n.y < s.top ? s.top - n.y : n.y > s.bottom ? n.y - s.bottom : 0;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    // Labels above a staff must stay clear of the previous system's labels and of any text (title, composer) over it.
    const ceilingAt = (staff: Staff, x: number, halfW: number): number => {
      const prev = systems.filter((s) => s.bottom < staff.top && s.index !== staff.system).sort((a, b) => b.bottom - a.bottom)[0];
      let ceiling = prev ? prev.bottom + 6 * sp : -Infinity;
      for (const t of texts) {
        if (t.y >= staff.top || (prev && t.y < prev.bottom) || t.right < x - halfW || t.x > x + halfW) continue;
        ceiling = Math.max(ceiling, t.y + 0.3 * t.size + 0.3 * sp);
      }
      return ceiling;
    };
    const placed = onPage(l.debug.notes)
      .map((n) => ({ n, staff: staffOf(n) }))
      .sort((a, b) => (a.staff?.top ?? 0) - (b.staff?.top ?? 0) || a.n.x - b.n.x || a.n.y - b.n.y);
    // Heads of one chord share a staff and an x; their labels are stacked outwards so they stay legible.
    const chords: (typeof placed)[] = [];
    for (const p of placed) {
      const last = chords[chords.length - 1];
      if (last && last[0].staff === p.staff && Math.abs(p.n.x - last[0].n.x) <= 1.0 * sp) last.push(p);
      else chords.push([p]);
    }
    // Neighbouring labels closer than their width alternate between two rows so dense eighth runs stay legible.
    const lastLabel = new Map<Staff | undefined, { x: number; halfW: number; row: number }>();
    for (const chord of chords) {
      const staff = chord[0].staff;
      const track = chord[0].n.track;
      const color = TRACK_COLORS[track % TRACK_COLORS.length];
      const halfW = Math.max(...chord.map((p) => ctx.measureText(p.n.label).width + 2)) / 2;
      const prev = lastLabel.get(staff);
      const row = prev && chord[0].n.x - prev.x < prev.halfW + halfW + 1 ? 1 - prev.row : 0;
      lastLabel.set(staff, { x: chord[0].n.x, halfW, row });
      const shift = row * 1.5 * sp;
      let above = track % 2 === 0;
      if (above && staff) {
        const topY = Math.min(...chord.map((p) => p.n.y)) - 1.3 * sp - shift - (chord.length - 1) * 1.5 * sp - 1.25 * sp;
        if (topY < ceilingAt(staff, chord[0].n.x, halfW)) above = false;
      }
      const ordered = [...chord].sort((a, b) => (above ? a.n.y - b.n.y : b.n.y - a.n.y));
      ordered.forEach(({ n }, k) => {
        ctx.fillStyle = color + (n.grace ? '88' : 'bb');
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, 0.7 * sp, 0.5 * sp, 0, 0, Math.PI * 2);
        ctx.fill();
        const labelY = above ? ordered[0].n.y - 1.3 * sp - shift - k * 1.5 * sp : ordered[0].n.y + 2.3 * sp + shift + k * 1.5 * sp;
        const w = ctx.measureText(n.label).width + 2;
        ctx.fillStyle = '#121417dd';
        ctx.fillRect(n.x - w / 2, labelY - 1.25 * sp, w, 1.45 * sp);
        ctx.fillStyle = color;
        ctx.fillText(n.label, n.x, labelY - 0.15 * sp);
      });
    }
    ctx.textAlign = 'start';
    drawVoltasAndTuplets(ctx, l);
  };

  const drawComparison = (ctx: CanvasRenderingContext2D, l: SceneView, cmp: Comparison): void => {
    const sp = l.debug.staves[0]?.space ?? 5;
    const info = l.pageInfo;
    const lastSystem = onPage(l.debug.systems).sort((a, b) => b.bottom - a.bottom)[0];
    const badgeY = Math.min(info.height - 40, (lastSystem?.bottom ?? info.height - 80) + 22);
    const pass = cmp.overall.onsetPitchF1 >= 0.95 && cmp.overall.pitchLcsRatio >= 0.97;
    const lines = [
      `${pass ? 'TARGET MET' : 'BELOW TARGET'} · onset+pitch F1 ${fmt(cmp.overall.onsetPitchF1)} · pitch LCS ${fmt(cmp.overall.pitchLcsRatio)} · duration ${fmt(cmp.overall.durationAccuracy)}`,
      ...cmp.tracks.map((t) => `${t.refTrack.replace(/:$/, '')} → ${t.scoreTrack ?? '—'}: ${t.gotNoteCount}/${t.refNoteCount} notes, F1 ${fmt(t.onsetPitchF1)}, LCS ${fmt(t.pitchLcsRatio)}, missing ${t.missingSample.length ? t.missingSample.length + '+' : 0}, extra ${t.extraSample.length ? t.extraSample.length + '+' : 0}`),
    ];
    ctx.font = 'bold 9px sans-serif';
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16;
    const h = 8 + lines.length * 12;
    const x = (info.width - w) / 2;
    ctx.fillStyle = pass ? '#123b25ee' : '#4a1c1cee';
    ctx.fillRect(x, badgeY, w, h);
    ctx.strokeStyle = pass ? '#57d38c' : '#ff6b6b';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, badgeY, w, h);
    ctx.fillStyle = '#e6e9ee';
    lines.forEach((t, i) => ctx.fillText(t, x + 8, badgeY + 14 + i * 12));
    const printedStart = new Map<number, number>();
    let acc = 0;
    for (const m of l.score.measures) {
      printedStart.set(m.index, acc);
      acc += m.durationQn;
    }
    for (const t of cmp.tracks) {
      for (const extra of t.extraSample) {
        const note = onPage(l.debug.notes).find((n) => n.measure === extra.measure && n.midi === extra.midi);
        if (!note) continue;
        ctx.strokeStyle = '#ffb454';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(note.x, note.y, 1.2 * sp, 1.0 * sp, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const miss of t.missingSample) {
        const m = l.score.measures.find((mm) => {
          const s = printedStart.get(mm.index) ?? 0;
          return miss.startQn >= s - 1e-6 && miss.startQn < s + mm.durationQn - 1e-6;
        });
        const box = m?.layout.find((b) => b.page === pageIndex);
        if (!box) continue;
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(box.x + 1, box.y, box.width - 2, box.height);
        ctx.setLineDash([]);
      }
    }
  };

  const header = (l: Loaded | undefined, step: number): HTMLElement[] => {
    const nodes: HTMLElement[] = [];
    nodes.push(el('span', 'psc-step', `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`));
    if (sceneOf(step) === 'synthetic') {
      const s = loadSynthetic();
      nodes.push(el('h1', undefined, s.score.title ?? 'Synthetic page'));
      nodes.push(el('div', 'psc-sub', `Hand-built PageExtraction run through analyze() · ${s.score.source.fileName}`));
      return nodes;
    }
    nodes.push(el('h1', undefined, l?.score.title ?? 'Parsing showcase'));
    nodes.push(el('div', 'psc-sub', l ? `${l.score.composer ?? 'Unknown composer'} · ${l.score.source.fileName}` : SOURCE_PDF));
    return nodes;
  };

  const sectionParse = (l: Loaded): HTMLElement[] => {
    const d = l.debug;
    const s = l.score;
    return [
      el('h2', undefined, 'Parse'),
      kv([
        ['Parse time', `${d.parseMs} ms (fetch ${l.fetchMs} ms)`],
        ['Engine', s.source.engine],
        ['Pages', s.source.pageCount],
        ['Music fonts', (s.source.fonts ?? []).join(', ') || 'none'],
        ['All fonts', d.allFonts.map((f) => `${f.name} (${f.family})`).join(', ')],
        ['Extracted', `${d.extraction.glyphs} glyphs, ${d.extraction.paths} paths, ${d.extraction.texts} text runs, ${d.extraction.images} images`],
      ]),
    ];
  };

  const sectionLayout = (l: Loaded): HTMLElement[] => {
    const d = l.debug;
    const s = l.score;
    const legend = el('div', 'psc-legend');
    s.tracks.forEach((t, i) => {
      const span = el('span');
      const sw = el('i', 'psc-swatch');
      sw.style.background = TRACK_COLORS[i % TRACK_COLORS.length];
      span.append(sw, document.createTextNode(`${t.name} (${t.clef})`));
      legend.append(span);
    });
    return [
      el('h2', undefined, 'Staves and systems'),
      kv([
        ['Staves', d.staves.length],
        ['Systems', `${d.systems.length} (${d.systems.map((x) => x.staves).join(', ')} staves)`],
        ['Staff space', `${fmt(d.staves[0]?.space ?? 0, 2)} pt`],
        ['Tracks', s.tracks.map((t) => t.name).join(', ')],
        ['Barlines', d.barlines.length],
      ]),
      legend,
    ];
  };

  const sectionGlyphs = (l: Loaded): HTMLElement[] => {
    const d = l.debug;
    const table = el('table', 'psc-table');
    const head = el('tr');
    head.append(el('th', undefined, 'Kind'), el('th', undefined, 'Count'));
    table.append(head);
    for (const [k, v] of Object.entries(d.glyphCounts).sort((a, b) => b[1] - a[1])) {
      const tr = el('tr');
      const td = el('td');
      const sw = el('i', 'psc-swatch');
      sw.style.background = KIND_COLORS[k] ?? (k === 'notehead' ? TRACK_COLORS[0] : '#666');
      td.append(sw, document.createTextNode(k));
      tr.append(td, el('td', undefined, String(v)));
      table.append(tr);
    }
    return [
      el('h2', undefined, 'Glyphs classified'),
      table,
      el(
        'div',
        'psc-muted',
        `${d.stems.length} stems, ${d.beams.length} beams, ${d.accidentals.filter((a) => a.key).length} key-signature accidentals (white), ${d.accidentals.filter((a) => a.attached).length} note accidentals (yellow), ${d.accidentals.filter((a) => !a.key && !a.attached).length} ignored (red)`,
      ),
    ];
  };

  const sectionNotes = (l: Loaded): HTMLElement[] => {
    const d = l.debug;
    const s = l.score;
    const durations = new Map<number, number>();
    for (const n of d.notes) if (!n.grace) durations.set(n.durationQn, (durations.get(n.durationQn) ?? 0) + 1);
    const durationText = [...durations]
      .sort((a, b) => b[0] - a[0])
      .map(([qn, count]) => `${qn} qn ×${count}`)
      .join(', ');
    return [
      el('h2', undefined, 'Notes with pitches and durations'),
      kv([
        ...s.tracks.map((t): [string, string] => [t.name, `${d.notes.filter((n) => n.track === t.staffIndex).length} printed heads → ${t.notes.length} timeline events`]),
        ['Durations', durationText],
        ['Grace notes', d.notes.filter((n) => n.grace).length],
        ['Rests', d.rests.length],
        ['Tuplets', d.tuplets.length ? d.tuplets.map((t) => `${t.actual}:${t.normal}`).join(', ') : 'none found'],
        ['Key', s.keySignatures.map((k) => `${k.fifths >= 0 ? k.fifths + ' sharp(s)' : -k.fifths + ' flat(s)'} from m.${k.measure + 1}`).join(', ')],
        ['Time', s.timeSignatures.map((t) => `${t.beats}/${t.beatType} from m.${t.measure + 1}`).join(', ') || 'none'],
        ['Tempo', `${s.tempoBpm} bpm${s.tempoMarks.length ? ` (${s.tempoMarks[0].text})` : ' (default, no tempo mark found)'}`],
      ]),
    ];
  };

  const sectionMeasures = (l: Loaded): HTMLElement[] => {
    const d = l.debug;
    const s = l.score;
    const repeats = s.measures.filter((m) => m.repeatStart || m.repeatEnd).map((m) => `m.${m.index + 1}${m.repeatStart ? ' |:' : ''}${m.repeatEnd ? ' :|' : ''}`);
    const order = s.timeline.map((seg) => seg.measure + 1);
    const orderText = order.length > 40 ? `${order.slice(0, 20).join(' ')} … ${order.slice(-8).join(' ')}` : order.join(' ');
    return [
      el('h2', undefined, 'Measures, repeats and timeline'),
      kv([
        ['Measures', `${s.measures.length} (${[...new Set(s.measures.map((m) => m.durationQn))].join(', ')} qn each)`],
        ['Repeat barlines', repeats.join(', ') || 'none'],
        ['Volta brackets', d.voltas.length ? d.measures.filter((m) => m.volta).map((m) => `m.${m.index + 1} (${m.volta!.join(',')}.)`).join(', ') : 'none found (plain repeats)'],
        ['Timeline', `${s.timeline.length} measure plays, ${s.durationQn} quarter notes`],
        ['Play order', orderText],
        ['Rhythm method', summarizeMethods(d.measures.flatMap((m) => m.method))],
      ]),
    ];
  };

  const sectionComparison = (): HTMLElement[] => {
    const nodes: HTMLElement[] = [el('h2', undefined, 'Comparison to reference MIDI')];
    if (CUSTOM_SOURCE) {
      nodes.push(el('div', 'psc-muted', `No reference MIDI for ${SOURCE_NAME}; the bundled fixture is the only scored comparison.`));
      return nodes;
    }
    if (!comparison) {
      nodes.push(el('div', 'psc-muted', 'Not compared yet'));
      return nodes;
    }
    const c = comparison;
    const pass = c.overall.onsetPitchF1 >= 0.95 && c.overall.pitchLcsRatio >= 0.97;
    const overall = el('div');
    overall.append(
      el('span', pass ? 'psc-ok' : 'psc-bad', pass ? 'TARGET MET (F1 ≥ 0.95, LCS ≥ 0.97)' : 'BELOW TARGET (F1 ≥ 0.95, LCS ≥ 0.97)'),
    );
    nodes.push(overall);
    nodes.push(
      kv([
        ['Onset+pitch F1', fmt(c.overall.onsetPitchF1, 4)],
        ['Pitch LCS', fmt(c.overall.pitchLcsRatio, 4)],
        ['Duration accuracy', fmt(c.overall.durationAccuracy, 4)],
        ['Variant', `${c.variant} order (reference MIDI is not unfolded)`],
        ['Reference', FIXTURE_MID],
      ]),
    );
    const table = el('table', 'psc-table');
    const head = el('tr');
    for (const h of ['Ref track', 'Parsed as', 'Ref', 'Got', 'F1', 'LCS', 'Dur']) head.append(el('th', undefined, h));
    table.append(head);
    for (const t of c.tracks) {
      const tr = el('tr');
      for (const v of [t.refTrack.replace(/:$/, '') || '(unnamed)', t.scoreTrack ?? '—', t.refNoteCount, t.gotNoteCount, fmt(t.onsetPitchF1), fmt(t.pitchLcsRatio), fmt(t.durationAccuracy)]) {
        tr.append(el('td', undefined, String(v)));
      }
      table.append(tr);
    }
    nodes.push(table);
    for (const t of c.tracks) {
      if (!t.missingSample.length && !t.extraSample.length) continue;
      nodes.push(
        el(
          'div',
          'psc-warn',
          `${t.refTrack}: first missing ${t.missingSample.slice(0, 5).map((n) => `${n.midi}@${n.startQn}`).join(', ') || 'none'}; first extra ${t.extraSample.slice(0, 5).map((n) => `${n.midi}@${n.startQn}`).join(', ') || 'none'}`,
        ),
      );
    }
    if (c.tracks.every((t) => !t.missingSample.length && !t.extraSample.length)) {
      nodes.push(el('div', 'psc-ok', 'Every reference note was found at the right onset (±0.13 qn); no extra notes.'));
    }
    return nodes;
  };

  const sectionSynthetic = (): HTMLElement[] => {
    const s = loadSynthetic();
    const d = s.debug;
    const order = s.score.timeline.map((seg) => seg.measure + 1).join(' ');
    const table = el('table', 'psc-table');
    const head = el('tr');
    for (const h of ['Bar', 'Volta', 'Repeat', 'Rhythm', 'Notes (qn)']) head.append(el('th', undefined, h));
    table.append(head);
    for (const m of d.measures) {
      const tr = el('tr');
      const notes = d.notes.filter((n) => n.measure === m.index).map((n) => `${n.label} ${fmtQn(n.durationQn)}`);
      for (const v of [m.index + 1, m.volta ? `${m.volta.join(',')}.` : '–', `${m.repeatStart ? '|:' : ''}${m.repeatEnd ? ':|' : ''}` || '–', m.method.join('/'), notes.join(' ')]) {
        tr.append(el('td', undefined, String(v)));
      }
      table.append(tr);
    }
    return [
      el('h2', undefined, 'Voltas and tuplets on a synthetic page'),
      el(
        'div',
        'psc-muted',
        'The fixture has plain repeats, no tuplets and no tie across a line break, so this two-line page (a hand-built PageExtraction, not a PDF) exercises the volta bracket, alternative-ending unfolding across a line break, broken-tie and beam-tuplet paths of the same analyzer.',
      ),
      kv([
        ['Analyze time', `${s.analyzeMs} ms`],
        ['Systems', `${d.systems.length} (${d.systems.map((x) => x.staves).join(', ')} staff)`],
        ['Volta brackets', d.voltas.map((v) => `${v.numbers.join(',')}. at x ${Math.round(v.x1)}–${Math.round(v.x2)}${v.inherited ? ' (continued from the previous line)' : ''}`).join('; ') || 'none'],
        ['Ties', d.ties.length ? d.ties.map((t) => `${t.broken ? 'across the line break' : 'within a line'} (${Math.round(t.x1)} → ${Math.round(t.x2)})`).join('; ') : 'none'],
        ['Tuplets', d.tuplets.map((t) => `${t.actual}:${t.normal} over x ${Math.round(t.x1)}–${Math.round(t.x2)}`).join('; ') || 'none'],
        ['Time / key', `${s.score.timeSignatures.map((t) => `${t.beats}/${t.beatType}`).join(', ')} · ${s.score.keySignatures.map((k) => `${k.fifths} fifths`).join(', ')}`],
        ['Play order', `${order} (${s.score.timeline.length} plays, ${s.score.durationQn} qn)`],
        ['Warnings', s.score.warnings.length ? s.score.warnings.join(' | ') : 'none'],
      ]),
      table,
    ];
  };

  const renderPanel = (step: number): void => {
    panel.innerHTML = '';
    const l = loaded;
    panel.append(...header(l, step));
    if (lastError) {
      panel.append(el('h2', undefined, 'Error'), el('div', 'psc-error', lastError));
      return;
    }
    if (sceneOf(step) === 'synthetic') {
      const current = el('div', 'psc-current');
      current.append(...sectionSynthetic());
      panel.append(current);
      if (l) {
        const earlier = el('div', 'psc-earlier');
        earlier.append(...sectionMeasures(l));
        panel.append(earlier);
      }
      return;
    }
    if (!l) {
      panel.append(el('div', 'psc-muted', 'Parsing…'));
      return;
    }
    const sections: Array<(l: Loaded) => HTMLElement[]> = [sectionParse, sectionLayout, sectionGlyphs, sectionNotes, sectionMeasures, () => sectionComparison()];
    const current = el('div', 'psc-current');
    current.append(...sections[Math.min(step, sections.length - 1)](l));
    panel.append(current);

    panel.append(el('h2', undefined, `Warnings (${l.score.warnings.length})`));
    if (!l.score.warnings.length) panel.append(el('div', 'psc-ok', 'Clean parse: no warnings.'));
    else {
      const ul = el('ul', 'psc-list');
      for (const w of l.score.warnings) ul.append(el('li', 'psc-warn', w));
      panel.append(ul);
    }
    const earlier = el('div', 'psc-earlier');
    for (let i = 0; i < step && i < sections.length; i++) earlier.append(...sections[i](l));
    if (earlier.childElementCount) panel.append(earlier);
  };

  const drawStep = (index: number, l: SceneView): void => {
    const ctx = overlayCtx();
    switch (index) {
      case 1:
        drawStaves(ctx, l);
        break;
      case 2:
        drawStaves(ctx, l, true);
        drawGlyphs(ctx, l);
        break;
      case 3:
        drawStaves(ctx, l, true);
        drawNotes(ctx, l);
        break;
      case 4:
        drawStaves(ctx, l, true);
        drawBarlines(ctx, l);
        drawVoltasAndTuplets(ctx, l);
        break;
      case 5:
        drawStaves(ctx, l, true);
        drawNotes(ctx, l);
        if (comparison) drawComparison(ctx, l, comparison);
        break;
      case SYNTHETIC_STEP:
        drawStaves(ctx, l, true);
        drawBarlines(ctx, l, true);
        drawNotes(ctx, l);
        break;
      default:
        break;
    }
  };

  const runStep = async (index: number): Promise<void> => {
    if (index < 0 || index >= STEPS.length) throw new Error(`No step ${index}`);
    currentStep = index;
    renderPanel(index);
    const kind = sceneOf(index);
    let view: SceneView;
    if (kind === 'synthetic') view = await renderScene(kind);
    else {
      const l = await load();
      view = l;
      if (index === 0 || pageCanvas.width === 0 || renderedScene !== 'fixture') await renderScene('fixture');
      else await renderChain;
      if (index === 5 && !CUSTOM_SOURCE) {
        if (!reference) {
          const res = await fetch(FIXTURE_MID);
          if (!res.ok) throw new Error(`Reference MIDI fetch failed: HTTP ${res.status}`);
          reference = parseReferenceMidi(new Uint8Array(await res.arrayBuffer()));
        }
        comparison = compareScoreToReference(l.score, reference);
      }
    }
    drawStep(index, view);
    renderPanel(index);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  };

  // A viewport or zoom (devicePixelRatio) change re-renders the page and redraws the current overlay.
  let lastStage = { w: 0, h: 0, dpr: 0 };
  let resizeTimer: number | undefined;
  const onResize = (): void => {
    const next = { w: stage.clientWidth, h: stage.clientHeight, dpr: window.devicePixelRatio || 1 };
    if (next.w === lastStage.w && next.h === lastStage.h && next.dpr === lastStage.dpr) return;
    lastStage = next;
    if (!renderedScene || currentStep < 0) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const step = currentStep;
      void renderScene(sceneOf(step))
        .then((view) => drawStep(step, view))
        .catch(() => undefined);
    }, 120);
  };
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(stage);
  // A devicePixelRatio change alone (window dragged to another display, browser zoom) fires no resize
  // event; a media query pinned to the current ratio stops matching instead, and is re-armed each time.
  // Emulated ratio changes (DevTools, headless automation) dispatch neither, so a slow poll backs it up.
  let dprQuery: MediaQueryList | undefined;
  const onDprChange = (): void => {
    armDprQuery();
    onResize();
  };
  const armDprQuery = (): void => {
    if (typeof window.matchMedia !== 'function') return;
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  armDprQuery();
  window.setInterval(onResize, 250);

  renderPanel(0);
  void renderScene('fixture')
    .then(() => {
      lastStage = { w: stage.clientWidth, h: stage.clientHeight, dpr: window.devicePixelRatio || 1 };
      if (currentStep < 0) renderPanel(0);
    })
    .catch(() => renderPanel(Math.max(0, currentStep)));

  return {
    name: 'parsing',
    steps: STEPS,
    runStep,
    getDiagnostics: () => {
      const l = loaded;
      const c = comparison;
      return {
        implemented: true,
        error: lastError,
        parseMs: l?.debug.parseMs,
        fetchMs: l?.fetchMs,
        fonts: l?.score.source.fonts,
        staves: l?.debug.staves.length,
        systems: l?.debug.systems.length,
        measures: l?.score.measures.length,
        timelineSegments: l?.score.timeline.length,
        durationQn: l?.score.durationQn,
        notesPerTrack: l?.score.tracks.map((t) => ({ id: t.id, name: t.name, clef: t.clef, notes: t.notes.length })),
        printedHeads: l?.debug.notes.length,
        graceNotes: l?.debug.notes.filter((n) => n.grace).length,
        rests: l?.debug.rests.length,
        voltas: l?.debug.voltas.length,
        tuplets: l?.debug.tuplets.length,
        keySignatureAccidentals: l?.debug.accidentals.filter((a) => a.key).length,
        noteAccidentals: l?.debug.accidentals.filter((a) => a.attached).length,
        ignoredAccidentals: l?.debug.accidentals.filter((a) => !a.key && !a.attached).length,
        repeats: l?.score.measures.filter((m) => m.repeatStart || m.repeatEnd).map((m) => ({ measure: m.index, repeatStart: !!m.repeatStart, repeatEnd: !!m.repeatEnd })),
        glyphCounts: l?.debug.glyphCounts,
        timeSignatures: l?.score.timeSignatures,
        keySignatures: l?.score.keySignatures,
        tempoBpm: l?.score.tempoBpm,
        title: l?.score.title,
        composer: l?.score.composer,
        warnings: l?.score.warnings,
        synthetic: synthetic
          ? {
              analyzeMs: synthetic.analyzeMs,
              measures: synthetic.score.measures.length,
              systems: synthetic.debug.systems.length,
              ties: synthetic.debug.ties.map((t) => ({ broken: t.broken })),
              keySignatures: synthetic.score.keySignatures,
              voltas: synthetic.debug.voltas.map((v) => ({ numbers: v.numbers, inherited: !!v.inherited })),
              measureVoltas: synthetic.debug.measures.map((m) => m.volta ?? null),
              tuplets: synthetic.debug.tuplets.map((t) => `${t.actual}:${t.normal}`),
              playOrder: synthetic.score.timeline.map((s) => s.measure),
              durationQn: synthetic.score.durationQn,
              notes: synthetic.debug.notes.length,
              warnings: synthetic.score.warnings,
            }
          : undefined,
        comparison: c
          ? {
              variant: c.variant,
              onsetPitchF1: c.overall.onsetPitchF1,
              pitchLcsRatio: c.overall.pitchLcsRatio,
              durationAccuracy: c.overall.durationAccuracy,
              targetMet: c.overall.onsetPitchF1 >= 0.95 && c.overall.pitchLcsRatio >= 0.97,
              tracks: c.tracks.map((t) => ({
                refTrack: t.refTrack,
                scoreTrack: t.scoreTrack,
                refNoteCount: t.refNoteCount,
                gotNoteCount: t.gotNoteCount,
                onsetPitchF1: t.onsetPitchF1,
                pitchLcsRatio: t.pitchLcsRatio,
                durationAccuracy: t.durationAccuracy,
                missing: t.missingSample.slice(0, 5),
                extra: t.extraSample.slice(0, 5),
              })),
            }
          : undefined,
      };
    },
  };
}

function fmtQn(qn: number): string {
  const thirds = Math.round(qn * 3);
  if (Math.abs(thirds / 3 - qn) < 1e-6 && thirds % 3 !== 0) return `${thirds}/3`;
  return String(Math.round(qn * 1000) / 1000);
}

function summarizeMethods(methods: string[]): string {
  const counts = new Map<string, number>();
  for (const m of methods) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${k} ×${v}`).join(', ');
}
