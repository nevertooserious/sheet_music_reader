import { describe, expect, it } from 'vitest';
import { analyze, RASTER_ERROR } from './analyze';
import type { GlyphPlacement, PageExtraction, PathShape } from './model';

const SP = 6;
const STAFF_TOP = 100;
const MIDDLE = STAFF_TOP + 2 * SP;
const EM = 4 * SP;

function glyph(name: string, x: number, y: number, advanceEm: number, size = EM): GlyphPlacement {
  return { page: 0, fontId: 'f3', fontName: 'Emmentaler-20', family: 'emmentaler', code: 1, name, x, y, advance: advanceEm * size, size };
}

function head(cx: number, y: number, shape: 's2' | 's1' | 's0' = 's2', size = EM): GlyphPlacement {
  const advance = 0.326 * size;
  return glyph(`noteheads.${shape}`, cx - advance / 2, y, 0.326, size);
}

function stroke(x1: number, y1: number, x2: number, y2: number, lineWidth = 0.8): PathShape {
  return {
    page: 0,
    kind: 'stroke',
    subpaths: [[{ x: x1, y: y1 }, { x: x2, y: y2 }]],
    bbox: { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2) },
    lineWidth,
    hasCurves: false,
  };
}

function rect(x: number, y: number, w: number, h: number): PathShape {
  const pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x, maxX: x + w, minY: y, maxY: y + h }, lineWidth: 0, hasCurves: false };
}

/** Stem on the right of a head, pointing up 3.5 spaces. */
function stemUp(cx: number, y: number): PathShape {
  return rect(cx + 0.55 * SP, y - 3.5 * SP, 0.3, 3.5 * SP);
}

function page(glyphs: GlyphPlacement[], paths: PathShape[], extra: Partial<PageExtraction> = {}): PageExtraction {
  return {
    index: 0,
    width: 400,
    height: 300,
    fonts: [{ id: 'f3', name: 'Emmentaler-20', family: 'emmentaler' }],
    glyphs,
    paths,
    texts: [],
    imageCount: 0,
    ...extra,
  };
}

const staffPaths = (x1 = 30, x2 = 360) => [0, 1, 2, 3, 4].map((i) => stroke(x1, STAFF_TOP + i * SP, x2, STAFF_TOP + i * SP, 0.5));

