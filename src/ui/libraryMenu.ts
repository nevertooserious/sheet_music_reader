import { el, iconButton, setHidden, setPressed } from './dom';
import { icons } from './icons';
import { type LibraryEntry, type ScoreLibrary, displayName, entryId, entryLabel, formatSize } from './library';

export interface LibraryMenuDeps {
  library: ScoreLibrary;
  /** Load a saved score; the menu has already read its bytes. */
  onOpen(entry: LibraryEntry, data: ArrayBuffer): void;
  onError(message: string): void;
}

export interface LibraryMenu {
  el: HTMLElement;
  /** Store a score that has just loaded successfully, then refresh the list. */
  remember(name: string, read: () => Promise<ArrayBuffer>, title?: string): Promise<void>;
  /** Reopen the score that was open last; no-op when nothing is saved. */
  openMostRecent(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}

export function createLibraryMenu(deps: LibraryMenuDeps): LibraryMenu {
  const { library } = deps;

  const list = el('div', { class: 'library-list', role: 'list' });
  const popover = el('div', { class: 'library-popover', role: 'dialog', 'aria-label': 'Saved scores', hidden: true }, [
    el('div', { class: 'library-popover-title', text: 'Saved on this device' }),
    list,
  ]);
  const button = el(
    'button',
    {
      type: 'button',
      class: 'button',
      'data-action': 'toggle-library',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-label': 'Saved scores',
      title: 'Saved scores',
      hidden: true,
    },
    [el('span', { class: 'button-icon', html: icons.library }), el('span', { class: 'button-label', text: 'Scores' })],
  );
  const root = el('div', { class: 'library-wrap' }, [button, popover]);

  let open = false;
  let currentId: string | undefined;

  const setOpen = (next: boolean): void => {
    open = next;
    setHidden(popover, !next);
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
    setPressed(button, next);
  };
  button.addEventListener('click', () => setOpen(!open));

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (open && !root.contains(event.target as Node)) setOpen(false);
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);

  function row(entry: LibraryEntry): HTMLElement {
    const isCurrent = entry.id === currentId;
    const label = entryLabel(entry);
    const openEntry = el(
      'button',
      {
        type: 'button',
        class: 'library-open',
        'data-action': 'open-library-entry',
        'data-entry': entry.id,
        'aria-current': isCurrent ? 'true' : undefined,
      },
      [
        el('span', { class: 'library-name', text: label, title: entry.name }),
        el('span', { class: 'library-meta', text: formatSize(entry.size) }),
      ],
    );
    openEntry.addEventListener('click', () => {
      void select(entry);
    });
    const removeEntry = iconButton({
      icon: icons.close,
      label: `Remove ${label}`,
      action: 'remove-library-entry',
      class: 'icon-button-small library-remove',
      attrs: { 'data-entry': entry.id },
      onClick: () => {
        void forget(entry);
      },
    });
    return el('div', { class: `library-row${isCurrent ? ' is-current' : ''}`, role: 'listitem' }, [openEntry, removeEntry]);
  }

  async function select(entry: LibraryEntry): Promise<void> {
    setOpen(false);
    const data = await library.read(entry.id);
    if (!data) {
      deps.onError(`"${entryLabel(entry)}" is no longer stored on this device.`);
      await library.remove(entry.id);
      await refresh();
      return;
    }
    currentId = entry.id;
    await library.touch(entry.id);
    deps.onOpen(entry, data);
    await refresh();
  }

  async function forget(entry: LibraryEntry): Promise<void> {
    await library.remove(entry.id);
    if (currentId === entry.id) currentId = undefined;
    await refresh();
  }

  async function refresh(): Promise<void> {
    const entries = await library.list();
    list.replaceChildren(...entries.map(row));
    setHidden(button, entries.length === 0);
    if (entries.length === 0) setOpen(false);
  }

  return {
    el: root,
    async remember(name, read, title) {
      let data: ArrayBuffer;
      try {
        data = await read();
      } catch {
        return;
      }
      if (await library.save(name, data, title)) currentId = entryId(name);
      else deps.onError(`"${title?.trim() || displayName(name)}" is open but could not be saved to this device.`);
      await refresh();
    },
    async openMostRecent() {
      const [mostRecent] = await library.list();
      if (mostRecent) await select(mostRecent);
    },
    refresh,
    dispose() {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      root.remove();
    },
  };
}
