import type { AudioEngine } from '../core/contracts';
import { createAudioEngine as createEngine } from './engine';

/** Factory for the Web Audio playback engine. The AudioContext is created lazily on the first play(). */
export function createAudioEngine(): AudioEngine {
  return createEngine();
}
