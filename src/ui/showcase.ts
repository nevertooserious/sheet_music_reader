import type { Showcase } from '../core/contracts';

/** Stub; the ui builder replaces this with a scene that mounts the real UI on demo data. */
export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  root.innerHTML = '<p data-role="showcase-stub">ui showcase not implemented</p>';
  return {
    name: 'ui',
    steps: ['stub'],
    async runStep() {},
    getDiagnostics: () => ({ implemented: false }),
  };
}
