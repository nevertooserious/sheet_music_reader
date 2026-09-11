const DB_NAME = 'smr';
const DB_VERSION = 1;
/** Metadata only, so listing the library never deserialises a PDF. */
const META_STORE = 'scores';
const DATA_STORE = 'data';

export interface LibraryEntry {
  id: string;
  name: string;
  /** Title the parser read off the score; absent for entries saved before it was recorded. */
  title?: string;
  size: number;
  addedAt: number;
  lastOpenedAt: number;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Scores are unique by name: re-opening a name replaces the entry, so a revised
 * file of the same name never shows up twice and the newest bytes win.
 */
export function entryId(name: string): string {
  return normalizeName(name);
}

/** Keeps the most recently opened entry per name; expects `sortEntries` order. */
export function dedupeByName(entries: LibraryEntry[]): LibraryEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = normalizeName(entry.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function displayName(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

/** The score's own title where the parser found one, otherwise the file name. */
export function entryLabel(entry: LibraryEntry): string {
  return entry.title?.trim() || displayName(entry.name);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Most recent first; name breaks ties so the menu order never flickers. */
export function sortEntries(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
}

export interface ScoreLibrary {
  list(): Promise<LibraryEntry[]>;
  /** False when the score could not be stored (no IndexedDB, or the quota is full). */
  save(name: string, data: ArrayBuffer, title?: string): Promise<boolean>;
  read(id: string): Promise<ArrayBuffer | undefined>;
  touch(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Writes are only safe once the transaction commits: that is where a quota failure surfaces. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

const unavailable: ScoreLibrary = {
  list: async () => [],
  save: async () => false,
  read: async () => undefined,
  touch: async () => undefined,
  remove: async () => undefined,
};

/**
 * Saved scores survive a reload. Every operation is best effort for the same
 * reason preferences are: IndexedDB is absent or throws in some private-browsing
 * and sandboxed contexts, and the app stays usable without it.
 */
export function createScoreLibrary(): ScoreLibrary {
  if (typeof indexedDB === 'undefined') return unavailable;

  let db: Promise<IDBDatabase> | undefined;
  const connect = (): Promise<IDBDatabase> => {
    if (!db) db = openDb();
    return db;
  };

  async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const connection = await connect();
    const transaction = connection.transaction(stores, mode);
    const result = await run(transaction);
    if (mode === 'readwrite') await committed(transaction);
    return result;
  }

  return {
    async list() {
      try {
        const entries = await tx([META_STORE], 'readonly', (t) =>
          promisify(t.objectStore(META_STORE).getAll() as IDBRequest<LibraryEntry[]>),
        );
        return dedupeByName(sortEntries(entries));
      } catch {
        return [];
      }
    },

    async save(name, data, title) {
      const id = entryId(name);
      try {
        await tx([META_STORE, DATA_STORE], 'readwrite', async (t) => {
          const meta = t.objectStore(META_STORE);
          const blobs = t.objectStore(DATA_STORE);
          const all = await promisify(meta.getAll() as IDBRequest<LibraryEntry[]>);
          const existing = all.find((entry) => entry.id === id);
          // Entries keyed differently by an earlier version of this store would otherwise linger as duplicates.
          for (const stale of all) {
            if (stale.id !== id && normalizeName(stale.name) === normalizeName(name)) {
              meta.delete(stale.id);
              blobs.delete(stale.id);
            }
          }
          const now = Date.now();
          meta.put({
            id,
            name,
            title: title?.trim() || undefined,
            size: data.byteLength,
            addedAt: existing?.addedAt ?? now,
            lastOpenedAt: now,
          });
          blobs.put(data, id);
        });
        return true;
      } catch {
        return false;
      }
    },

    async read(id) {
      try {
        return await tx([DATA_STORE], 'readonly', (t) =>
          promisify(t.objectStore(DATA_STORE).get(id) as IDBRequest<ArrayBuffer | undefined>),
        );
      } catch {
        return undefined;
      }
    },

    async touch(id) {
      try {
        await tx([META_STORE], 'readwrite', async (t) => {
          const meta = t.objectStore(META_STORE);
          const existing = await promisify(meta.get(id) as IDBRequest<LibraryEntry | undefined>);
          if (existing) meta.put({ ...existing, lastOpenedAt: Date.now() });
        });
      } catch {
        return;
      }
    },

    async remove(id) {
      try {
        await tx([META_STORE, DATA_STORE], 'readwrite', async (t) => {
          t.objectStore(META_STORE).delete(id);
          t.objectStore(DATA_STORE).delete(id);
        });
      } catch {
        return;
      }
    },
  };
}
