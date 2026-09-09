import { installTestHooks, markReady } from './hooks';
import { createStore } from './store';
import { createController } from './controller';
import { createParser } from '../parsing';
import { createAudioEngine } from '../audio';
import { mountApp } from '../ui';
import type { ShowcaseFactory } from './contracts';

const showcases: Record<string, () => Promise<{ createShowcase: ShowcaseFactory }>> = {
  ui: () => import('../ui/showcase'),
  parsing: () => import('../parsing/showcase'),
  audio: () => import('../audio/showcase'),
};

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root missing');
  const params = new URLSearchParams(location.search);
  const showcaseName = params.get('showcase');

  if (showcaseName) {
    const hooks = installTestHooks('showcase');
    const loader = showcases[showcaseName];
    if (!loader) {
      root.textContent = `Unknown showcase "${showcaseName}". Known: ${Object.keys(showcases).join(', ')}`;
      markReady(hooks);
      return;
    }
    root.dataset.showcase = showcaseName;
    const mod = await loader();
    hooks.showcase = await mod.createShowcase(root);
    markReady(hooks);
    return;
  }

  const hooks = installTestHooks('app');
  const store = createStore();
  const parser = createParser();
  const engine = createAudioEngine();
  const controller = createController(store, parser, engine);
  hooks.store = store;
  hooks.controller = controller;
  hooks.engine = engine;
  hooks.parser = parser;
  mountApp(root, { store, controller });
  markReady(hooks);

  if (params.get('autoload') === 'demo') {
    controller.loadDemo().catch((err) => console.error('autoload failed', err));
  }
}

boot().catch((err) => {
  console.error('boot failed', err);
  const root = document.getElementById('app');
  if (root) {
    root.setAttribute('data-status', 'error');
    root.textContent = `Boot failed: ${err instanceof Error ? err.message : String(err)}`;
  }
});
