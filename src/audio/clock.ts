export interface Ticker {
  readonly kind: 'worker' | 'interval';
  start(): void;
  stop(): void;
  dispose(): void;
}

export type TickerFactory = (onTick: () => void, intervalMs: number) => Ticker;

const WORKER_SOURCE = `
let id = null, ms = 25;
onmessage = (e) => {
  const m = e.data;
  if (m && m.type === 'start') { ms = m.intervalMs || ms; if (id === null) id = setInterval(() => postMessage(0), ms); }
  else if (m && m.type === 'stop') { if (id !== null) { clearInterval(id); id = null; } }
};
`;

function intervalTicker(onTick: () => void, intervalMs: number): Ticker {
  let handle: ReturnType<typeof setInterval> | undefined;
  return {
    kind: 'interval',
    start() {
      if (handle === undefined) handle = setInterval(onTick, intervalMs);
    },
    stop() {
      if (handle !== undefined) {
        clearInterval(handle);
        handle = undefined;
      }
    },
    dispose() {
      this.stop();
    },
  };
}

/**
 * Scheduler clock. Browsers throttle main-thread timers in hidden tabs to about 1 Hz, which is
 * far coarser than a 150 ms lookahead; a dedicated Worker's timers are exempt, so the tick
 * comes from a tiny inline Worker whenever one can be created and falls back to setInterval.
 */
export function createTicker(onTick: () => void, intervalMs: number): Ticker {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    return intervalTicker(onTick, intervalMs);
  }
  let worker: Worker | undefined;
  let fallback: Ticker | undefined;
  let running = false;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    return intervalTicker(onTick, intervalMs);
  }
  const w = worker;
  w.onmessage = () => {
    if (running && !fallback) onTick();
  };
  w.onerror = () => {
    // A CSP that forbids blob: workers surfaces here; keep ticking from the main thread instead.
    w.terminate();
    if (!fallback) {
      fallback = intervalTicker(onTick, intervalMs);
      if (running) fallback.start();
    }
  };
  return {
    kind: 'worker',
    start() {
      if (running) return;
      running = true;
      if (fallback) fallback.start();
      else w.postMessage({ type: 'start', intervalMs });
    },
    stop() {
      if (!running) return;
      running = false;
      if (fallback) fallback.stop();
      else w.postMessage({ type: 'stop' });
    },
    dispose() {
      this.stop();
      fallback?.dispose();
      w.onmessage = null;
      w.terminate();
    },
  };
}
