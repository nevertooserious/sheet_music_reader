import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from './analyze';
import { extractPdfPage } from './pdfPage';

/**
 * "no machine" (Adrianne Lenker, arr. Asher Blank): a 10-page Dorico 6 export
 * of a five-voice choir arrangement in Bravura / Academico, 6 sharps, quarter
 * = 74, with bracketed voice groups and two rhythm staves late in the score.
 * It covers two things no other fixture does: Dorico reports its noteheads
 * from SMuFL's optional-glyph area, and its bracket serifs merge into the
 * outer staff line of each group. It is not a public-domain edition, so it
 * stays out of git: put it at fixtures/external/no-machine.pdf (or set
 * SMR_NO_MACHINE_PDF) to run this suite.
 */
const ROOT = path.resolve(__dirname, '../..');
const PDF = process.env.SMR_NO_MACHINE_PDF || path.join(ROOT, 'fixtures/external/no-machine.pdf');
const available = fs.existsSync(PDF);

async function parsePages(pageNumbers?: number[]) {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, fontExtraProperties: true, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const numbers = pageNumbers ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const pages = [];
  for (let i = 0; i < numbers.length; i++) pages.push(await extractPdfPage(await doc.getPage(numbers[i]), i, pdfjs.OPS as unknown as Record<string, number>));
  const pageCount = doc.numPages;
  await doc.destroy();
  return { pageCount, ...analyze(pages, { fileName: 'no-machine.pdf' }) };
}

describe.skipIf(!available)('no machine (external Dorico export)', () => {
  it('reads the five bracketed voice staves, the title, key and tempo on page 1', async () => {
    const { score, debug, pageCount } = await parsePages([1]);
    if (process.env.SMR_DEBUG) {
      console.log(JSON.stringify({
        title: score.title,
        tempo: score.tempoBpm,
        staves: debug.staves.length,
        tracks: score.tracks.map((t) => `${t.name} ${t.clef} ${t.notes.length}`),
        warnings: score.warnings,
      }, null, 1));
    }
    expect(pageCount).toBe(10);
    expect(score.source.fonts).toEqual(expect.arrayContaining(['Bravura']));
    expect(score.title).toBe('no machine');
    expect(score.tempoBpm).toBe(74);
    expect(score.keySignatures[0]).toEqual({ measure: 0, fifths: 6 });
    // Two systems of five voices; the outer line of each bracketed group carries a merged serif.
    expect(debug.staves).toHaveLength(10);
    expect(debug.systems.map((s) => s.staves)).toEqual([5, 5]);
    expect(score.tracks).toHaveLength(5);
    expect(score.tracks.map((t) => t.clef)).toEqual(['treble', 'treble', 'treble', 'treble', 'bass']);
    expect(score.tracks.every((t) => t.notes.length > 20)).toBe(true);
  });

  it('reads every page, and the voice staves fill their bars', async () => {
    const { score } = await parsePages();
    expect(score.measures.length).toBeGreaterThanOrEqual(70);
    expect(score.durationQn).toBeGreaterThan(250);
    const voices = score.tracks.filter((t) => t.clef === 'treble' || t.clef === 'bass');
    expect(voices).toHaveLength(5);
    expect(voices.every((t) => t.notes.length > 200)).toBe(true);
    expect(score.tracks.every((t) => t.notes.every((n) => n.layout))).toBe(true);
    // Every complaint about a bar not filling belongs to the two rhythm staves, never a voice.
    const fill = score.warnings.filter((w) => /durations fill/.test(w));
    expect(fill.every((w) => /staff [12]:/.test(w))).toBe(true);
  });
});
