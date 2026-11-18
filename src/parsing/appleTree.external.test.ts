import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from './analyze';
import { extractPdfPage } from './pdfPage';

/**
 * "Apple Tree" (arr. Katerina Gimon, SATB with percussion): a 19-page Sibelius
 * export with Opus / Opus Special / Opus Text as CID fonts, 2/2 time, half
 * note = ca. 88, three single-line percussion staves above the voices. It is a
 * commercial edition, so it stays out of git: put it at
 * fixtures/external/apple-tree.pdf (or set SMR_APPLE_TREE_PDF) to run this suite.
 */
const ROOT = path.resolve(__dirname, '../..');
const PDF = process.env.SMR_APPLE_TREE_PDF || path.join(ROOT, 'fixtures/external/apple-tree.pdf');
const available = fs.existsSync(PDF);

async function parsePages(pageNumbers?: number[]) {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, fontExtraProperties: true, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const numbers = pageNumbers ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const pages = [];
  for (let i = 0; i < numbers.length; i++) pages.push(await extractPdfPage(await doc.getPage(numbers[i]), i, pdfjs.OPS as unknown as Record<string, number>));
  await doc.destroy();
  return analyze(pages, { fileName: 'apple-tree.pdf' });
}

function stavesPerSystem(staves: Array<{ system: number }>): number[] {
  const counts = new Map<number, number>();
  for (const s of staves) counts.set(s.system, (counts.get(s.system) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

describe.skipIf(!available)('Apple Tree (external Sibelius export)', () => {
  it('reads 2/2, the half-note tempo mark and the single-line percussion staves on page 1', async () => {
    const { score, debug } = await parsePages([1]);
    const summary = {
      time: score.timeSignatures,
      key: score.keySignatures,
      tempo: score.tempoBpm,
      tempoMarks: score.tempoMarks,
      staves: debug.staves.map((s) => `${s.system}:${s.index}${s.lineCount === 1 ? ' (1 line)' : ''}`),
      systems: stavesPerSystem(debug.staves),
      measures: score.measures.map((m) => m.durationQn),
      tracks: score.tracks.map((t) => ({ name: t.name, clef: t.clef, instrument: t.instrument, notes: t.notes.length })),
      warnings: score.warnings,
    };
    if (process.env.SMR_DEBUG) console.log(JSON.stringify(summary, null, 1));
    expect(score.source.fonts).toEqual(expect.arrayContaining(['Opus', 'OpusSpecial']));
    expect(score.timeSignatures[0]).toEqual({ measure: 0, beats: 2, beatType: 2 });
    expect(score.timeSignatures.every((t) => t.beats === 2 && t.beatType === 2)).toBe(true);
    expect(score.tempoBpm).toBe(176);
    expect(stavesPerSystem(debug.staves)).toEqual([4, 3, 3]);
    expect(debug.staves.filter((s) => s.lineCount === 1).length).toBe(5);
    expect(score.measures.every((m) => m.durationQn === 4)).toBe(true);
    expect(score.measures.length).toBe(10);
    expect(score.keySignatures.some((k) => k.fifths === 2)).toBe(true);
    expect(score.tracks[0].clef).toBe('percussion');
    expect(score.tracks[0].instrument).toBe('other');
  });

  it('keeps every measure of the whole score at 4 quarter notes', async () => {
    const { score, debug } = await parsePages();
    const lengths = new Map<number, number>();
    for (const m of score.measures) lengths.set(m.durationQn, (lengths.get(m.durationQn) ?? 0) + 1);
    const summary = {
      pages: 19,
      staves: debug.staves.length,
      singleLine: debug.staves.filter((s) => s.lineCount === 1).length,
      systems: debug.systems.length,
      measures: score.measures.length,
      lengths: [...lengths],
      tracks: score.tracks.map((t) => `${t.name} ${t.clef} ${t.notes.length}`),
      warnings: score.warnings.length,
      firstWarnings: score.warnings.slice(0, 8),
    };
    if (process.env.SMR_DEBUG) console.log(JSON.stringify(summary, null, 1));
    const fourQn = lengths.get(4) ?? 0;
    expect(fourQn / score.measures.length).toBeGreaterThanOrEqual(0.95);
    expect(score.timeSignatures.every((t) => t.beats === 2 && t.beatType === 2)).toBe(true);
    expect(score.durationQn).toBeGreaterThan(4 * 60);
  });

  it('reads the bar 121 triplets on the staff they are printed on (page 16)', async () => {
    const { score, debug } = await parsePages();
    const m = score.measures[120];
    const bar = (name: string) =>
      score.tracks
        .find((t) => t.name === name)!
        .notes.filter((n) => n.measure === 120)
        .map((n) => [n.midi, +(n.startQn - m.firstStartQn).toFixed(3), +n.durationQn.toFixed(3)]);
    const triplet = (pitches: number[]) => pitches.map((p, i) => [p, +((i * 2) / 3).toFixed(3), 0.667]);
    expect(debug.tuplets.map((t) => [t.page, t.staff])).toEqual([
      [15, 5],
      [15, 5],
      [15, 6],
      [15, 6],
    ]);
    // Tenor: two quarter-note triplets under flat brackets.
    expect(bar('Staff 5')).toEqual(triplet([62, 59, 62, 61, 59, 61]));
    // Bass: the second bracket is slanted; the whole note under the first is not part of it.
    expect(bar('Staff 6')).toEqual([[52, 0, 4], ...triplet([57, 54, 57, 56, 54, 52])]);
    // Alto 2 sits above the tenor's triplet numbers but has none of its own.
    expect(bar('Staff 4')).toEqual([
      [59, 0, 1.5],
      [59, 1.5, 1.5],
      [59, 3, 5],
    ]);
    // Alto 1: a dotted chord with a second, its dots aligned after the offset head.
    // (The eighth is tied to the following quarter, and the last quarter into bar 122.)
    expect(bar('Staff 3').filter(([p]) => p === 64)).toEqual([
      [64, 0, 1.5],
      [64, 1.5, 1.5],
      [64, 3, 5],
    ]);
    expect(score.warnings.some((w) => w.startsWith('Measure 121,'))).toBe(false);
  });

  it('reads every bar of the score to its full length, without fallbacks', async () => {
    const { score } = await parsePages();
    expect(score.warnings.filter((w) => w.startsWith('Measure '))).toEqual([]);
    const bar = (name: string, b: number) => {
      const m = score.measures[b - 1];
      return score.tracks
        .find((t) => t.name === name)!
        .notes.filter((n) => n.measure === b - 1)
        .map((n) => [n.midi, +(n.startQn - m.firstStartQn).toFixed(3), +n.durationQn.toFixed(3)]);
    };
    // Two voices a second apart, the lower one with hidden rests.
    expect(bar('Staff 2', 41)).toEqual([
      [64, 0, 1],
      [66, 0, 1],
      [64, 2, 1],
    ]);
    // Bass: whole note held under quarter, two eighths, half.
    expect(bar('Staff 6', 122)).toEqual([
      [52, 0, 4],
      [54, 0, 1],
      [50, 1, 0.5],
      [49, 1.5, 0.5],
      [50, 2, 2],
    ]);
    // Ties on a chord with a second (offset heads, the whole-note second offset the other way in bar 114)
    // hold instead of re-striking: bars 112 and 114 start nothing new for E and F#.
    for (const b of [111, 113]) {
      expect(bar('Staff 2', b).filter(([p]) => p === 64 || p === 66)).toEqual([
        [64, 0, 1.5],
        [66, 0, 1.5],
        [64, 1.5, 1.5],
        [66, 1.5, 1.5],
        [64, 3, 5],
        [66, 3, 5],
      ]);
    }
    expect(bar('Staff 2', 112)).toEqual([]);
    expect(bar('Staff 2', 114)).toEqual([[72, 0, 4]]);
    // The free slide's circled-cross head holds its bar.
    expect(bar('Staff 1', 121)).toEqual([[50, 0, 4]]);
  });
});

