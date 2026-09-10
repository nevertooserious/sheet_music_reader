import type { AppController } from '../core/contracts';
import type { AppState, LayoutBox, NoteEvent, PageInfo, ScoreModel, TimelineSegment, TransportState } from '../core/types';
import { el, iconButton, setDisabled, setHidden, setPressed, setText } from './dom';
import {
  type OnsetAnchor,
  type TrackNotes,
  activeNotes,
  indexTracks,
  measureUnionBox,
  onsetAnchors,
  playheadX,
  positionInfo,
} from './format';
import { icons } from './icons';
import { bitmapBytes, effectiveDpr, pageRange, renderOrder } from './pageMath';
import { readPref, writePref } from './prefs';
import {
  DEFAULT_ZOOM,
  ZOOM_PRESETS,
  type ZoomMode,
  formatScalePercent,
  formatZoom,
  normalizeZoom,
  parseZoom,
  resolveScale,
  stepZoom,
  wheelZoomFactor,
} from './zoom';

const PAGE_PADDING = 28;
const MEASURE_PAD = 6;
const RESIZE_SETTLE_MS = 120;
const RENDER_MARGIN_PAGES = 1;
const KEEP_MARGIN_PAGES = 2;
/** A position change larger than this between two frames is treated as a seek. */
const SEEK_JUMP_QN = 1;
/** Fallback for environments where a devicePixelRatio change fires no resize or media-query event. */
const DPR_POLL_MS = 1000;
const IDLE_TRANSPORT: TransportState = { playing: false, positionQn: 0, tempoBpm: 100, masterGain: 1, tracks: [], contextState: 'none' };

interface PageView {
  info: PageInfo;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  notesLayer: HTMLElement;
  placeholder: HTMLElement;
  highlights: HTMLElement[];
  playhead: HTMLElement;
  visible: boolean;
  rendered: boolean;
  renderedScale: number;
  renderedDpr: number;
  failedKey: string;
  inflight: boolean;
}

export interface RenderStats {
  renderCalls: number;
  releases: number;
  renderedPages: number;
  /** Rendered pages whose bitmap matches the current scale and device pixel ratio. */
  freshPages: number;
  bitmapBytes: number;
  visiblePages: number[];
  scale: number;
}

export interface ScoreViewDeps {
  controller: AppController;
}

export interface ScoreView {
  el: HTMLElement;
  scroll: HTMLElement;
  update(state: AppState): void;
  /** Scroll the current measure into view on the next update (after an explicit seek). */
  reveal(): void;
  getScale(): number;
  getZoom(): ZoomMode;
  /** Numeric modes are remembered as the default for the next session, as are the fit modes. */
  setZoom(mode: ZoomMode): void;
  zoomIn(): void;
  zoomOut(): void;
  isFollowing(): boolean;
  setFollowing(on: boolean): void;
  getRenderStats(): RenderStats;
  dispose(): void;
}

