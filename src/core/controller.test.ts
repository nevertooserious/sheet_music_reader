import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, ScoreDocument, ScoreParser } from './contracts';
import { createController, DEMO_URL } from './controller';
import { createDemoScore } from './demoScore';
import { createStore, initialTransport } from './store';
import type { AppStatus, TransportState } from './types';

function fakeEngine(): AudioEngine & { calls: string[] } {
  const calls: string[] = [];
  let state: TransportState = { ...initialTransport };
  return {
    calls,
    load(score) {
      calls.push('load');
      state = {
        ...state,
        positionQn: 0,
        tempoBpm: score.tempoBpm,
        tracks: score.tracks.map((t) => ({ trackId: t.id, gain: t.defaultGain, muted: false, solo: false, level: 0 })),
      };
    },
    play: async () => {
      calls.push('play');
    },
    pause: () => {
      calls.push('pause');
    },
    stop: () => {
      calls.push('stop');
    },
    seek: () => undefined,
    setTempo: () => undefined,
    setMasterGain: () => undefined,
    setTrackGain: () => undefined,
    setTrackMuted: () => undefined,
    setTrackSolo: () => undefined,
    getState: () => state,
    subscribe: () => () => undefined,
    getScheduledLog: () => [],
    clearScheduledLog: () => undefined,
    renderOffline: async () => {
      throw new Error('not in test');
    },
    dispose: () => undefined,
  };
}

