import type { AppController } from '../core/contracts';
import type { AppState } from '../core/types';
import { el, iconButton, setDisabled, setPressed, setText } from './dom';
import { TEMPO_MAX, TEMPO_MIN, clamp, formatBpm, formatPercent, formatPosition, formatQnClock } from './format';
import { icons } from './icons';

export interface TransportDeps {
  controller: AppController;
  onError(message: string): void;
  /** Called after every seek the user makes from the bar so the score view can reveal the playhead. */
  onUserSeek?(): void;
}

export interface TransportBar {
  el: HTMLElement;
  update(state: AppState): void;
}

export function createTransportBar(deps: TransportDeps): TransportBar {
  const { controller } = deps;
  const guard = (promise: Promise<void>): void => {
    promise.catch((err) => deps.onError(err instanceof Error ? err.message : String(err)));
  };

  const userSeek = (qn: number): void => {
    controller.seek(qn);
    deps.onUserSeek?.();
  };
  const rewindButton = iconButton({
    icon: icons.rewind,
    label: 'Rewind to start',
    action: 'rewind',
    onClick: () => userSeek(0),
  });
  const playButton = iconButton({
    icon: icons.play,
    label: 'Play',
    action: 'toggle-play',
    class: 'transport-play',
    attrs: { 'aria-pressed': 'false' },
    onClick: () => guard(controller.togglePlay()),
  });
  const stopButton = iconButton({
    icon: icons.stop,
    label: 'Stop',
    action: 'stop',
    onClick: () => {
      controller.stop();
      deps.onUserSeek?.();
    },
  });

  const barBeat = el('div', { class: 'transport-bar-beat', 'data-role': 'position', text: 'bar –' });
  const elapsed = el('span', { class: 'transport-elapsed', text: '0:00' });
  const total = el('span', { class: 'transport-total', text: '0:00' });
  const clock = el('div', { class: 'transport-clock', 'aria-label': 'Elapsed and total time' }, [
    elapsed,
    el('span', { class: 'transport-clock-sep', text: ' / ' }),
    total,
  ]);

  const seek = el('input', {
    type: 'range',
    class: 'slider slider-seek',
    'data-control': 'seek',
    min: '0',
    max: '1',
    step: '0.01',
    value: '0',
    'aria-label': 'Seek position',
  });
  let scrubbing = false;
  seek.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  const endScrub = (): void => {
    scrubbing = false;
  };
  seek.addEventListener('pointerup', endScrub);
  seek.addEventListener('pointercancel', endScrub);
  seek.addEventListener('blur', endScrub);
  seek.addEventListener('input', () => {
    userSeek(Number(seek.value));
  });
  seek.addEventListener('change', endScrub);

  const tempoSlider = el('input', {
    type: 'range',
    class: 'slider slider-tempo',
    'data-control': 'tempo',
    min: String(TEMPO_MIN),
    max: String(TEMPO_MAX),
    step: '1',
    value: '100',
    'aria-label': 'Tempo in beats per minute',
  });
  const tempoNumber = el('input', {
    type: 'number',
    class: 'number-input',
    'data-control': 'tempo-value',
    min: String(TEMPO_MIN),
    max: String(TEMPO_MAX),
    step: '1',
    value: '100',
    'aria-label': 'Tempo value',
  });
  const tempoReset = iconButton({
    icon: icons.reset,
    label: 'Reset tempo to score tempo',
    action: 'reset-tempo',
    class: 'icon-button-small',
    onClick: () => {
      if (scoreTempo !== undefined) controller.setTempo(scoreTempo);
    },
  });
  const applyTempo = (raw: string): void => {
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) {
      if (lastTempo !== undefined) tempoNumber.value = formatBpm(lastTempo);
      return;
    }
    const bpm = clamp(Math.round(parsed), TEMPO_MIN, TEMPO_MAX);
    tempoNumber.value = String(bpm);
    controller.setTempo(bpm);
  };
  tempoSlider.addEventListener('input', () => applyTempo(tempoSlider.value));
  tempoNumber.addEventListener('change', () => applyTempo(tempoNumber.value));
  tempoNumber.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      applyTempo(tempoNumber.value);
      tempoNumber.blur();
    }
  });
  tempoNumber.addEventListener('blur', () => {
    const shown = Number(tempoNumber.value);
    if (tempoNumber.value.trim() === '' || !Number.isFinite(shown) || shown < TEMPO_MIN || shown > TEMPO_MAX) {
      tempoNumber.value = formatBpm(lastTempo ?? clamp(shown, TEMPO_MIN, TEMPO_MAX));
    }
  });

  const master = el('input', {
    type: 'range',
    class: 'slider slider-master',
    'data-control': 'master-gain',
    min: '0',
    max: '1',
    step: '0.01',
    value: '0.9',
    'aria-label': 'Master volume',
  });
  const masterValue = el('span', { class: 'transport-master-value', text: '90%' });
  master.addEventListener('input', () => controller.setMasterGain(Number(master.value)));

  const root = el('footer', { class: 'transport', role: 'region', 'aria-label': 'Transport' }, [
    el('div', { class: 'transport-buttons' }, [rewindButton, playButton, stopButton]),
    el('div', { class: 'transport-position' }, [barBeat, clock]),
    el('div', { class: 'transport-seek' }, [seek]),
    el('div', { class: 'transport-group transport-tempo' }, [
      el('span', { class: 'transport-label', text: 'Tempo' }),
      tempoSlider,
      el('div', { class: 'transport-tempo-value' }, [tempoNumber, el('span', { class: 'transport-unit', text: 'bpm' })]),
      tempoReset,
    ]),
    el('div', { class: 'transport-group transport-master' }, [
      el('span', { class: 'transport-label transport-label-icon', html: icons.volume, 'aria-hidden': 'true' }),
      master,
      masterValue,
    ]),
  ]);

  let scoreTempo: number | undefined;
  let lastScore: AppState['score'];
  let lastPlaying: boolean | undefined;
  let lastTempo: number | undefined;
  let lastMaster: number | undefined;
  let lastPositionText = '';
  let lastElapsed = '';
  let lastTotal = '';
  let lastSeekMax = '';
  let lastFill = -1;

  function update(state: AppState): void {
    const { transport, score } = state;
    const hasScore = !!score;
    if (score !== lastScore) {
      lastScore = score;
      scoreTempo = score?.tempoBpm;
      const max = score ? String(score.durationQn) : '1';
      if (max !== lastSeekMax) {
        lastSeekMax = max;
        seek.max = max;
      }
      lastTotal = '';
      tempoReset.title = scoreTempo !== undefined ? `Reset tempo to ${formatBpm(scoreTempo)} bpm` : 'Reset tempo';
      tempoReset.setAttribute('aria-label', tempoReset.title);
    }
    setDisabled(playButton, !hasScore);
    setDisabled(stopButton, !hasScore);
    setDisabled(rewindButton, !hasScore);
    setDisabled(seek, !hasScore);
    setDisabled(tempoSlider, !hasScore);
    setDisabled(tempoNumber, !hasScore);

    if (transport.playing !== lastPlaying) {
      lastPlaying = transport.playing;
      playButton.innerHTML = transport.playing ? icons.pause : icons.play;
      const label = transport.playing ? 'Pause' : 'Play';
      playButton.setAttribute('aria-label', label);
      playButton.title = `${label} (space)`;
      setPressed(playButton, transport.playing);
      playButton.classList.toggle('is-playing', transport.playing);
    }

    const positionText = formatPosition(score, transport.positionQn);
    const elapsedText = formatQnClock(transport.positionQn, transport.tempoBpm);
    if (positionText !== lastPositionText || elapsedText !== lastElapsed) {
      lastPositionText = positionText;
      lastElapsed = elapsedText;
      setText(barBeat, positionText);
      setText(elapsed, elapsedText);
      seek.setAttribute('aria-valuetext', `${positionText}, ${elapsedText}`);
    }
    const totalText = score ? formatQnClock(score.durationQn, transport.tempoBpm) : '0:00';
    if (totalText !== lastTotal) {
      lastTotal = totalText;
      setText(total, totalText);
    }

    if (!scrubbing) {
      const value = hasScore ? transport.positionQn : 0;
      const fill = score && score.durationQn > 0 ? clamp(value / score.durationQn, 0, 1) : 0;
      seek.value = String(value);
      if (Math.abs(fill - lastFill) > 0.0005) {
        lastFill = fill;
        seek.style.setProperty('--fill', `${(fill * 100).toFixed(2)}%`);
      }
    }

    if (transport.tempoBpm !== lastTempo) {
      lastTempo = transport.tempoBpm;
      const text = formatBpm(transport.tempoBpm);
      tempoSlider.value = text;
      if (document.activeElement !== tempoNumber) tempoNumber.value = text;
      tempoSlider.style.setProperty('--fill', `${(((transport.tempoBpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * 100).toFixed(2)}%`);
      tempoSlider.setAttribute('aria-valuetext', `${text} bpm`);
    }
    setDisabled(tempoReset, !hasScore || scoreTempo === undefined || Math.round(transport.tempoBpm) === Math.round(scoreTempo));

    if (transport.masterGain !== lastMaster) {
      lastMaster = transport.masterGain;
      master.value = String(transport.masterGain);
      master.style.setProperty('--fill', `${(clamp(transport.masterGain, 0, 1) * 100).toFixed(2)}%`);
      setText(masterValue, formatPercent(transport.masterGain));
    }
  }

  return { el: root, update };
}
