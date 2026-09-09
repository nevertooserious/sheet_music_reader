import type { AppController, AppStore } from '../core/contracts';

export interface UiDeps {
  store: AppStore;
  controller: AppController;
}

/**
 * Mounts the full application UI into root. Owned by the ui builder.
 * This stub is replaced in wave 1.
 */
export function mountApp(root: HTMLElement, deps: UiDeps): void {
  root.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = 'Sheet Music Reader';
  const status = document.createElement('p');
  status.dataset.role = 'status';
  const button = document.createElement('button');
  button.textContent = 'Load demo';
  button.addEventListener('click', () => void deps.controller.loadDemo().catch(() => undefined));
  root.append(title, status, button);
  deps.store.subscribe((s) => {
    status.textContent = `${s.status}${s.error ? `: ${s.error}` : ''}`;
  });
  status.textContent = deps.store.getState().status;
}