function fakeDoc(): ScoreDocument & { disposed: number } {
  const doc = {
    disposed: 0,
    score: createDemoScore(),
    pages: [{ index: 0, width: 595, height: 842 }],
    renderPage: async () => undefined,
    dispose() {
      doc.disposed++;
    },
  };
  return doc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(parse: ScoreParser['parse']) {
  const store = createStore();
  const statuses: AppStatus[] = [];
  store.subscribe((s) => statuses.push(s.status));
  const engine = fakeEngine();
  const controller = createController(store, { parse }, engine);
  return { store, statuses, engine, controller };
}

describe('controller load state machine', () => {
  it('goes loading → parsing → ready and hands the score to the engine', async () => {
    const doc = fakeDoc();
    const { store, statuses, engine, controller } = setup(async (_data, options) => {
      options.onProgress?.({ fraction: 0.5, stage: 'halfway' });
      return doc;
    });
    await controller.loadArrayBuffer(new ArrayBuffer(8), 'a.pdf');
    expect(statuses).toEqual(['loading', 'parsing', 'parsing', 'ready']);
    const state = store.getState();
    expect(state.score).toBe(doc.score);
    expect(state.pages).toEqual(doc.pages);
    expect(state.progress).toBeUndefined();
    expect(state.transport.tempoBpm).toBe(doc.score.tempoBpm);
    expect(state.transport.tracks.map((t) => t.trackId)).toEqual(doc.score.tracks.map((t) => t.id));
    expect(engine.calls).toEqual(['pause', 'stop', 'load']);
  });

  it('parse failure ends in error with the parser message and rejects with the same error', async () => {
    const { store, controller } = setup(async () => {
      throw new Error('Looks like a scanned PDF.');
    });
    await expect(controller.loadArrayBuffer(new ArrayBuffer(8), 'scan.pdf')).rejects.toThrow('Looks like a scanned PDF.');
    const state = store.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Looks like a scanned PDF.');
    expect(state.score).toBeUndefined();
    expect(state.progress).toBeUndefined();
  });

  it('a failing file.arrayBuffer() ends in error instead of a stuck loading state', async () => {
    const parse = vi.fn();
    const { store, controller } = setup(parse);
    const file = { name: 'broken.pdf', arrayBuffer: () => Promise.reject(new Error('read failed')) } as unknown as File;
    await expect(controller.loadFile(file)).rejects.toThrow('read failed');
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe('read failed');
    expect(parse).not.toHaveBeenCalled();
  });

  it('a failed demo fetch keeps the previous score and reports the error', async () => {
    const doc = fakeDoc();
    const { store, controller } = setup(async () => doc);
    await controller.loadArrayBuffer(new ArrayBuffer(8), 'first.pdf');
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(DEMO_URL);
      return { ok: false, status: 503 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(controller.loadDemo()).rejects.toThrow('Demo fetch failed: 503');
    } finally {
      vi.unstubAllGlobals();
    }
    const state = store.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('Demo fetch failed: 503');
    expect(state.score).toBe(doc.score);
    expect(doc.disposed).toBe(0);
  });

  it('a load superseded before parsing never reaches the parser', async () => {
    const parse = vi.fn(async () => fakeDoc());
    const { store, controller } = setup(parse);
    const first = controller.loadArrayBuffer(new ArrayBuffer(1), 'first.pdf');
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'second.pdf');
    await expect(first).resolves.toBeUndefined();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.objectContaining({ fileName: 'second.pdf' }));
    expect(store.getState().fileName).toBe('second.pdf');
  });

  it('a superseded load never writes to the store and its document is disposed', async () => {
    const slow = deferred<ScoreDocument>();
    const slowStarted = deferred<void>();
    const slowDoc = fakeDoc();
    const fastDoc = fakeDoc();
    const { store, statuses, controller } = setup(async (_data, options) => {
      if (options.fileName !== 'slow.pdf') return fastDoc;
      slowStarted.resolve();
      return slow.promise;
    });
    const first = controller.loadArrayBuffer(new ArrayBuffer(1), 'slow.pdf');
    await slowStarted.promise;
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'fast.pdf');
    expect(store.getState().score).toBe(fastDoc.score);
    const before = statuses.length;
    slow.resolve(slowDoc);
    await first;
    expect(statuses.length).toBe(before);
    expect(store.getState().score).toBe(fastDoc.score);
    expect(store.getState().fileName).toBe('fast.pdf');
    expect(slowDoc.disposed).toBe(1);
    expect(fastDoc.disposed).toBe(0);
  });

  it('a superseded load that fails resolves silently', async () => {
    const slow = deferred<ScoreDocument>();
    const slowStarted = deferred<void>();
    const fastDoc = fakeDoc();
    const { store, controller } = setup(async (_data, options) => {
      if (options.fileName !== 'slow.pdf') return fastDoc;
      slowStarted.resolve();
      return slow.promise;
    });
    const first = controller.loadArrayBuffer(new ArrayBuffer(1), 'slow.pdf');
    await slowStarted.promise;
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'fast.pdf');
    slow.reject(new Error('too late'));
    await expect(first).resolves.toBeUndefined();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().error).toBeUndefined();
  });

  it('replacing a document disposes the previous one and renderPage rejects while none is loaded', async () => {
    const docs = [fakeDoc(), fakeDoc()];
    let call = 0;
    const { controller } = setup(async () => docs[call++]);
    const canvas = {} as HTMLCanvasElement;
    await expect(controller.renderPage(0, canvas, 1)).rejects.toThrow('No document loaded');
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'a.pdf');
    await expect(controller.renderPage(0, canvas, 1)).resolves.toBeUndefined();
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'b.pdf');
    expect(docs[0].disposed).toBe(1);
    expect(docs[1].disposed).toBe(0);
  });

  it('seekToMeasure seeks to the first occurrence of the printed measure', async () => {
    const doc = fakeDoc();
    const seek = vi.fn();
    const store = createStore();
    const engine = { ...fakeEngine(), seek };
    const controller = createController(store, { parse: async () => doc }, engine);
    await controller.loadArrayBuffer(new ArrayBuffer(1), 'a.pdf');
    controller.seekToMeasure(3);
    expect(seek).toHaveBeenCalledWith(doc.score.measures[3].firstStartQn);
    controller.seekToMeasure(999);
    expect(seek).toHaveBeenCalledTimes(1);
  });
});
