import type { AppState } from '../core/types';
import { el, setDisabled, setHidden, setText } from './dom';
import { icons } from './icons';

export interface HeaderDeps {
  onOpenFile(): void;
  onLoadDemo(): void;
  /** Extra controls placed ahead of the open/demo buttons. */
  actions?: HTMLElement[];
}

export interface HeaderView {
  el: HTMLElement;
  update(state: AppState): void;
  dispose(): void;
}

export function createHeader(deps: HeaderDeps): HeaderView {
  const title = el('h1', { class: 'header-title', text: 'No score loaded' });
  const subtitle = el('div', { class: 'header-subtitle', text: 'Open a PDF to get started' });
  const scoreInfo = el('div', { class: 'header-score' }, [title, subtitle]);

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
    scoreInfo,
    el('div', { class: 'header-actions' }, [...(deps.actions ?? []), openButton, demoButton]),
  ]);

  let lastScore: AppState['score'];
  let lastStatus: AppState['status'] | undefined;
  let lastFileName: string | undefined;

  function update(state: AppState): void {
    const score = state.score;
    const busy = state.status === 'loading' || state.status === 'parsing';
    setDisabled(openButton, busy);
    setDisabled(demoButton, busy);
    setHidden(demoButton, !!score);

    if (score !== lastScore || state.status !== lastStatus || state.fileName !== lastFileName) {
      lastScore = score;
      lastStatus = state.status;
      lastFileName = state.fileName;
      setHidden(scoreInfo, !!score && !busy);
      if (busy) {
        setText(title, state.fileName || 'Loading…');
        setText(subtitle, state.status === 'parsing' ? 'Reading the score…' : 'Loading file…');
      } else if (state.status === 'error') {
        setText(title, state.fileName || 'Could not open score');
        setText(subtitle, 'The file could not be read');
      } else if (!score) {
        setText(title, 'No score loaded');
        setText(subtitle, 'Open a PDF to get started');
      }
    }
  }

  return {
    el: root,
    update,
    dispose() {
      root.remove();
    },
  };
}
