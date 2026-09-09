import type { AudioEngine } from '../core/contracts';
import { initialTransport } from '../core/store';

/**
 * Factory for the Web Audio playback engine. Owned by the audio builder.
 * This stub is replaced in wave 2.
 */
export function createAudioEngine(): AudioEngine {
  const notImplemented = () => {
    throw new Error('audio module not implemented');
  };
  return {
    load: () => undefined,
    play: async () => notImplemented(),
    pause: () => undefined,
    stop: () => undefined,
    seek: () => undefined,
    setTempo: () => undefined,
    setMasterGain: () => undefined,
    setTrackGain: () => undefined,
    setTrackMuted: () => undefined,
    setTrackSolo: () => undefined,
    getState: () => initialTransport,
    subscribe: () => () => undefined,
    getScheduledLog: () => [],
    clearScheduledLog: () => undefined,
    renderOffline: async () => notImplemented(),
    dispose: () => undefined,
  };
}
