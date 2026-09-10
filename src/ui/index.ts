import './ui.css';
import type { AppController, AppStore } from '../core/contracts';
import type { AppState } from '../core/types';
import { el } from './dom';
import { nudgeByMeasure } from './format';
import { createHeader } from './header';
import { createImportZone } from './importZone';
import { type Mixer, createMixer } from './mixer';
import { type ScoreView, createScoreView } from './scoreView';
import { createTransportBar } from './transport';

export interface UiDeps {
  store: AppStore;
  controller: AppController;
}

export interface MountedApp {
  root: HTMLElement;
  scoreView: ScoreView;
  mixer: Mixer;
  dispose(): void;
}

/**
 * Mounts the full application UI into root. Store updates are coalesced to
 * one DOM pass per animation frame so the playhead stays smooth while the
 * engine publishes transport state at frame rate.
 */
export function mountApp(root: HTMLElement, deps: UiDeps): MountedApp {
  const { store, controller } = deps;
  root.replaceChildren();
  const shell = el('div', { class: 'smr-app' });

  const importZone = createImportZone({ controller, dropTarget: shell });
  const header = createHeader({
    onOpenFile: () => importZone.openFilePicker(),
    onLoadDemo: () => importZone.loadDemo(),
  });
  const scoreView = createScoreView({ controller });
  const mixer = createMixer({ controller });
  const transport = createTransportBar({
    controller,
    onError: (message) => showLocalError(message),
    onUserSeek: () => scoreView.reveal(),
  });

  const localBanner = el('div', { class: 'banner banner-error', role: 'alert', hidden: true, 'data-role': 'action-error' });
  const localBannerText = el('span', { class: 'banner-text' });
  const localBannerClose = el('button', {
    type: 'button',
    class: 'icon-button icon-button-small',
    'aria-label': 'Dismiss',
    'data-action': 'dismiss-action-error',
  });
  localBannerClose.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3.7 2.8a.65.65 0 0 0-.9.9L7.1 8l-4.3 4.3a.65.65 0 1 0 .9.9L8 8.9l4.3 4.3a.65.65 0 1 0 .9-.9L8.9 8l4.3-4.3a.65.65 0 0 0-.9-.9L8 7.1 3.7 2.8z"/></svg>';
  localBannerClose.addEventListener('click', () => {
    localBanner.hidden = true;
  });
  localBanner.append(localBannerText, localBannerClose);
  function showLocalError(message: string): void {
    localBannerText.textContent = message;
    localBanner.hidden = false;
  }

  const stageHost = el('div', { class: 'score-column' }, [importZone.stage, scoreView.el]);
  const main = el('main', { class: 'main' }, [stageHost, mixer.el]);

  shell.append(
    header.el,
    el('div', { class: 'banners' }, [importZone.banner, localBanner]),
    main,
    transport.el,
    importZone.dropOverlay,
    importZone.fileInput,
  );
  root.append(shell);

  const components = [header, importZone, scoreView, mixer, transport];
  let latest: AppState = store.getState();
  let frame: number | undefined;
  const flush = (): void => {
    frame = undefined;
    for (const c of components) c.update(latest);
  };
  const unsubscribe = store.subscribe((state) => {
    latest = state;
    if (frame === undefined) frame = requestAnimationFrame(flush);
  });
  flush();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    const inTextField = tag === 'INPUT' && (target as HTMLInputElement).type !== 'range';
    if (inTextField || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const inRange = tag === 'INPUT';
    const state = store.getState();
    const score = state.score;
    switch (event.key) {
      case ' ':
        if (tag === 'BUTTON' || !score) return;
        event.preventDefault();
        controller.togglePlay().catch((err) => showLocalError(err instanceof Error ? err.message : String(err)));
        return;
      case 'Home':
        if (!score) return;
        event.preventDefault();
        controller.seek(0);
        scoreView.reveal();
        return;
      case 'End':
        if (!score) return;
        event.preventDefault();
        controller.seek(nudgeByMeasure(score, Infinity, 0));
        scoreView.reveal();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!score || inRange) return;
        event.preventDefault();
        controller.seek(nudgeByMeasure(score, state.transport.positionQn, event.key === 'ArrowRight' ? 1 : -1));
        scoreView.reveal();
        return;
      case '+':
      case '=':
        if (!score) return;
        event.preventDefault();
        scoreView.zoomIn();
        return;
      case '-':
      case '_':
        if (!score) return;
        event.preventDefault();
        scoreView.zoomOut();
        return;
      case '0':
        if (!score) return;
        event.preventDefault();
        scoreView.setZoom('fit-width');
        return;
      default:
        return;
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    root: shell,
    scoreView,
    mixer,
    dispose() {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      header.dispose();
      importZone.dispose();
      scoreView.dispose();
      mixer.dispose();
      shell.remove();
    },
  };
}
