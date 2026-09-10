const PREFIX = 'smr.ui.';

/** Preferences are best effort: localStorage throws in some private-browsing and sandboxed contexts. */
export function readPref(key: string): string | undefined {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    return;
  }
}
