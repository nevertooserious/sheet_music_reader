import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from './analyze';
import { classifyGlyphs } from './glyphs';
import { extractPdfPage } from './pdfPage';

/**
 * Real Sibelius (Opus) output: the music examples in the Sibelius 8 Reference
 * Guide are Sibelius exports placed into the manual, with OpusStd /
 * OpusSpecialStd embedded as re-encoded Type1 subsets. The guide is Avid's
 * copyright, so it is not bundled: drop it at tools/verify/out/opus/sib8-reference.pdf
 * (https://resources.avid.com/SupportFiles/Sibelius/8.0/reference.pdf) or point
 * SMR_SIBELIUS_PDF at it, otherwise this suite is skipped.
 */
const ROOT = path.resolve(__dirname, '../..');
const PDF = process.env.SMR_SIBELIUS_PDF || path.join(ROOT, 'tools/verify/out/opus/sib8-reference.pdf');
const available = fs.existsSync(PDF);

async function extractPages(pageNumbers: number[]) {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, fontExtraProperties: true, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 0; i < pageNumbers.length; i++) pages.push(await extractPdfPage(await doc.getPage(pageNumbers[i]), i, pdfjs.OPS as unknown as Record<string, number>));
  await doc.destroy();
  return pages;
}

describe.skipIf(!available)('Sibelius Opus fonts (external Sibelius 8 Reference Guide pages)', () => {
  it('identifies Opus glyphs through the re-encoded subset names', async () => {
    const [page] = await extractPages([365]);
    const opus = page.glyphs.filter((g) => g.family === 'sonata');
    expect(opus.length).toBeGreaterThan(100);
    const classified = classifyGlyphs(opus);
    const kinds: Record<string, number> = {};
    for (const g of classified) kinds[g.music.kind] = (kinds[g.music.kind] ?? 0) + 1;
    if (process.env.SMR_DEBUG) console.log('page 365 kinds', kinds);
    // 31 notehead styles x 4 notes on the catalogue page, minus the headless/slash styles.
    expect(kinds.notehead).toBeGreaterThanOrEqual(90);
    expect(kinds.clef).toBe(8);
    const fonts = new Set(page.fonts.filter((f) => f.family === 'sonata').map((f) => f.name));
    expect([...fonts].sort()).toEqual(['OpusSpecialExtraStd', 'OpusSpecialStd', 'OpusStd']);
  });

  it('parses the engraved examples on pages 313, 324 and 336 into staves and notes', async () => {
    const pages = await extractPages([313, 324, 336]);
    const { score, debug } = analyze(pages, { fileName: 'sibelius-reference-examples.pdf' });
    const summary = {
      fonts: score.source.fonts,
      staves: debug.staves.length,
      systems: debug.systems.length,
      measures: score.measures.length,
      tracks: score.tracks.map((t) => ({ name: t.name, clef: t.clef, notes: t.notes.length, first: t.notes.slice(0, 8).map((n) => `${n.midi}@${n.startQn}/${n.durationQn}`) })),
      glyphs: debug.glyphCounts,
      time: score.timeSignatures,
      key: score.keySignatures,
      warnings: score.warnings,
    };
    if (process.env.SMR_DEBUG) console.log(JSON.stringify(summary, null, 1));
    expect(score.source.engine).toBe('vector');
    expect(debug.staves.length).toBeGreaterThan(5);
    expect(score.tracks.length).toBeGreaterThan(0);
    const notes = score.tracks.reduce((s, t) => s + t.notes.length, 0);
    expect(notes).toBeGreaterThan(40);
    expect(score.tracks.every((t) => t.notes.every((n) => n.midi >= 21 && n.midi <= 108))).toBe(true);
  });
});
