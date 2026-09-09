import type { AppStore } from './contracts';
import type { AppState, TransportState } from './types';

export const initialTransport: TransportState = {
  playing: false,
  positionQn: 0,
  tempoBpm: 100,
  masterGain: 0.9,
  tracks: [],
  contextState: 'none',
};

export const initialAppState: AppState = {
  status: 'idle',
  pages: [],
  transport: initialTransport,
};

export interface WritableStore extends AppStore {
  setState(patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)): void;
}

export function createStore(initial: AppState = initialAppState): WritableStore {
  let state = initial;
  const listeners = new Set<(s: AppState) => void>();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const l of listeners) l(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
