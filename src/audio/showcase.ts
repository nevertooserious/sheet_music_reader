import type { Showcase } from '../core/contracts';

/** Stub; the audio builder replaces this with a mixer + transport scene on the demo score. */
export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  root.innerHTML = '<p data-role="showcase-stub">audio showcase not implemented</p>';
  return {
    name: 'audio',
    steps: ['stub'],
    async runStep() {},
    getDiagnostics: () => ({ implemented: false }),
  };
}
