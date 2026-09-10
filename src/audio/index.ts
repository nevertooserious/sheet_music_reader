import type { AudioEngine } from '../core/contracts';
import { createAudioEngine as createEngine } from './engine';
import { loadBundledPiano } from './piano';

/** Factory for the Web Audio playback engine. The AudioContext is created lazily on the first play(); the piano samples start loading now. */
export function createAudioEngine(): AudioEngine {
  return createEngine({ samples: loadBundledPiano() });
}