export function createScoreView(deps: ScoreViewDeps): ScoreView {
  const { controller } = deps;

  const pagesHost = el('div', { class: 'pages' });
  const scroll = el('div', { class: 'score-scroll', 'data-role': 'score-view', tabindex: '0', 'aria-label': 'Score pages' }, [pagesHost]);

  const pageLabel = el('span', { class: 'toolbar-text', text: '' });
  const positionLabel = el('span', { class: 'toolbar-text toolbar-text-strong', text: '' });

  let zoom: ZoomMode = parseZoom(readPref('zoom')) ?? DEFAULT_ZOOM;
  let following = readPref('follow') !== 'off';

  const fitWidthOption = el('option', { value: 'fit-width', text: 'Fit width' });
  const fitPageOption = el('option', { value: 'fit-page', text: 'Fit page' });
  const presetOptions = ZOOM_PRESETS.map((p) => el('option', { value: String(p), text: formatScalePercent(p) }));
  /** Listed only while a wheel or pinch zoom sits between two presets. */
  const customOption = el('option', { value: '', text: '' });
  const zoomSelect = el(
    'select',
    {
      class: 'toolbar-select',
      'data-control': 'zoom',
      'aria-label': 'Zoom',
      title: 'Zoom (Ctrl/⌘ + wheel or pinch to zoom freely; 0 returns to fit width)',
    },
    [fitWidthOption, fitPageOption, ...presetOptions],
  );
  zoomSelect.addEventListener('change', () => {
    const mode = parseZoom(zoomSelect.value);
    if (mode !== undefined) setZoom(mode);
  });
  const zoomOutButton = iconButton({ icon: icons.zoomOut, label: 'Zoom out (−)', action: 'zoom-out', onClick: () => zoomBy(-1) });
  const zoomInButton = iconButton({ icon: icons.zoomIn, label: 'Zoom in (+)', action: 'zoom-in', onClick: () => zoomBy(1) });

  const followButton = el(
    'button',
    {
      type: 'button',
      class: 'button button-small toolbar-toggle',
      'data-action': 'toggle-follow',
      'aria-label': 'Auto-scroll',
      'aria-pressed': 'false',
      title: 'Auto-scroll: keep the playing bar in view',
    },
    [el('span', { class: 'button-icon', html: icons.follow }), el('span', { class: 'button-label', text: 'Auto-scroll' })],
  );
  followButton.addEventListener('click', () => setFollowing(!following));

  const toolbar = el('div', { class: 'score-toolbar' }, [
    el('span', { class: 'panel-title', text: 'Score' }),
    pageLabel,
    el('span', { class: 'toolbar-spacer' }),
    positionLabel,
    el('span', { class: 'toolbar-divider' }),
    el('div', { class: 'toolbar-group', role: 'group', 'aria-label': 'Zoom' }, [zoomOutButton, zoomSelect, zoomInButton]),
    el('span', { class: 'toolbar-divider' }),
    followButton,
  ]);

  const root = el('section', { class: 'score-panel', 'aria-label': 'Score' }, [toolbar, scroll]);

  let score: ScoreModel | undefined;
  let pages: PageView[] = [];
  let scale = 1;
  let renderGeneration = 0;
  let pumpGeneration = -1;
  let renderFrame: number | undefined;
  let resizeTimer: number | undefined;
  let renderCalls = 0;
  let releases = 0;
  let lastDpr = window.devicePixelRatio || 1;

  let trackNotes: TrackNotes[] = [];
  let currentSegment = -1;
  let currentMeasure = -1;
  let currentSeg: TimelineSegment | undefined;
  let currentUnion: LayoutBox | undefined;
  let currentPage: PageView | undefined;
  let currentAnchors: OnsetAnchor[] = [];
  let lastNotesKey = '';
  let lastPlaying = false;
  let lastPositionText = '';
  let lastPositionQn = 0;
  let pendingReveal = false;
  let latestTransport: TransportState = IDLE_TRANSPORT;
  const notePool: HTMLElement[] = [];
  const activeBuffer: NoteEvent[] = [];
  const activeAll: NoteEvent[] = [];
  syncFollowButton();
  syncZoomControls();

  const resizeObserver = new ResizeObserver(() => {
    if (!score) return;
    const next = computeScale();
    if (Math.abs(next - scale) < 0.002) return;
    applyScale(next);
    if (following) scrollToCurrent(false);
    settleRender();
  });
  resizeObserver.observe(scroll);

  const intersection = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.page);
        const page = pages[index];
        if (page && page.root === entry.target) page.visible = entry.isIntersecting;
      }
      scheduleRender();
    },
    { root: scroll, rootMargin: '25% 0px', threshold: 0 },
  );

  let dprQuery: MediaQueryList | undefined;
  const checkDpr = (): void => {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === lastDpr) return;
    lastDpr = dpr;
    watchDpr();
    scheduleRender();
  };
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', checkDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', checkDpr);
  }
  watchDpr();
  const dprTimer = window.setInterval(checkDpr, DPR_POLL_MS);

  function computeScale(): number {
    let widest = 0;
    let tallest = 0;
    for (const p of pages) {
      widest = Math.max(widest, p.info.width);
      tallest = Math.max(tallest, p.info.height);
    }
    return resolveScale(zoom, scroll.clientWidth - PAGE_PADDING * 2, scroll.clientHeight - PAGE_PADDING * 2, widest, tallest);
  }

  function applyScale(next: number): void {
    scale = next;
    root.style.setProperty('--page-scale', String(scale));
    for (const page of pages) {
      page.root.style.width = `${page.info.width * scale}px`;
      page.root.style.height = `${page.info.height * scale}px`;
    }
    lastNotesKey = '';
    updatePlayhead(true, false);
    syncZoomControls();
  }

  /** Rapid zoom or resize steps stretch the existing bitmaps; the real re-render waits until the size settles. */
  function settleRender(): void {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = undefined;
      scheduleRender();
    }, RESIZE_SETTLE_MS);
  }

  function setZoom(mode: ZoomMode): void {
    zoom = mode;
    writePref('zoom', formatZoom(mode));
    if (score) rescale(computeScale());
    syncZoomControls();
  }

  function zoomBy(direction: 1 | -1): void {
    const next = stepZoom(scale, direction);
    if (next !== undefined) setZoom(next);
  }

  function rescale(next: number): void {
    if (Math.abs(next - scale) < 0.002) return;
    const anchor = viewAnchor();
    applyScale(next);
    if (anchor) restoreAnchor(anchor);
    if (following && latestTransport.playing) scrollToCurrent(false);
    settleRender();
  }

  /** Continuous zoom from a wheel or pinch: the score under `anchor` stays under `to`, and the mode becomes that exact scale. */
  function gestureZoom(target: number, anchor: ViewAnchor | undefined, to: ViewPoint): void {
    const next = normalizeZoom(target);
    if (Math.abs(next - scale) >= 0.002) {
      zoom = next;
      writePref('zoom', formatZoom(next));
      applyScale(next);
      settleRender();
    }
    if (anchor) restoreAnchor(anchor, to);
  }

  /** Client coordinates. */
  interface ViewPoint {
    x: number;
    y: number;
  }

  interface ViewAnchor {
    page: PageView;
    fx: number;
    fy: number;
  }

  function viewportCentre(): ViewPoint {
    const view = scroll.getBoundingClientRect();
    return { x: view.left + scroll.clientWidth / 2, y: view.top + scroll.clientHeight / 2 };
  }

  /** The page under a viewport point and where on it the point falls, so a zoom can keep that spot in place. */
  function viewAnchor(at: ViewPoint = viewportCentre()): ViewAnchor | undefined {
    const candidates = pages.some((p) => p.visible) ? pages.filter((p) => p.visible) : pages;
    if (candidates.length === 0) return undefined;
    let best: PageView | undefined;
    let bestDistance = Infinity;
    for (const page of candidates) {
      const r = page.root.getBoundingClientRect();
      const distance = at.y < r.top ? r.top - at.y : at.y > r.bottom ? at.y - r.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = page;
        if (distance === 0) break;
      }
    }
    if (!best) return undefined;
    const r = best.root.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return undefined;
    return { page: best, fx: (at.x - r.left) / r.width, fy: (at.y - r.top) / r.height };
  }

  /** Scrolls so the anchored spot lands under `to`: a gesture's current midpoint, or the viewport centre. */
  function restoreAnchor(anchor: ViewAnchor, to: ViewPoint = viewportCentre()): void {
    const view = scroll.getBoundingClientRect();
    const r = anchor.page.root.getBoundingClientRect();
    const x = r.left - view.left + scroll.scrollLeft + anchor.fx * r.width;
    const y = r.top - view.top + scroll.scrollTop + anchor.fy * r.height;
    scroll.scrollTo({ left: Math.max(0, x - (to.x - view.left)), top: Math.max(0, y - (to.y - view.top)), behavior: 'auto' });
  }

  // Chrome and Firefox deliver a trackpad pinch as ctrl+wheel, so one listener covers the mouse wheel and desktop pinches.
  scroll.addEventListener(
    'wheel',
    (event) => {
      if (!score || !(event.ctrlKey || event.metaKey)) return;
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
      if (factor === 1) return;
      event.preventDefault();
      const at = { x: event.clientX, y: event.clientY };
      gestureZoom(scale * factor, viewAnchor(at), at);
    },
    { passive: false },
  );

  interface Pinch {
    distance: number;
    scale: number;
    anchor: ViewAnchor | undefined;
  }
  let pinch: Pinch | undefined;
  let gesture: { scale: number; anchor: ViewAnchor | undefined } | undefined;

  function touchSpan(touches: TouchList): { distance: number; mid: ViewPoint } {
    const a = touches[0];
    const b = touches[1];
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
    };
  }

  scroll.addEventListener(
    'touchstart',
    (event) => {
      pinch = undefined;
      if (!score || event.touches.length !== 2) return;
      const { distance, mid } = touchSpan(event.touches);
      if (distance <= 0) return;
      gesture = undefined;
      pinch = { distance, scale, anchor: viewAnchor(mid) };
    },
    { passive: true },
  );
  // Non-passive so a two-finger move can opt out of native scrolling; one finger still scrolls natively (touch-action in ui.css).
  scroll.addEventListener(
    'touchmove',
    (event) => {
      if (!pinch || event.touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      const { distance, mid } = touchSpan(event.touches);
      if (distance <= 0) return;
      gestureZoom((pinch.scale * distance) / pinch.distance, pinch.anchor, mid);
    },
    { passive: false },
  );
  const endPinch = (event: TouchEvent): void => {
    if (event.touches.length < 2) pinch = undefined;
  };
  scroll.addEventListener('touchend', endPinch);
  scroll.addEventListener('touchcancel', endPinch);

  // Desktop Safari reports trackpad pinches only through its proprietary gesture events. iOS fires them alongside
  // touch events, so an active touch pinch takes precedence and the gesture is merely kept from zooming the page.
  interface GestureLikeEvent extends Event {
    scale: number;
    clientX: number;
    clientY: number;
  }
  scroll.addEventListener('gesturestart', (event) => {
    if (!score) return;
    event.preventDefault();
    if (pinch) return;
    const e = event as GestureLikeEvent;
    gesture = { scale, anchor: viewAnchor({ x: e.clientX, y: e.clientY }) };
  });
  scroll.addEventListener('gesturechange', (event) => {
    if (!score) return;
    event.preventDefault();
    const e = event as GestureLikeEvent;
    if (!gesture || pinch || !(e.scale > 0)) return;
    gestureZoom(gesture.scale * e.scale, gesture.anchor, { x: e.clientX, y: e.clientY });
  });
  scroll.addEventListener('gestureend', () => {
    gesture = undefined;
  });

  function setFollowing(on: boolean): void {
    following = on;
    writePref('follow', on ? 'on' : 'off');
    syncFollowButton();
    if (on) scrollToCurrent(true);
  }

  function syncFollowButton(): void {
    setPressed(followButton, following);
    followButton.classList.toggle('is-on', following);
  }

  function syncZoomControls(): void {
    const value = formatZoom(zoom);
    if (typeof zoom === 'number' && !ZOOM_PRESETS.includes(zoom)) {
      const current = zoom;
      customOption.value = value;
      setText(customOption, formatScalePercent(current));
      const after = presetOptions.find((o) => Number(o.value) > current) ?? null;
      if (!customOption.isConnected || customOption.nextElementSibling !== after) zoomSelect.insertBefore(customOption, after);
    } else {
      customOption.remove();
    }
    if (zoomSelect.value !== value) zoomSelect.value = value;
    const percent = score ? ` · ${formatScalePercent(scale)}` : '';
    setText(fitWidthOption, zoom === 'fit-width' ? `Fit width${percent}` : 'Fit width');
    setText(fitPageOption, zoom === 'fit-page' ? `Fit page${percent}` : 'Fit page');
    setDisabled(zoomOutButton, stepZoom(scale, -1) === undefined);
    setDisabled(zoomInButton, stepZoom(scale, 1) === undefined);
  }

  function pct(value: number, total: number): string {
    return `${(value / total) * 100}%`;
  }

  function buildPages(model: ScoreModel, infos: PageInfo[]): void {
    intersection.disconnect();
    pagesHost.replaceChildren();
    pages = infos.map((info) => {
      const canvas = el('canvas', { class: 'page-canvas', 'aria-hidden': 'true', width: '0', height: '0' });
      const notesLayer = el('div', { class: 'notes-layer' });
      const playhead = el('div', { class: 'playhead', hidden: true }, [el('div', { class: 'playhead-line' })]);
      const overlay = el('div', { class: 'page-overlay' }, [notesLayer, playhead]);
      const placeholder = el('div', { class: 'page-placeholder', text: `Page ${info.index + 1}` });
      const pageRoot = el('div', { class: 'page', 'data-page': String(info.index), 'data-rendered': 'false' }, [
        canvas,
        placeholder,
        overlay,
      ]);
      return {
        info,
        root: pageRoot,
        canvas,
        overlay,
        notesLayer,
        placeholder,
        highlights: [],
        playhead,
        visible: false,
        rendered: false,
        renderedScale: 0,
        renderedDpr: 0,
        failedKey: '',
        inflight: false,
      };
    });

    for (const measure of model.measures) {
      const union = measureUnionBox(measure);
      if (!union) continue;
      const page = pages[union.page];
      if (!page) continue;
      const hit = el('button', {
        type: 'button',
        class: 'measure-hit',
        'data-measure': String(measure.index),
        'aria-label': `Bar ${measure.index + 1}: play from here`,
        title: `Bar ${measure.index + 1}`,
      });
      hit.style.left = pct(union.x - 2, page.info.width);
      hit.style.top = pct(union.y - MEASURE_PAD, page.info.height);
      hit.style.width = pct(union.width + 4, page.info.width);
      hit.style.height = pct(union.height + MEASURE_PAD * 2, page.info.height);
      hit.addEventListener('click', () => {
        controller.seekToMeasure(measure.index);
        pendingReveal = true;
        // Keep space/arrow shortcuts working after a click instead of re-triggering this button.
        scroll.focus({ preventScroll: true });
      });
      page.overlay.insertBefore(hit, page.notesLayer);
    }
    pagesHost.append(...pages.map((p) => p.root));
    for (const page of pages) intersection.observe(page.root);
    setText(pageLabel, `${pages.length} page${pages.length === 1 ? '' : 's'}`);
  }

  function pageDpr(page: PageView): number {
    return effectiveDpr(window.devicePixelRatio || 1, page.info.width * scale, page.info.height * scale);
  }

  function renderKey(renderScale: number, dpr: number): string {
    return `${renderScale.toFixed(4)}:${dpr}`;
  }

  function isFresh(page: PageView): boolean {
    return page.rendered && Math.abs(page.renderedScale - scale) < 0.002 && page.renderedDpr === pageDpr(page);
  }

  function scheduleRender(): void {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = undefined;
      reconcile();
    });
  }

  function release(page: PageView): void {
    if (page.inflight) return;
    if (page.canvas.width === 0 && page.canvas.height === 0 && !page.rendered) return;
    page.canvas.width = 0;
    page.canvas.height = 0;
    page.rendered = false;
    page.renderedScale = 0;
    page.renderedDpr = 0;
    page.root.dataset.rendered = 'false';
    releases++;
  }

  function reconcile(): void {
    if (!score || pages.length === 0 || root.hidden) return;
    const visible = pages.filter((p) => p.visible).map((p) => p.info.index);
    const keep = pageRange(visible, pages.length, KEEP_MARGIN_PAGES);
    for (const page of pages) {
      if (!keep || page.info.index < keep.from || page.info.index > keep.to) release(page);
    }
    void pump();
  }

  function nextToRender(): PageView | undefined {
    const visible = pages.filter((p) => p.visible).map((p) => p.info.index);
    const range = pageRange(visible, pages.length, RENDER_MARGIN_PAGES);
    if (!range) return undefined;
    for (const index of renderOrder(visible, range)) {
      const page = pages[index];
      if (!page || page.inflight || isFresh(page)) continue;
      if (page.failedKey === renderKey(scale, pageDpr(page))) continue;
      return page;
    }
    return undefined;
  }

  async function pump(): Promise<void> {
    const generation = renderGeneration;
    if (pumpGeneration === generation) return;
    pumpGeneration = generation;
    try {
      for (;;) {
        if (generation !== renderGeneration) return;
        const page = nextToRender();
        if (!page) return;
        await renderOne(page, generation);
      }
    } finally {
      if (pumpGeneration === generation) pumpGeneration = -1;
    }
  }

  async function renderOne(page: PageView, generation: number): Promise<void> {
    const renderScale = scale;
    const dpr = pageDpr(page);
    page.inflight = true;
    renderCalls++;
    try {
      await controller.renderPage(page.info.index, page.canvas, renderScale * dpr);
      if (generation !== renderGeneration) return;
      // The renderer sizes the bitmap; the page div owns the CSS box so overlays stay aligned.
      page.canvas.style.width = '100%';
      page.canvas.style.height = '100%';
      page.rendered = true;
      page.renderedScale = renderScale;
      page.renderedDpr = dpr;
      page.failedKey = '';
      page.root.dataset.rendered = 'true';
      page.root.classList.remove('is-failed');
      setText(page.placeholder, `Page ${page.info.index + 1}`);
    } catch (err) {
      if (generation !== renderGeneration) return;
      page.failedKey = renderKey(renderScale, dpr);
      page.rendered = false;
      page.root.dataset.rendered = 'false';
      page.root.classList.add('is-failed');
      setText(page.placeholder, `Page ${page.info.index + 1} could not be rendered (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      page.inflight = false;
    }
  }

  function ensureHighlights(page: PageView, count: number): void {
    while (page.highlights.length < count) {
      const box = el('div', { class: 'measure-highlight', hidden: true });
      page.overlay.insertBefore(box, page.notesLayer);
      page.highlights.push(box);
    }
  }

  function clearCurrent(): void {
    if (currentPage) {
      for (const h of currentPage.highlights) setHidden(h, true);
      setHidden(currentPage.playhead, true);
    }
    currentSegment = -1;
    currentMeasure = -1;
    currentSeg = undefined;
    currentUnion = undefined;
    currentPage = undefined;
    currentAnchors = [];
  }

  function setMeasure(model: ScoreModel, measureIndex: number): void {
    if (currentPage) {
      for (const h of currentPage.highlights) setHidden(h, true);
      setHidden(currentPage.playhead, true);
    }
    currentMeasure = measureIndex;
    const measure = model.measures[measureIndex];
    const union = measure ? measureUnionBox(measure) : undefined;
    currentUnion = union;
    currentPage = union ? pages[union.page] : undefined;
    if (!measure || !union || !currentPage) return;
    const page = currentPage;
    ensureHighlights(page, measure.layout.length);
    measure.layout.forEach((box, i) => {
      const h = page.highlights[i];
      if (box.page !== page.info.index) {
        setHidden(h, true);
        return;
      }
      h.style.left = pct(box.x, page.info.width);
      h.style.top = pct(box.y - 3, page.info.height);
      h.style.width = pct(box.width, page.info.width);
      h.style.height = pct(box.height + 6, page.info.height);
      setHidden(h, false);
    });
    page.playhead.style.left = pct(union.x, page.info.width);
    page.playhead.style.top = pct(union.y - MEASURE_PAD, page.info.height);
    page.playhead.style.width = pct(union.width, page.info.width);
    page.playhead.style.height = pct(union.height + MEASURE_PAD * 2, page.info.height);
    setHidden(page.playhead, false);
  }

  function setSegment(model: ScoreModel, segmentIndex: number): void {
    currentSegment = segmentIndex;
    currentSeg = model.timeline[segmentIndex];
    if (!currentSeg) return;
    if (currentSeg.measure !== currentMeasure || !currentPage) setMeasure(model, currentSeg.measure);
    currentAnchors = currentPage && currentUnion ? onsetAnchors(trackNotes, currentSeg, currentPage.info.index) : [];
  }

  function updatePlayhead(force: boolean, follow = true): void {
    if (!score) return;
    const positionQn = latestTransport.positionQn;
    const jumped = positionQn < lastPositionQn - 1e-6 || positionQn - lastPositionQn > SEEK_JUMP_QN;
    lastPositionQn = positionQn;
    const info = positionInfo(score, positionQn);
    if (!info) {
      clearCurrent();
      return;
    }
    const segmentChanged = info.segmentIndex !== currentSegment || force;
    if (segmentChanged) setSegment(score, info.segmentIndex);
    if (currentPage && currentUnion && currentSeg) {
      const x = (playheadX(currentAnchors, positionQn - currentSeg.startQn, currentSeg.durationQn, currentUnion) - currentUnion.x) * scale;
      currentPage.playhead.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    }
    if (follow && (segmentChanged || jumped || pendingReveal)) {
      const smooth = !force && (latestTransport.playing || jumped || pendingReveal);
      pendingReveal = false;
      scrollToCurrent(smooth);
    }
    updateNotes(positionQn);
    const text = `bar ${info.bar}`;
    if (text !== lastPositionText) {
      lastPositionText = text;
      setText(positionLabel, text);
    }
  }

  function updateNotes(positionQn: number): void {
    activeAll.length = 0;
    let key = '';
    for (const track of trackNotes) {
      activeNotes(track.sorted, positionQn, track.maxDuration, activeBuffer);
      for (const note of activeBuffer) {
        if (!note.layout) continue;
        activeAll.push(note);
        key += note.id + ',';
      }
    }
    if (key === lastNotesKey) return;
    lastNotesKey = key;
    activeAll.forEach((note, i) => {
      let node = notePool[i];
      if (!node) {
        node = el('div', { class: 'note-highlight' });
        notePool.push(node);
      }
      const layout = note.layout!;
      const page = pages[layout.page];
      if (!page) {
        setHidden(node, true);
        return;
      }
      if (node.parentElement !== page.notesLayer) page.notesLayer.append(node);
      node.style.transform = `translate3d(${(layout.x * scale).toFixed(1)}px, ${(layout.y * scale).toFixed(1)}px, 0)`;
      setHidden(node, false);
    });
    for (let i = activeAll.length; i < notePool.length; i++) setHidden(notePool[i], true);
  }

  function scrollToCurrent(smooth: boolean): void {
    if (!following || !currentPage || !currentUnion || root.hidden) return;
    const view = scroll.getBoundingClientRect();
    const pageRect = currentPage.root.getBoundingClientRect();
    const pageTop = pageRect.top - view.top + scroll.scrollTop;
    const pageLeft = pageRect.left - view.left + scroll.scrollLeft;
    const top = pageTop + (currentUnion.y - MEASURE_PAD) * scale;
    const bottom = pageTop + (currentUnion.y + currentUnion.height + MEASURE_PAD) * scale;
    const left = pageLeft + currentUnion.x * scale;
    const right = pageLeft + (currentUnion.x + currentUnion.width) * scale;
    const viewTop = scroll.scrollTop;
    const viewLeft = scroll.scrollLeft;
    const margin = 32;

    let targetTop = viewTop;
    if (top < viewTop + margin || bottom > viewTop + scroll.clientHeight - margin) {
      const pageHeight = currentPage.info.height * scale;
      // A page that fits the viewport is shown whole rather than scrolled bar by bar.
      targetTop =
        pageHeight <= scroll.clientHeight - margin
          ? pageTop - (scroll.clientHeight - pageHeight) / 2
          : top - scroll.clientHeight * 0.3;
      targetTop = Math.max(0, targetTop);
    }

    let targetLeft = viewLeft;
    const overflowsX = scroll.scrollWidth > scroll.clientWidth + 1;
    if (overflowsX && (left < viewLeft + margin || right > viewLeft + scroll.clientWidth - margin)) {
      targetLeft = Math.max(0, Math.min(left - scroll.clientWidth * 0.3, scroll.scrollWidth - scroll.clientWidth));
    }

    if (targetTop === viewTop && targetLeft === viewLeft) return;
    // Far jumps scroll instantly: animating through many pages would render each one on the way.
    const far = Math.abs(targetTop - viewTop) > scroll.clientHeight * 2;
    scroll.scrollTo({ top: targetTop, left: targetLeft, behavior: smooth && !far ? 'smooth' : 'auto' });
  }

  function resetScore(next: ScoreModel | undefined, infos: PageInfo[]): void {
    score = next;
    renderGeneration++;
    clearCurrent();
    lastNotesKey = '';
    lastPositionText = '';
    lastPositionQn = 0;
    pendingReveal = false;
    for (const node of notePool) node.remove();
    notePool.length = 0;
    setText(positionLabel, '');
    if (score) {
      trackNotes = indexTracks(score);
      buildPages(score, infos);
      applyScale(computeScale());
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      scheduleRender();
    } else {
      trackNotes = [];
      intersection.disconnect();
      pages = [];
      pagesHost.replaceChildren();
      setText(pageLabel, '');
    }
  }

  function update(state: AppState): void {
    latestTransport = state.transport;
    const busy = state.status === 'loading' || state.status === 'parsing';
    setHidden(root, !state.score || busy);
    if (state.score !== score) resetScore(state.score, state.pages);
    if (!score) return;
    checkDpr();
    if (state.transport.playing !== lastPlaying) {
      lastPlaying = state.transport.playing;
      root.classList.toggle('is-playing', lastPlaying);
      if (lastPlaying) pendingReveal = true;
    }
    updatePlayhead(false);
  }

  return {
    el: root,
    scroll,
    update,
    reveal() {
      pendingReveal = true;
    },
    getScale: () => scale,
    getZoom: () => zoom,
    setZoom,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    isFollowing: () => following,
    setFollowing,
    getRenderStats: () => ({
      renderCalls,
      releases,
      renderedPages: pages.filter((p) => p.rendered).length,
      freshPages: pages.filter(isFresh).length,
      bitmapBytes: bitmapBytes(pages.map((p) => p.canvas)),
      visiblePages: pages.filter((p) => p.visible).map((p) => p.info.index),
      scale,
    }),
    dispose() {
      renderGeneration++;
      resizeObserver.disconnect();
      intersection.disconnect();
      dprQuery?.removeEventListener('change', checkDpr);
      window.clearInterval(dprTimer);
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      root.remove();
    },
  };
}
