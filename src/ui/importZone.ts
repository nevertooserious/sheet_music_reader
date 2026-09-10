import type { AppController } from '../core/contracts';
import type { AppState } from '../core/types';
import { el, setHidden, setText } from './dom';
import { formatPercent } from './format';
import { icons } from './icons';

type LoadRequest = { kind: 'demo' } | { kind: 'file'; file: File };

export interface ImportZoneDeps {
  controller: AppController;
  /** Element that receives drag-and-drop over the whole app. */
  dropTarget: HTMLElement;
}

export interface ImportZone {
  fileInput: HTMLInputElement;
  dropOverlay: HTMLElement;
  banner: HTMLElement;
  stage: HTMLElement;
  openFilePicker(): void;
  loadDemo(): void;
  update(state: AppState): void;
  dispose(): void;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function createImportZone(deps: ImportZoneDeps): ImportZone {
  const { controller, dropTarget } = deps;
  let lastRequest: LoadRequest | undefined;
  let localError: string | undefined;
  let dismissedError: string | undefined;

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    class: 'visually-hidden',
    'aria-label': 'Choose a PDF score',
    tabindex: '-1',
  });

  const run = (request: LoadRequest): void => {
    lastRequest = request;
    localError = undefined;
    dismissedError = undefined;
    const promise = request.kind === 'demo' ? controller.loadDemo() : controller.loadFile(request.file);
    promise.catch(() => undefined);
  };

  const openFilePicker = (): void => {
    fileInput.value = '';
    fileInput.click();
  };
  const loadDemo = (): void => run({ kind: 'demo' });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) acceptFile(file);
  });

  function acceptFile(file: File): void {
    if (!isPdf(file)) {
      localError = `"${file.name}" is not a PDF. Only PDF sheet music is supported.`;
      render(latest);
      return;
    }
    run({ kind: 'file', file });
  }

  const dropOverlay = el('div', { class: 'drop-overlay', hidden: true, 'aria-hidden': 'true' }, [
    el('div', { class: 'drop-overlay-card' }, [
      el('span', { class: 'drop-overlay-icon', html: icons.upload }),
      el('div', { class: 'drop-overlay-title', text: 'Drop PDF to open' }),
      el('div', { class: 'drop-overlay-hint', text: 'Vector-engraved scores (LilyPond, MuseScore, Finale, Sibelius)' }),
    ]),
  ]);

  let dragDepth = 0;
  const hasFiles = (event: DragEvent): boolean =>
    !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  const showDrop = (on: boolean): void => {
    setHidden(dropOverlay, !on);
    dropTarget.classList.toggle('is-dragging', on);
  };
  dropTarget.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    showDrop(true);
  });
  dropTarget.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropTarget.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) showDrop(false);
  });
  dropTarget.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    showDrop(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) acceptFile(file);
  });
  const onWindowDragEnd = (): void => {
    dragDepth = 0;
    showDrop(false);
  };
  window.addEventListener('dragend', onWindowDragEnd);

  const bannerText = el('span', { class: 'banner-text' });
  const retryButton = el('button', { type: 'button', class: 'button button-small', 'data-action': 'retry' }, [
    el('span', { class: 'button-icon', html: icons.retry }),
    el('span', { text: 'Retry' }),
  ]);
  const dismissButton = el('button', {
    type: 'button',
    class: 'icon-button icon-button-small',
    'aria-label': 'Dismiss error',
    title: 'Dismiss',
    'data-action': 'dismiss-error',
    html: icons.close,
  });
  const banner = el('div', { class: 'banner banner-error', role: 'alert', hidden: true, 'data-role': 'error-banner' }, [
    el('span', { class: 'banner-icon', html: icons.warning }),
    bannerText,
    el('div', { class: 'banner-actions' }, [retryButton, dismissButton]),
  ]);
  retryButton.addEventListener('click', () => {
    if (lastRequest) run(lastRequest);
  });
  dismissButton.addEventListener('click', () => {
    dismissedError = latest.error;
    localError = undefined;
    render(latest);
  });

  const emptyOpen = el('button', { type: 'button', class: 'button', 'data-action': 'open-file' }, [
    el('span', { class: 'button-icon', html: icons.folder }),
    el('span', { text: 'Choose a PDF…' }),
  ]);
  const emptyDemo = el('button', { type: 'button', class: 'button button-primary', 'data-action': 'load-demo' }, [
    el('span', { class: 'button-icon', html: icons.note }),
    el('span', { text: 'Load the demo score' }),
  ]);
  emptyOpen.addEventListener('click', openFilePicker);
  emptyDemo.addEventListener('click', loadDemo);

  const emptyState = el('div', { class: 'stage-card empty-state', 'data-role': 'empty-state' }, [
    el('div', { class: 'empty-illustration', 'aria-hidden': 'true' }, [
      el('span', { class: 'empty-staff' }),
      el('span', { class: 'empty-staff' }),
      el('span', { class: 'empty-staff' }),
      el('span', { class: 'empty-staff' }),
      el('span', { class: 'empty-staff' }),
      el('span', { class: 'empty-note', html: icons.note }),
    ]),
    el('h2', { class: 'stage-title', text: 'Drop a PDF score anywhere' }),
    el('p', {
      class: 'stage-text',
      text: 'Each staff becomes its own track with volume, mute and solo. Click any bar to play from there, and change the tempo while it plays.',
    }),
    el('div', { class: 'stage-actions' }, [emptyOpen, emptyDemo]),
    el('p', {
      class: 'stage-footnote',
      text: 'Works with vector-engraved PDFs exported from LilyPond, MuseScore, Finale or Sibelius. Scanned pages are not supported yet.',
    }),
  ]);

  const progressStage = el('span', { class: 'progress-stage', text: 'Loading…' });
  const progressPercent = el('span', { class: 'progress-percent', text: '0%' });
  const progressFill = el('div', { class: 'progress-fill' });
  const progressFile = el('div', { class: 'progress-file' });
  const progressBar = el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Parsing progress' }, [progressFill]);
  const progressState = el('div', { class: 'stage-card progress-state', 'data-role': 'progress', hidden: true, role: 'status', 'aria-live': 'polite' }, [
    el('div', { class: 'progress-spinner', 'aria-hidden': 'true' }),
    progressFile,
    el('div', { class: 'progress-row' }, [progressStage, progressPercent]),
    progressBar,
  ]);

  const errorTitle = el('h2', { class: 'stage-title', text: 'Could not read this score' });
  const errorText = el('p', { class: 'stage-text' });
  const errorRetry = el('button', { type: 'button', class: 'button', 'data-action': 'retry' }, [
    el('span', { class: 'button-icon', html: icons.retry }),
    el('span', { text: 'Try again' }),
  ]);
  const errorOther = el('button', { type: 'button', class: 'button button-primary', 'data-action': 'open-file' }, [
    el('span', { class: 'button-icon', html: icons.folder }),
    el('span', { text: 'Open another PDF…' }),
  ]);
  errorRetry.addEventListener('click', () => {
    if (lastRequest) run(lastRequest);
  });
  errorOther.addEventListener('click', openFilePicker);
  const errorState = el('div', { class: 'stage-card error-state', 'data-role': 'error-state', hidden: true, role: 'alert' }, [
    el('span', { class: 'error-icon', html: icons.warning }),
    errorTitle,
    errorText,
    el('div', { class: 'stage-actions' }, [errorRetry, errorOther]),
  ]);

  const stage = el('div', { class: 'score-stage' }, [emptyState, progressState, errorState]);

  let latest: AppState = { status: 'idle', pages: [], transport: { playing: false, positionQn: 0, tempoBpm: 100, masterGain: 1, tracks: [], contextState: 'none' } };
  let lastProgressKey = '';

  function render(state: AppState): void {
    latest = state;
    const busy = state.status === 'loading' || state.status === 'parsing';
    const showError = state.status === 'error' && !state.score && !busy;
    const storeError = state.error && state.error !== dismissedError ? state.error : undefined;
    // The stage card already announces a failed load when nothing is on screen; the banner covers errors on top of a displayed score.
    const message = localError ?? (showError ? undefined : storeError);
    setHidden(banner, !message);
    if (message) {
      setText(bannerText, message);
      setHidden(retryButton, !lastRequest || !!localError);
    }

    const showEmpty = !busy && !showError && !state.score;
    setHidden(emptyState, !showEmpty);
    setHidden(progressState, !busy);
    setHidden(errorState, !showError);
    setHidden(stage, !!state.score && !busy);

    if (busy) {
      const fraction = state.progress?.fraction ?? (state.status === 'loading' ? 0 : 0.05);
      const stageText = state.progress?.stage ?? (state.status === 'loading' ? 'Loading file' : 'Parsing');
      const key = `${stageText}:${Math.round(fraction * 100)}:${state.fileName ?? ''}`;
      if (key !== lastProgressKey) {
        lastProgressKey = key;
        setText(progressStage, stageText);
        setText(progressPercent, formatPercent(fraction));
        setText(progressFile, state.fileName ?? '');
        progressFill.style.transform = `scaleX(${Math.max(0.01, fraction)})`;
        progressBar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        progressBar.setAttribute('aria-valuetext', `${stageText}, ${formatPercent(fraction)}`);
      }
    }
    if (showError) {
      setText(errorText, state.error ?? 'Unknown error');
      setHidden(errorRetry, !lastRequest);
    }
  }

  return {
    fileInput,
    dropOverlay,
    banner,
    stage,
    openFilePicker,
    loadDemo,
    update: render,
    dispose() {
      window.removeEventListener('dragend', onWindowDragEnd);
      dropOverlay.remove();
      fileInput.remove();
      banner.remove();
      stage.remove();
    },
  };
}
