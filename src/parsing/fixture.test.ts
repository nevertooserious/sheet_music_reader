import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from './analyze';
import { compareScoreToReference } from './compare';
import { parseReferenceMidi } from './midiReference';
import { extractPdfPage } from './pdfPage';

const ROOT = path.resolve(__dirname, '../..');
const PDF = path.join(ROOT, 'public/fixtures/bach-minuet-g.pdf');
const MID = path.join(ROOT, 'public/fixtures/bach-minuet-g.mid');

async function parseFixture() {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, fontExtraProperties: true, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) pages.push(await extractPdfPage(await doc.getPage(i + 1), i, pdfjs.OPS as unknown as Record<string, number>));
  await doc.destroy();
  return analyze(pages, { fileName: 'bach-minuet-g.pdf' });
}

describe('bach-minuet-g fixture (real PDF through pdf.js in Node)', () => {
  it('reads the score and matches the reference MIDI', async () => {
    const { score, debug } = await parseFixture();
    const reference = parseReferenceMidi(new Uint8Array(fs.readFileSync(MID)));
    const cmp = compareScoreToReference(score, reference);
    const summary = {
      variant: cmp.variant,
      f1: cmp.overall.onsetPitchF1,
      lcs: cmp.overall.pitchLcsRatio,
      dur: cmp.overall.durationAccuracy,
      tracks: cmp.tracks.map((t) => ({ ref: t.refTrack, got: t.scoreTrack, refN: t.refNoteCount, gotN: t.gotNoteCount, f1: t.onsetPitchF1, lcs: t.pitchLcsRatio, missing: t.missingSample.slice(0, 6), extra: t.extraSample.slice(0, 6) })),
      measures: score.measures.length,
      staves: debug.staves.length,
      systems: debug.systems.length,
      timeline: score.timeline.length,
      durationQn: score.durationQn,
      time: score.timeSignatures,
      key: score.keySignatures,
      title: score.title,
      composer: score.composer,
      warnings: score.warnings,
      glyphs: debug.glyphCounts,
      methods: debug.measures.map((m) => m.method.join('/')).join(' '),
      durations: score.measures.map((m) => m.durationQn).join(' '),
      repeats: score.measures.filter((m) => m.repeatStart || m.repeatEnd).map((m) => `${m.index}${m.repeatStart ? 'S' : ''}${m.repeatEnd ? 'E' : ''}`).join(' '),
    };
    if (process.env.SMR_DEBUG) console.log(JSON.stringify(summary, null, 1));
    expect(debug.staves.length).toBe(12);
    expect(debug.systems.length).toBe(6);
    expect(score.measures.length).toBe(32);
    expect(score.timeSignatures[0]).toEqual({ measure: 0, beats: 3, beatType: 4 });
    expect(score.keySignatures[0]).toEqual({ measure: 0, fifths: 1 });
    expect(score.tracks.map((t) => t.name)).toEqual(['Right hand', 'Left hand']);
    expect(score.title).toBe('Menuet in G');
    expect(score.timeline.length).toBe(64);
    expect(cmp.overall.onsetPitchF1).toBeGreaterThanOrEqual(0.95);
    expect(cmp.overall.pitchLcsRatio).toBeGreaterThanOrEqual(0.97);
    expect(score.tracks.every((t) => t.notes.every((n) => n.layout && Number.isFinite(n.layout.x)))).toBe(true);
  }, 60000);
});
