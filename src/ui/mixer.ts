import type { AppController } from '../core/contracts';
import type { AppState, ScoreModel, Track, TrackMixState } from '../core/types';
import { el, iconButton, setDisabled, setHidden, setPressed, setText } from './dom';
import { clamp, clefLabel, formatDb } from './format';
import { icons } from './icons';

const PEAK_HOLD_MS = 900;
const PEAK_DECAY_PER_SECOND = 1.2;
/** Above this many tracks the strips switch to the compact width. */
const COMPACT_ABOVE = 4;

interface Strip {
  track: Track;
  root: HTMLElement;
  fader: HTMLInputElement;
  gainText: HTMLElement;
  muteButton: HTMLButtonElement;
  soloButton: HTMLButtonElement;
  meterCover: HTMLElement;
  peakMark: HTMLElement;
  lastGain: number;
  lastMuted: boolean | undefined;
  lastSolo: boolean | undefined;
  lastLevel: number;
  peak: number;
  peakShown: number;
  peakHeldUntil: number;
  dragging: boolean;
}

export interface MixerDeps {
  controller: AppController;
}

export interface MixerOverflow {
  overflow: boolean;
  hiddenStrips: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface Mixer {
  el: HTMLElement;
  update(state: AppState): void;
  getOverflow(): MixerOverflow;
  dispose(): void;
}

export function createMixer(deps: MixerDeps): Mixer {
  const { controller } = deps;
  const stripsHost = el('div', { class: 'mixer-strips', role: 'list' });
  const stripsWrap = el('div', { class: 'mixer-strips-wrap' }, [stripsHost]);
  const empty = el('div', { class: 'mixer-empty', text: 'Tracks appear here once a score is loaded.' });
  const countLabel = el('span', { class: 'toolbar-text', text: '' });
  const moreLabel = el('span', { class: 'mixer-more', text: '', hidden: true, 'aria-live': 'polite' });
  const scrollLeft = iconButton({
    icon: icons.chevronLeft,
    label: 'Scroll mixer left',
    action: 'mixer-scroll-left',
    class: 'icon-button-small mixer-scroll',
    onClick: () => stripsHost.scrollBy({ left: -stripPitch(), behavior: 'smooth' }),
  });
  const scrollRight = iconButton({
    icon: icons.chevronRight,
    label: 'Scroll mixer right',
    action: 'mixer-scroll-right',
    class: 'icon-button-small mixer-scroll',
    onClick: () => stripsHost.scrollBy({ left: stripPitch(), behavior: 'smooth' }),
  });
  const scrollButtons = el('div', { class: 'mixer-scroll-buttons', hidden: true }, [scrollLeft, scrollRight]);
  const root = el('aside', { class: 'mixer', 'aria-label': 'Mixer' }, [
    el('div', { class: 'mixer-toolbar' }, [
      el('span', { class: 'panel-title', text: 'Mixer' }),
      countLabel,
      el('span', { class: 'toolbar-spacer' }),
      moreLabel,
      scrollButtons,
    ]),
    stripsWrap,
    empty,
  ]);

  let score: ScoreModel | undefined;
  let strips: Strip[] = [];
  let peakFrame: number | undefined;
  let lastPeakTick = 0;
  let overflowFrame: number | undefined;
  let overflowState: MixerOverflow = { overflow: false, hiddenStrips: 0, clientWidth: 0, scrollWidth: 0 };

  function stripPitch(): number {
    const first = strips[0]?.root;
    return first ? first.offsetWidth + 8 : 126;
  }

  function scheduleOverflow(): void {
    if (overflowFrame !== undefined) return;
    overflowFrame = requestAnimationFrame(() => {
      overflowFrame = undefined;
      updateOverflow();
    });
  }

  function updateOverflow(): void {
    const clientWidth = stripsHost.clientWidth;
    const scrollWidth = stripsHost.scrollWidth;
    const overflow = scrollWidth - clientWidth > 1;
    const left = stripsHost.scrollLeft;
    const viewRight = left + clientWidth;
    let hidden = 0;
    let hiddenRight = 0;
    for (const strip of strips) {
      const x0 = strip.root.offsetLeft - stripsHost.offsetLeft;
      const width = strip.root.offsetWidth;
      const shown = Math.min(x0 + width, viewRight) - Math.max(x0, left);
      // A strip counts as hidden once less than three quarters of it is in view.
      if (shown < width * 0.75) {
        hidden++;
        if (x0 + width > viewRight) hiddenRight++;
      }
    }
    overflowState = { overflow, hiddenStrips: hidden, clientWidth, scrollWidth };
    root.classList.toggle('has-overflow', overflow);
    root.classList.toggle('can-scroll-left', overflow && left > 1);
    root.classList.toggle('can-scroll-right', overflow && viewRight < scrollWidth - 1);
    setHidden(scrollButtons, !overflow);
    setDisabled(scrollLeft, !(left > 1));
    setDisabled(scrollRight, !(viewRight < scrollWidth - 1));
    setHidden(moreLabel, !overflow || hiddenRight === 0);
    if (overflow && hiddenRight > 0) setText(moreLabel, `+${hiddenRight} more`);
  }

  const resizeObserver = new ResizeObserver(scheduleOverflow);
  resizeObserver.observe(stripsHost);
  stripsHost.addEventListener('scroll', scheduleOverflow, { passive: true });

  function buildStrips(model: ScoreModel): void {
    stripsHost.replaceChildren();
    strips = model.tracks.map((track, i) => {
      const fader = el('input', {
        type: 'range',
        class: 'fader',
        'data-control': 'track-gain',
        'data-track': track.id,
        min: '0',
        max: '1',
        step: '0.01',
        value: String(clamp(track.defaultGain, 0, 1)),
        'aria-label': `${track.name} gain`,
        'aria-orientation': 'vertical',
      });
      const gainText = el('span', { class: 'strip-gain', text: formatDb(track.defaultGain) });
      const muteButton = el('button', {
        type: 'button',
        class: 'strip-toggle strip-mute',
        'data-action': 'mute',
        'data-track': track.id,
        'aria-pressed': 'false',
        'aria-label': `Mute ${track.name}`,
        title: `Mute ${track.name}`,
        text: 'M',
      });
      const soloButton = el('button', {
        type: 'button',
        class: 'strip-toggle strip-solo',
        'data-action': 'solo',
        'data-track': track.id,
        'aria-pressed': 'false',
        'aria-label': `Solo ${track.name}`,
        title: `Solo ${track.name}`,
        text: 'S',
      });
      const meterCover = el('div', { class: 'meter-cover' });
      const peakMark = el('div', { class: 'meter-peak' });
      const meter = el('div', { class: 'meter', 'aria-hidden': 'true' }, [
        el('div', { class: 'meter-fill' }),
        meterCover,
        peakMark,
      ]);
      const stripRoot = el(
        'div',
        { class: 'strip', role: 'listitem', 'data-track': track.id, style: `--strip-hue: ${(i * 47 + 200) % 360}` },
        [
          el('div', { class: 'strip-header' }, [
            el('span', { class: 'strip-index', text: String(i + 1) }),
            el('span', { class: 'strip-name', text: track.name, title: `${track.name} · ${track.instrument}` }),
          ]),
          el('div', { class: 'strip-badges' }, [
            el('span', { class: `clef-badge clef-${track.clef}`, title: `${track.clef} clef`, text: clefLabel(track.clef) }),
            el('span', { class: 'strip-instrument', text: track.instrument }),
          ]),
          el('div', { class: 'strip-body' }, [meter, el('div', { class: 'fader-well' }, [fader])]),
          gainText,
          el('div', { class: 'strip-toggles' }, [muteButton, soloButton]),
        ],
      );

      const strip: Strip = {
        track,
        root: stripRoot,
        fader,
        gainText,
        muteButton,
        soloButton,
        meterCover,
        peakMark,
        lastGain: -1,
        lastMuted: undefined,
        lastSolo: undefined,
        lastLevel: -1,
        peak: 0,
        peakShown: -1,
        peakHeldUntil: 0,
        dragging: false,
      };
      fader.addEventListener('pointerdown', () => {
        strip.dragging = true;
      });
      const endDrag = (): void => {
        strip.dragging = false;
      };
      fader.addEventListener('pointerup', endDrag);
      fader.addEventListener('pointercancel', endDrag);
      fader.addEventListener('blur', endDrag);
      fader.addEventListener('change', endDrag);
      fader.addEventListener('input', () => {
        const gain = clamp(Number(fader.value), 0, 1);
        setText(gainText, formatDb(gain));
        controller.setTrackGain(track.id, gain);
      });
      fader.addEventListener('dblclick', () => controller.setTrackGain(track.id, track.defaultGain));
      muteButton.addEventListener('click', () => {
        controller.setTrackMuted(track.id, muteButton.getAttribute('aria-pressed') !== 'true');
      });
      soloButton.addEventListener('click', () => {
        controller.setTrackSolo(track.id, soloButton.getAttribute('aria-pressed') !== 'true');
      });
      return strip;
    });
    stripsHost.append(...strips.map((s) => s.root));
    root.style.setProperty('--track-count', String(strips.length));
    root.classList.toggle('is-compact', strips.length > COMPACT_ABOVE);
    setText(countLabel, `${strips.length} track${strips.length === 1 ? '' : 's'}`);
    stripsHost.scrollLeft = 0;
    scheduleOverflow();
  }

  function paintPeak(strip: Strip): void {
    if (Math.abs(strip.peak - strip.peakShown) < 0.002) return;
    strip.peakShown = strip.peak;
    strip.peakMark.style.transform = `translateY(${((1 - strip.peak) * 100).toFixed(2)}%)`;
    strip.peakMark.style.opacity = strip.peak > 0.01 ? '1' : '0';
  }

  function tickPeaks(now: number): void {
    peakFrame = undefined;
    const dt = lastPeakTick ? Math.min(0.1, (now - lastPeakTick) / 1000) : 0;
    lastPeakTick = now;
    let active = false;
    for (const strip of strips) {
      if (now > strip.peakHeldUntil && strip.peak > 0) {
        strip.peak = Math.max(strip.lastLevel > 0 ? strip.lastLevel : 0, strip.peak - PEAK_DECAY_PER_SECOND * dt);
      }
      paintPeak(strip);
      if (strip.peak > 0.005) active = true;
    }
    if (active) peakFrame = requestAnimationFrame(tickPeaks);
    else lastPeakTick = 0;
  }

  function ensurePeakLoop(): void {
    if (peakFrame === undefined) peakFrame = requestAnimationFrame(tickPeaks);
  }

  function applyMix(strip: Strip, mix: TrackMixState | undefined, anySolo: boolean): void {
    const gain = mix ? mix.gain : strip.track.defaultGain;
    const muted = mix ? mix.muted : false;
    const solo = mix ? mix.solo : false;
    const level = mix ? mix.level : 0;

    if (gain !== strip.lastGain) {
      strip.lastGain = gain;
      if (!strip.dragging) strip.fader.value = String(gain);
      setText(strip.gainText, formatDb(gain));
      strip.fader.setAttribute('aria-valuetext', formatDb(gain));
    }
    if (muted !== strip.lastMuted) {
      strip.lastMuted = muted;
      setPressed(strip.muteButton, muted);
      strip.muteButton.classList.toggle('is-on', muted);
    }
    if (solo !== strip.lastSolo) {
      strip.lastSolo = solo;
      setPressed(strip.soloButton, solo);
      strip.soloButton.classList.toggle('is-on', solo);
    }
    const silenced = muted || (anySolo && !solo);
    strip.root.classList.toggle('is-silenced', silenced);

    const shown = clamp(level, 0, 1);
    if (Math.abs(shown - strip.lastLevel) > 0.002) {
      strip.lastLevel = shown;
      strip.meterCover.style.transform = `scaleY(${(1 - shown).toFixed(3)})`;
    }
    if (shown >= strip.peak) {
      strip.peak = shown;
      strip.peakHeldUntil = performance.now() + PEAK_HOLD_MS;
      paintPeak(strip);
    }
    if (strip.peak > 0.005) ensurePeakLoop();
  }

  function update(state: AppState): void {
    if (state.score !== score) {
      score = state.score;
      if (score) buildStrips(score);
      else {
        strips = [];
        stripsHost.replaceChildren();
        root.style.removeProperty('--track-count');
        root.classList.remove('is-compact');
        setText(countLabel, '');
        scheduleOverflow();
      }
    }
    setHidden(empty, !!score);
    setHidden(stripsWrap, !score);
    if (!score) return;
    const mixes = state.transport.tracks;
    const anySolo = mixes.some((m) => m.solo);
    for (const strip of strips) {
      applyMix(strip, mixes.find((m) => m.trackId === strip.track.id), anySolo);
    }
  }

  return {
    el: root,
    update,
    getOverflow: () => overflowState,
    dispose() {
      resizeObserver.disconnect();
      if (peakFrame !== undefined) cancelAnimationFrame(peakFrame);
      if (overflowFrame !== undefined) cancelAnimationFrame(overflowFrame);
      root.remove();
    },
  };
}
