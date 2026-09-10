import { createDemoScore } from '../core/demoScore';
import type { ClefKind, Measure, NoteEvent, PageInfo, ScoreModel, Track } from '../core/types';
import { clamp } from './format';
import { noteStaffY } from './mockPage';

/**
 * Scores staged by the ui showcase. Both are derived from core/demoScore so
 * the playhead, note highlights and the mock page renderer agree on layout.
 */

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

export function pageInfos(count: number): PageInfo[] {
  return Array.from({ length: count }, (_, index) => ({ index, width: PAGE_WIDTH, height: PAGE_HEIGHT }));
}

/** Demo score whose note y positions match the staff the mock page draws, plus warnings to exercise the header. */
export function createShowcaseScore(): ScoreModel {
  const score = createDemoScore();
  score.tracks.forEach((track, staffIndex) => {
    for (const note of track.notes) {
      const box = score.measures[note.measure]?.layout[staffIndex];
      if (note.layout && box) note.layout = { ...note.layout, y: noteStaffY(note.midi, track.clef, box) };
    }
  });
  score.warnings = [
    'Page 1, staff 2, bar 4: rest glyph "rests.M1" has no known duration; skipped.',
    'Page 1: 3 text glyphs from font "CenturySchL-Ital" ignored (not a music font).',
    'Tempo mark not found; defaulting to 108 bpm from the demo metadata.',
  ];
  return score;
}

interface Part {
  name: string;
  instrument: Track['instrument'];
  clef: ClefKind;
  transpose: number;
  /** Demo track whose rhythm and contour the part borrows: 0 = melody, 1 = bass. */
  source: 0 | 1;
}

const PARTS: Part[] = [
  { name: 'Flute', instrument: 'woodwind', clef: 'treble', transpose: 0, source: 0 },
  { name: 'Oboe', instrument: 'woodwind', clef: 'treble', transpose: -3, source: 0 },
  { name: 'Clarinet in B♭', instrument: 'woodwind', clef: 'treble', transpose: -7, source: 0 },
  { name: 'Viola', instrument: 'strings', clef: 'alto', transpose: -12, source: 0 },
  { name: 'Cello', instrument: 'strings', clef: 'bass', transpose: 0, source: 1 },
  { name: 'Double bass', instrument: 'strings', clef: 'bass', transpose: -7, source: 1 },
];

export interface EnsembleOptions {
  pages: number;
  staves: number;
  fileName: string;
}

const MEASURE_QN = 3;
const MEASURES_PER_SYSTEM = 4;
const SYSTEMS_PER_PAGE = 2;

/** A long multi-staff score (8 bars per page) that tiles the demo material, for virtualisation and mixer scenes. */
export function createEnsembleScore(options: EnsembleOptions): ScoreModel {
  const { pages, staves, fileName } = options;
  const demo = createDemoScore();
  const patterns = demo.tracks.map((t) => t.notes.filter((n) => n.startQn < demo.measures.length * MEASURE_QN));
  const measuresPerPage = MEASURES_PER_SYSTEM * SYSTEMS_PER_PAGE;
  const measureCount = pages * measuresPerPage;
  const left = 72;
  const systemWidth = PAGE_WIDTH - left - 48;
  const measureWidth = systemWidth / MEASURES_PER_SYSTEM;
  const staffPitch = staves > 4 ? 56 : 64;
  const systemHeight = (staves - 1) * staffPitch + 40;
  const firstTop = 120;
  const systemGap = 44;

  const measures: Measure[] = [];
  for (let i = 0; i < measureCount; i++) {
    const page = Math.floor(i / measuresPerPage);
    const inPage = i % measuresPerPage;
    const system = Math.floor(inPage / MEASURES_PER_SYSTEM);
    const col = inPage % MEASURES_PER_SYSTEM;
    const top = firstTop + system * (systemHeight + systemGap);
    measures.push({
      index: i,
      durationQn: MEASURE_QN,
      firstStartQn: i * MEASURE_QN,
      layout: Array.from({ length: staves }, (_, s) => ({
        page,
        x: left + col * measureWidth,
        y: top + s * staffPitch,
        width: measureWidth,
        height: 40,
      })),
    });
  }

  const tracks: Track[] = Array.from({ length: staves }, (_, s) => {
    const part = PARTS[s % PARTS.length];
    const id = `track-${s + 1}`;
    const source = patterns[part.source];
    const notes: NoteEvent[] = [];
    let n = 0;
    for (const measure of measures) {
      const box = measure.layout[s];
      const pattern = measure.index % demo.measures.length;
      for (const src of source) {
        if (src.measure !== pattern) continue;
        const offset = src.startQn - src.measure * MEASURE_QN;
        const midi = clamp(src.midi + part.transpose, 21, 108);
        notes.push({
          id: `${id}-${n++}`,
          trackId: id,
          midi,
          startQn: measure.firstStartQn + offset,
          durationQn: src.durationQn,
          velocity: src.velocity,
          measure: measure.index,
          layout: {
            page: box.page,
            x: box.x + 10 + (offset / MEASURE_QN) * (box.width - 20),
            y: noteStaffY(midi, part.clef, box),
          },
        });
      }
    }
    const repeat = Math.floor(s / PARTS.length);
    return {
      id,
      name: repeat > 0 ? `${part.name} ${repeat + 1}` : part.name,
      instrument: part.instrument,
      clef: part.clef,
      staffIndex: s,
      notes,
      defaultGain: 0.8,
    };
  });

  return {
    title: 'Sinfonia in G (showcase)',
    composer: 'Synthetic, after J. S. Bach',
    source: { fileName, pageCount: pages, engine: 'vector', fonts: ['Emmentaler-20'] },
    tempoBpm: 96,
    tempoMarks: [{ qn: 0, bpm: 96 }],
    timeSignatures: [{ measure: 0, beats: 3, beatType: 4 }],
    keySignatures: [{ measure: 0, fifths: 1 }],
    measures,
    timeline: measures.map((m) => ({ measure: m.index, startQn: m.firstStartQn, durationQn: MEASURE_QN })),
    tracks,
    durationQn: measureCount * MEASURE_QN,
    warnings: [
      `Page 7, staff 3: clef change glyph "clefs.C_change" not supported; kept ${PARTS[2].clef} clef.`,
      'Page 12: 2 dynamics glyphs ignored.',
    ],
  };
}
