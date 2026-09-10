import type { AppState } from '../core/types';
import { el, setDisabled, setHidden, setPressed, setText } from './dom';
import { describeKey, describeTimeSignature, formatBpm } from './format';
import { icons } from './icons';

export interface HeaderDeps {
  onOpenFile(): void;
  onLoadDemo(): void;
}

export interface HeaderView {
  el: HTMLElement;
  update(state: AppState): void;
  setWarningsOpen(open: boolean): void;
  dispose(): void;
}

export function createHeader(deps: HeaderDeps): HeaderView {
  const title = el('h1', { class: 'header-title', text: 'No score loaded' });
  const subtitle = el('div', { class: 'header-subtitle', text: 'Open a PDF to get started' });
  const meta = el('div', { class: 'header-meta' });

  const warningsList = el('ul', { class: 'warnings-list' });
  const warningsPopover = el('div', { class: 'warnings-popover', role: 'dialog', 'aria-label': 'Parse warnings', hidden: true }, [
    el('div', { class: 'warnings-popover-title', text: 'Parse warnings' }),
    warningsList,
  ]);
  const warningsCount = el('span', { class: 'warnings-count', text: '0' });
  const warningsButton = el(
    'button',
    {
      type: 'button',
      class: 'chip chip-button chip-warning',
      'data-action': 'toggle-warnings',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      hidden: true,
    },
    [el('span', { class: 'chip-icon', html: icons.warning }), warningsCount, el('span', { text: ' warnings' })],
  );
  const warningsWrap = el('div', { class: 'warnings-wrap' }, [warningsButton, warningsPopover]);

  const openButton = el('button', { type: 'button', class: 'button', 'data-action': 'open-file', 'aria-label': 'Open PDF', title: 'Open PDF…' }, [
    el('span', { class: 'button-icon', html: icons.folder }),
    el('span', { class: 'button-label', text: 'Open PDF…' }),
  ]);
  const demoButton = el('button', { type: 'button', class: 'button button-primary', 'data-action': 'load-demo', 'aria-label': 'Load demo score', title: 'Load demo' }, [
    el('span', { class: 'button-icon', html: icons.note }),
    el('span', { class: 'button-label', text: 'Load demo' }),
  ]);
  openButton.addEventListener('click', () => deps.onOpenFile());
  demoButton.addEventListener('click', () => deps.onLoadDemo());

  const root = el('header', { class: 'header', role: 'banner' }, [
    el('div', { class: 'header-brand' }, [
      el('span', { class: 'header-logo', html: icons.logo }),
      el('div', { class: 'header-brand-text' }, [
        el('span', { class: 'header-app-name', text: 'Sheet Music Reader' }),
        el('span', { class: 'header-app-tag', text: 'PDF → layered playback' }),
      ]),
    ]),
    el('div', { class: 'header-score' }, [title, subtitle, meta]),
    el('div', { class: 'header-actions' }, [warningsWrap, openButton, demoButton]),
  ]);

  let warningsOpen = false;
  const setWarningsOpen = (open: boolean): void => {
    warningsOpen = open;
    setHidden(warningsPopover, !open);
    warningsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    setPressed(warningsButton, open);
  };
  warningsButton.addEventListener('click', () => setWarningsOpen(!warningsOpen));
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (warningsOpen && !warningsWrap.contains(event.target as Node)) setWarningsOpen(false);
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && warningsOpen) setWarningsOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);

  let lastScore: AppState['score'];
  let lastStatus: AppState['status'] | undefined;
  let lastFileName: string | undefined;
  let lastWarningsKey = '';

  const chip = (label: string, value: string, extraClass = ''): HTMLElement =>
    el('span', { class: `chip ${extraClass}`.trim() }, [
      el('span', { class: 'chip-label', text: label }),
      el('span', { class: 'chip-value', text: value }),
    ]);

  function renderMeta(state: AppState): void {
    meta.replaceChildren();
    const score = state.score;
    if (!score) return;
    meta.append(chip('pages', String(score.source.pageCount)));
    meta.append(chip('tracks', String(score.tracks.length)));
    meta.append(chip('bars', String(score.measures.length)));
    const sig = describeTimeSignature(score.timeSignatures[0]);
    if (sig) meta.append(chip('time', sig));
    const key = describeKey(score.keySignatures[0]?.fifths);
    if (key) meta.append(chip('key', key));
    meta.append(chip('tempo', `${formatBpm(score.tempoBpm)} bpm`));
  }

  function update(state: AppState): void {
    const score = state.score;
    const busy = state.status === 'loading' || state.status === 'parsing';
    setDisabled(openButton, busy);
    setDisabled(demoButton, busy);

    if (score !== lastScore || state.status !== lastStatus || state.fileName !== lastFileName) {
      lastScore = score;
      lastStatus = state.status;
      lastFileName = state.fileName;
      if (busy) {
        setText(title, state.fileName || 'Loading…');
        setText(subtitle, state.status === 'parsing' ? 'Reading the score…' : 'Loading file…');
      } else if (score) {
        const fileName = score.source.fileName || state.fileName || '';
        setText(title, score.title || fileName || 'Untitled score');
        setText(subtitle, [score.composer, fileName].filter(Boolean).join('  ·  '));
      } else if (state.status === 'error') {
        setText(title, state.fileName || 'Could not open score');
        setText(subtitle, 'The file could not be read');
      } else {
        setText(title, 'No score loaded');
        setText(subtitle, 'Open a PDF to get started');
      }
      renderMeta(state);
    }

    const warnings = score?.warnings ?? [];
    const key = `${warnings.length}:${warnings.join('')}`;
    if (key !== lastWarningsKey) {
      lastWarningsKey = key;
      setHidden(warningsButton, warnings.length === 0);
      setText(warningsCount, String(warnings.length));
      warningsButton.setAttribute(
        'aria-label',
        `${warnings.length} parse warning${warnings.length === 1 ? '' : 's'}, show list`,
      );
      warningsList.replaceChildren(...warnings.map((w) => el('li', { text: w })));
      if (warnings.length === 0) setWarningsOpen(false);
    }
  }

  return {
    el: root,
    update,
    setWarningsOpen,
    dispose() {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      root.remove();
    },
  };
}
