import type { Showcase } from '../core/contracts';

/** Stub; the parsing builder replaces this with a page render + detection overlay scene. */
export async function createShowcase(root: HTMLElement): Promise<Showcase> {
  root.innerHTML = '<p data-role="showcase-stub">parsing showcase not implemented</p>';
  return {
    name: 'parsing',
    steps: ['stub'],
    async runStep() {},
    getDiagnostics: () => ({ implemented: false }),
  };
}