describe('analyze on hand-built pages', () => {
  it('rejects pages without music glyphs as scanned', () => {
    const p = page([], [rect(0, 0, 400, 300)], { fonts: [], imageCount: 1 });
    expect(() => analyze([p], { fileName: 'scan.pdf' })).toThrow(RASTER_ERROR);
  });

  it('rejects music glyphs without staff lines', () => {
    const p = page([glyph('clefs.G', 35, MIDDLE + SP, 0.641), head(100, MIDDLE)], []);
    expect(() => analyze([p], { fileName: 'x.pdf' })).toThrow(/No staff lines/);
  });

  it('reads a one-staff bar: clef, key, time, pitches, durations, barline', () => {
    const glyphs = [
      glyph('clefs.G', 34, MIDDLE + SP, 0.641),
      glyph('accidentals.sharp', 52, STAFF_TOP, 0.275), // F#5 on the top line: G major
      glyph('three', 62, MIDDLE, 0.333),
      glyph('four', 62, STAFF_TOP + 4 * SP, 0.4),
      head(100, MIDDLE), // B4 quarter
      head(150, MIDDLE + SP), // G4 quarter, one line down
      head(200, STAFF_TOP), // F#5 quarter from the key signature
      glyph('rests.2', 280, MIDDLE - 0.5 * SP, 0.4), // bar 2: quarter rest
      head(320, MIDDLE - SP, 's1'), // then D5 half
    ];
    const paths = [
      ...staffPaths(),
      stemUp(100, MIDDLE),
      stemUp(150, MIDDLE + SP),
      stemUp(200, STAFF_TOP),
      stemUp(320, MIDDLE - SP),
      stroke(250, STAFF_TOP, 250, STAFF_TOP + 4 * SP, 1), // barline
      stroke(360, STAFF_TOP, 360, STAFF_TOP + 4 * SP, 1), // final barline
    ];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'bar.pdf' });
    expect(debug.staves).toHaveLength(1);
    expect(debug.systems).toHaveLength(1);
    expect(score.timeSignatures).toEqual([{ measure: 0, beats: 3, beatType: 4 }]);
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 1 }]);
    expect(score.measures).toHaveLength(2);
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0].name).toBe('Staff 1');
    expect(score.tracks[0].clef).toBe('treble');
    const notes = score.tracks[0].notes;
    expect(notes.map((n) => [n.midi, n.startQn, n.durationQn])).toEqual([
      [71, 0, 1],
      [67, 1, 1],
      [78, 2, 1],
      [74, 4, 2],
    ]);
    expect(debug.rests).toHaveLength(1);
    expect(debug.rests[0].onsetQn).toBe(0);
    expect(score.durationQn).toBe(6);
    expect(score.measures[0].layout[0]).toMatchObject({ page: 0, x: 30 });
    expect(score.measures[1].firstStartQn).toBe(3);
    expect(notes[0].layout).toEqual({ page: 0, x: 100, y: MIDDLE });
    expect(score.warnings).toEqual([]);
    expect(score.tempoBpm).toBe(100);
  });

  it('warns and spaces onsets by position when a bar overruns its time signature', () => {
    const glyphs = [
      glyph('clefs.G', 34, MIDDLE + SP, 0.641),
      glyph('three', 62, MIDDLE, 0.333),
      glyph('four', 62, STAFF_TOP + 4 * SP, 0.4),
      head(100, MIDDLE),
      head(160, MIDDLE),
      head(220, MIDDLE),
      head(280, MIDDLE),
    ];
    const paths = [...staffPaths(), ...[100, 160, 220, 280].map((x) => stemUp(x, MIDDLE)), stroke(360, STAFF_TOP, 360, STAFF_TOP + 4 * SP, 1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'overrun.pdf' });
    expect(debug.measures[0].method).toEqual(['proportional']);
    expect(score.warnings).toHaveLength(1);
    expect(score.warnings[0]).toMatch(/Measure 1, staff 1: durations sum to 4 quarter notes in a 3-quarter measure/);
    expect(score.tracks[0].notes.every((n) => n.startQn >= 0 && n.startQn <= 3)).toBe(true);
  });

  it('halves black heads per beam, applies accidentals for the bar and names piano tracks', () => {
    const bassTop = STAFF_TOP + 14 * SP;
    const bassMiddle = bassTop + 2 * SP;
    const glyphs = [
      glyph('clefs.G', 34, MIDDLE + SP, 0.641),
      glyph('clefs.F', 34, bassTop + SP, 0.67),
      glyph('three', 62, MIDDLE, 0.333),
      glyph('four', 62, STAFF_TOP + 4 * SP, 0.4),
      glyph('three', 62, bassMiddle, 0.333),
      glyph('four', 62, bassTop + 4 * SP, 0.4),
      // treble: two beamed eighths (C5 with a sharp, then C5 again inheriting the sharp) + quarter + quarter
      glyph('accidentals.sharp', 90, MIDDLE - 0.5 * SP, 0.275),
      head(100, MIDDLE - 0.5 * SP),
      head(120, MIDDLE - 0.5 * SP),
      head(170, MIDDLE),
      head(230, MIDDLE),
      // bass: dotted half D3 on the middle line
      head(100, bassMiddle, 's1'),
      glyph('dots.dot', 106, bassMiddle - 0.5 * SP, 0.112),
    ];
    const beamTop = MIDDLE - 0.5 * SP - 3.5 * SP;
    const beam: PathShape = rect(100 + 0.55 * SP, beamTop, 20, 0.45 * SP);
    const paths = [
      ...staffPaths(),
      ...[0, 1, 2, 3, 4].map((i) => stroke(30, bassTop + i * SP, 360, bassTop + i * SP, 0.5)),
      rect(29.6, STAFF_TOP, 0.8, bassTop + 4 * SP - STAFF_TOP), // system line joining the staves
      stemUp(100, MIDDLE - 0.5 * SP),
      stemUp(120, MIDDLE - 0.5 * SP),
      beam,
      stemUp(170, MIDDLE),
      stemUp(230, MIDDLE),
      stemUp(100, bassMiddle),
      stroke(360, STAFF_TOP, 360, bassTop + 4 * SP, 1),
    ];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'piano.pdf' });
    expect(score.tracks.map((t) => t.name)).toEqual(['Right hand', 'Left hand']);
    expect(score.tracks[1].clef).toBe('bass');
    expect(score.tracks[0].notes.map((n) => [n.midi, n.startQn, n.durationQn])).toEqual([
      [73, 0, 0.5],
      [73, 0.5, 0.5],
      [71, 1, 1],
      [71, 2, 1],
    ]);
    expect(score.tracks[1].notes.map((n) => [n.midi, n.startQn, n.durationQn])).toEqual([[50, 0, 3]]);
    expect(score.warnings).toEqual([]);
  });

  it('unfolds a repeated bar and treats a small head as a grace note', () => {
    const glyphs = [
      glyph('clefs.G', 34, MIDDLE + SP, 0.641),
      glyph('three', 62, MIDDLE, 0.333),
      glyph('four', 62, STAFF_TOP + 4 * SP, 0.4),
      head(100, MIDDLE, 's1'),
      glyph('dots.dot', 106, MIDDLE - 0.5 * SP, 0.112),
      head(190, MIDDLE - SP, 's2', 0.7 * EM), // grace D5
      head(200, MIDDLE, 's1'),
      glyph('dots.dot', 206, MIDDLE - 0.5 * SP, 0.112),
      glyph('dots.dot', 345, MIDDLE - 0.5 * SP, 0.112),
      glyph('dots.dot', 345, MIDDLE + 0.5 * SP, 0.112),
    ];
    const paths = [
      ...staffPaths(),
      stemUp(100, MIDDLE),
      stemUp(200, MIDDLE),
      stroke(160, STAFF_TOP, 160, STAFF_TOP + 4 * SP, 1),
      stroke(356, STAFF_TOP, 356, STAFF_TOP + 4 * SP, 1),
      stroke(359, STAFF_TOP, 359, STAFF_TOP + 4 * SP, 3),
    ];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'repeat.pdf' });
    expect(score.measures.map((m) => !!m.repeatEnd)).toEqual([false, true]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 0, 1]);
    expect(score.durationQn).toBe(12);
    const notes = score.tracks[0].notes;
    const graces = notes.filter((n) => n.grace);
    expect(graces).toHaveLength(2);
    expect(graces[0].startQn).toBeCloseTo(2.875);
    expect(graces[0].midi).toBe(74);
    expect(graces[0].measure).toBe(0);
    expect(notes.filter((n) => !n.grace).map((n) => n.startQn)).toEqual([0, 3, 6, 9]);
  });
});
