import { describe, expect, it } from 'vitest';
import {
  type LibraryEntry,
  dedupeByName,
  displayName,
  entryId,
  entryLabel,
  formatSize,
  sortEntries,
} from './library';

const entry = (id: string, name: string, lastOpenedAt: number): LibraryEntry => ({
  id,
  name,
  size: 1024,
  addedAt: 0,
  lastOpenedAt,
});

describe('entryId', () => {
  it('is the name, so re-opening one replaces it instead of duplicating it', () => {
    expect(entryId('Minuet.pdf')).toBe(entryId('Minuet.pdf'));
  });

  it('ignores case and surrounding whitespace', () => {
    expect(entryId('  Minuet.PDF ')).toBe(entryId('minuet.pdf'));
  });

  it('keeps different names apart', () => {
    expect(entryId('minuet.pdf')).not.toBe(entryId('gavotte.pdf'));
  });
});

describe('dedupeByName', () => {
  it('keeps only the first entry for a name', () => {
    const deduped = dedupeByName(sortEntries([entry('old', 'Minuet.pdf', 10), entry('new', 'Minuet.pdf', 40)]));
    expect(deduped.map((e) => e.id)).toEqual(['new']);
  });

  it('treats names differing only by case or padding as one score', () => {
    const deduped = dedupeByName(sortEntries([entry('a', ' minuet.PDF', 10), entry('b', 'Minuet.pdf', 40)]));
    expect(deduped.map((e) => e.id)).toEqual(['b']);
  });

  it('leaves distinct names alone', () => {
    const deduped = dedupeByName(sortEntries([entry('a', 'A.pdf', 20), entry('b', 'B.pdf', 10)]));
    expect(deduped.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('displayName', () => {
  it('drops the pdf extension', () => {
    expect(displayName('Menuet in G.pdf')).toBe('Menuet in G');
    expect(displayName('Menuet in G.PDF')).toBe('Menuet in G');
  });

  it('leaves other names alone', () => {
    expect(displayName('Menuet in G')).toBe('Menuet in G');
    expect(displayName('not.pdf.backup')).toBe('not.pdf.backup');
  });
});

describe('entryLabel', () => {
  it('prefers the parsed title', () => {
    expect(entryLabel({ ...entry('a', 'bwv-anh-114.pdf', 0), title: 'Menuet in G' })).toBe('Menuet in G');
  });

  it('falls back to the file name when the parser found no title', () => {
    expect(entryLabel(entry('a', 'Menuet in G.pdf', 0))).toBe('Menuet in G');
    expect(entryLabel({ ...entry('a', 'Menuet in G.pdf', 0), title: '   ' })).toBe('Menuet in G');
  });
});

describe('formatSize', () => {
  it('scales to the unit that reads shortest', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(180708)).toBe('176 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('sortEntries', () => {
  it('puts the most recently opened first', () => {
    const sorted = sortEntries([entry('a', 'A.pdf', 10), entry('b', 'B.pdf', 30), entry('c', 'C.pdf', 20)]);
    expect(sorted.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by name so the order never flickers', () => {
    const sorted = sortEntries([entry('b', 'B.pdf', 5), entry('a', 'A.pdf', 5)]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const entries = [entry('a', 'A.pdf', 1), entry('b', 'B.pdf', 2)];
    sortEntries(entries);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
