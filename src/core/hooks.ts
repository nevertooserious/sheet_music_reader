import type { TestHooks } from './contracts';

export const APP_VERSION = '0.1.0';

/**
 * Installs window.__smr and starts capturing console errors and uncaught
 * exceptions so the verifier can read them even if it attached late.
 */
export function installTestHooks(mode: TestHooks['mode']): TestHooks {
  const hooks: TestHooks = {
    version: APP_VERSION,
    ready: false,
    mode,
    errors: [],
  };
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    hooks.errors.push(args.map(formatArg).join(' '));
    origError(...args);
  };
  window.addEventListener('error', (e) => hooks.errors.push(`uncaught: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    hooks.errors.push(`unhandledrejection: ${formatArg(e.reason)}`),
  );
  window.__smr = hooks;
  return hooks;
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export function markReady(hooks: TestHooks): void {
  hooks.ready = true;
  document.getElementById('app')?.setAttribute('data-status', 'ready');
  document.dispatchEvent(new CustomEvent('smr:ready'));
}
