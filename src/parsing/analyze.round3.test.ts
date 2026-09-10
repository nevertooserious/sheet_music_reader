import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import type { GlyphPlacement, PageExtraction, PathShape, TextRun } from './model';

const SP = 6;
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
/** Filled arc from (x1, y) to (x2, y) bulging up by `height`. */
function arc(x1: number, x2: number, y: number, height: number): PathShape {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: x1 + (x2 - x1) * (i / 8), y: y - height * Math.sin(Math.PI * (i / 8)) });
  for (let i = 8; i >= 0; i--) pts.push({ x: x1 + (x2 - x1) * (i / 8), y: y - (height - 0.15 * SP) * Math.sin(Math.PI * (i / 8)) });
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x1, maxX: x2, minY: y - height, maxY: y }, lineWidth: 0, hasCurves: true };
}
function stemUp(cx: number, y: number): PathShape {
  return rect(cx + 0.55 * SP, y - 3.5 * SP, 0.3, 3.5 * SP);
}
function text(t: string, x: number, y: number, size = 8): TextRun {
  return { page: 0, fontName: 'TeXGyreSchola-Regular', text: t, x, y, size, right: x + 0.55 * size * t.length };
}
function page(glyphs: GlyphPlacement[], paths: PathShape[], extra: Partial<PageExtraction> = {}): PageExtraction {
  return { index: 0, width: 400, height: 400, fonts: [{ id: 'f3', name: 'Emmentaler-20', family: 'emmentaler' }], glyphs, paths, texts: [], imageCount: 0, ...extra };
}
const staffPaths = (top: number, x1 = 30, x2 = 360) => [0, 1, 2, 3, 4].map((i) => stroke(x1, top + i * SP, x2, top + i * SP, 0.5));
const trebleClef = (top: number) => glyph('clefs.G', 34, top + 3 * SP, 0.641);
const fourFour = (top: number) => [glyph('four', 62, top + 2 * SP, 0.4), glyph('four', 62, top + 4 * SP, 0.4)];
const barline = (x: number, top: number) => stroke(x, top, x, top + 4 * SP, 1);
const notesOf = (score: { tracks: Array<{ notes: Array<{ midi: number; startQn: number; durationQn: number }> }> }, track = 0) =>
  score.tracks[track].notes.map((n) => [n.midi, n.startQn, n.durationQn]);

/** Two lines: staff tops T1 / T2, middle lines M1 / M2. */
const T1 = 100;
const M1 = T1 + 2 * SP;
const T2 = 220;
const M2 = T2 + 2 * SP;

describe('fingerings versus tuplet numbers', () => {
  const fingeredBar = (digit: string, over: number) => {
    // Bar 1: four beamed eighths + half; bar 2: whole. A small digit sits above one of the eighths.
    const xs = [100, 118, 136, 154];
    const beamTop = M1 - 3.5 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      ...xs.map((x) => head(x, M1)),
      glyph(digit, over + 0.55 * SP - 2, beamTop - 1.2 * SP, 0.333, 0.5 * EM),
      head(200, M1, 's1'),
      head(290, M1, 's0'),
    ];
    const paths = [...staffPaths(T1), ...xs.map((x) => stemUp(x, M1)), rect(100 + 0.55 * SP, beamTop, 54, 0.45 * SP), stemUp(200, M1), barline(240, T1), barline(360, T1)];
    return analyze([page(glyphs, paths)], { fileName: `fingering-${digit}.pdf` });
  };

  for (const digit of ['two', 'three', 'four', 'five']) {
    it(`ignores a fingering "${digit}" above the third of four beamed eighths`, () => {
      const { score, debug } = fingeredBar(digit, 136);
      expect(debug.tuplets).toHaveLength(0);
      expect(score.measures.map((m) => m.durationQn)).toEqual([4, 4]);
      expect(notesOf(score)).toEqual([
        [71, 0, 0.5],
        [71, 0.5, 0.5],
        [71, 1, 0.5],
        [71, 1.5, 0.5],
        [71, 2, 2],
        [71, 4, 4],
      ]);
      expect(score.warnings).toEqual([]);
    });
  }

  it('ignores a "3" centred over three beamed eighths when the bar already adds up', () => {
    // 4/4: eighth eighth eighth (beamed, fingering "3" over the middle one) + eighth + half = 4 qn without any tuplet.
    const xs = [100, 118, 136];
    const beamTop = M1 - 3.5 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      ...xs.map((x) => head(x, M1)),
      glyph('three', 118 + 0.55 * SP - 0.5 * 0.333 * 0.5 * EM, beamTop - 1.2 * SP, 0.333, 0.5 * EM),
      head(170, M1),
      glyph('flags.u3', 170 + 0.55 * SP, M1 - 3.5 * SP, 0.3),
      head(250, M1, 's1'),
    ];
    const paths = [...staffPaths(T1), ...xs.map((x) => stemUp(x, M1)), rect(100 + 0.55 * SP, beamTop, 36, 0.45 * SP), stemUp(170, M1), stemUp(250, M1), barline(360, T1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'three-eighths.pdf' });
    expect(debug.tuplets).toHaveLength(0);
    expect(notesOf(score)).toEqual([
      [71, 0, 0.5],
      [71, 0.5, 0.5],
      [71, 1, 0.5],
      [71, 1.5, 0.5],
      [71, 2, 2],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('still applies a "3" over a beam when the bar only adds up as a triplet', () => {
    const xs = [100, 118, 136];
    const beamTop = M1 - 3.5 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      ...xs.map((x) => head(x, M1)),
      glyph('three', 118 + 0.55 * SP - 0.5 * 0.333 * 0.5 * EM, beamTop - 1.2 * SP, 0.333, 0.5 * EM),
      head(200, M1),
      head(260, M1),
      head(320, M1),
    ];
    const paths = [...staffPaths(T1), ...xs.map((x) => stemUp(x, M1)), rect(100 + 0.55 * SP, beamTop, 36, 0.45 * SP), stemUp(200, M1), stemUp(260, M1), stemUp(320, M1), barline(360, T1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'triplet.pdf' });
    expect(debug.tuplets).toHaveLength(1);
    expect(notesOf(score).map((n) => n[1])).toEqual([0, 0.3333, 0.6667, 1, 2, 3]);
    expect(score.warnings).toEqual([]);
  });
});

describe('short first bars', () => {
  it('warns about an off-grid short first bar on a single staff and keeps the nominal length', () => {
    // 4/4 bar 1: quarter, quarter, quarter, eighth = 3.5 qn; not a whole number of beats, so not an anacrusis.
    const glyphs = [trebleClef(T1), ...fourFour(T1), head(100, M1), head(140, M1), head(180, M1), head(220, M1), glyph('flags.u3', 220 + 0.55 * SP, M1 - 3.5 * SP, 0.3), head(290, M1, 's0')];
    const paths = [...staffPaths(T1), ...[100, 140, 180, 220].map((x) => stemUp(x, M1)), barline(240, T1), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'short.pdf' });
    expect(score.measures.map((m) => m.durationQn)).toEqual([4, 4]);
    expect(score.warnings).toEqual(['Measure 1, staff 1: durations fill 3.5 of 4 quarter notes; onsets were read left to right.']);
  });

  it('accepts a whole-beat anacrusis on a single staff without warning', () => {
    const glyphs = [trebleClef(T1), ...fourFour(T1), head(100, M1), head(160, M1, 's0')];
    const paths = [...staffPaths(T1), stemUp(100, M1), barline(120, T1), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'anacrusis.pdf' });
    expect(score.measures.map((m) => m.durationQn)).toEqual([1, 4]);
    expect(notesOf(score)).toEqual([
      [71, 0, 1],
      [71, 1, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });
});

describe('key signatures versus chord accidentals', () => {
  it('does not read the accidentals of a <F#4 C#5> chord at a bar start as a key change', () => {
    const f4 = M1 + 1.5 * SP;
    const c5 = M1 - 0.5 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      head(100, M1, 's0'),
      glyph('accidentals.sharp', 124, f4, 0.275),
      glyph('accidentals.sharp', 131, c5, 0.275),
      head(140, f4, 's0'),
      head(140, c5, 's0'),
      head(290, f4, 's0'),
    ];
    const { score } = analyze([page(glyphs, [...staffPaths(T1), barline(120, T1), barline(240, T1), barline(360, T1)])], { fileName: 'chordacc.pdf' });
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 0 }]);
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [66, 4, 4],
      [73, 4, 4],
      [65, 8, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('reads a G major to F major change whose natural cancels a sharp printed on the same line', () => {
    const glyphs = [
      trebleClef(T1),
      glyph('accidentals.sharp', 52, T1, 0.275),
      ...fourFour(T1),
      head(100, M1, 's0'),
      glyph('accidentals.natural', 124, T1, 0.2),
      glyph('accidentals.flat', 131, M1, 0.25),
      head(160, M1, 's0'),
      head(290, T1, 's0'),
    ];
    const { score } = analyze([page(glyphs, [...staffPaths(T1), barline(120, T1), barline(240, T1), barline(360, T1)])], { fileName: 'g2f.pdf' });
    expect(score.keySignatures).toEqual([
      { measure: 0, fifths: 1 },
      { measure: 1, fifths: -1 },
    ]);
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [70, 4, 4],
      [77, 8, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('reads a G major to C major change (lone cancellation natural) on the same line', () => {
    const glyphs = [trebleClef(T1), glyph('accidentals.sharp', 52, T1, 0.275), ...fourFour(T1), head(100, T1, 's0'), glyph('accidentals.natural', 124, T1, 0.2), head(180, T1, 's0')];
    const { score } = analyze([page(glyphs, [...staffPaths(T1), barline(120, T1), barline(360, T1)])], { fileName: 'g2c.pdf' });
    expect(score.keySignatures).toEqual([
      { measure: 0, fifths: 1 },
      { measure: 1, fifths: 0 },
    ]);
    expect(notesOf(score)).toEqual([
      [78, 0, 4],
      [77, 4, 4],
    ]);
  });
});

describe('ties and voltas across a line break', () => {
  it('merges a tie whose two halves sit on either side of a system break', () => {
    const glyphs = [trebleClef(T1), ...fourFour(T1), head(100, M1, 's0'), head(170, M1, 's0'), head(290, M1, 's0'), trebleClef(T2), head(100, M2, 's0'), head(200, M2 - SP, 's0')];
    const paths = [
      ...staffPaths(T1),
      barline(120, T1),
      barline(240, T1),
      barline(360, T1),
      arc(290, 356, M1 - 0.6 * SP, 0.8 * SP),
      ...staffPaths(T2),
      arc(44, 100, M2 - 0.6 * SP, 0.8 * SP),
      barline(150, T2),
      barline(360, T2),
    ];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'brokentie.pdf' });
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [71, 4, 4],
      [71, 8, 8],
      [74, 16, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('does not merge a repeated pitch across a line break when only one half-arc is present', () => {
    const glyphs = [trebleClef(T1), ...fourFour(T1), head(100, M1, 's0'), head(290, M1, 's0'), trebleClef(T2), head(100, M2, 's0')];
    const paths = [...staffPaths(T1), barline(240, T1), barline(360, T1), arc(290, 356, M1 - 0.6 * SP, 0.8 * SP), ...staffPaths(T2), barline(360, T2)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'halftie.pdf' });
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [71, 4, 4],
      [71, 8, 4],
    ]);
  });

  it('plays a first ending that continues, unnumbered, onto the next line only once', () => {
    // Line 1: m1 | m2 [1. starts] ; line 2: m3 (continuation, :|) | m4 [2.] | m5.
    const y1 = T1 - 4 * SP;
    const y2 = T2 - 4 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      head(100, M1, 's0'),
      head(170, M1 - SP, 's0'),
      trebleClef(T2),
      head(100, M2 + SP, 's0'),
      head(200, M2 + 0.5 * SP, 's0'),
      head(300, M2 - 0.5 * SP, 's0'),
      glyph('dots.dot', 140, M2 - 0.5 * SP, 0.112),
      glyph('dots.dot', 140, M2 + 0.5 * SP, 0.112),
    ];
    const paths = [
      ...staffPaths(T1),
      barline(120, T1),
      barline(360, T1),
      stroke(120, y1, 360, y1, 0.5),
      stroke(120, y1, 120, y1 + 2 * SP, 0.5),
      ...staffPaths(T2),
      stroke(147, T2, 147, T2 + 4 * SP, 1),
      stroke(150, T2, 150, T2 + 4 * SP, 3),
      barline(250, T2),
      barline(360, T2),
      stroke(30, y2, 146, y2, 0.5),
      stroke(154, y2, 250, y2, 0.5),
      stroke(154, y2, 154, y2 + 2 * SP, 0.5),
    ];
    const texts = [text('1.', 122, y1 + 2 * SP), text('2.', 156, y2 + 2 * SP)];
    const { score, debug } = analyze([page(glyphs, paths, { texts })], { fileName: 'voltacont.pdf' });
    expect(debug.voltas.map((v) => [v.numbers, !!v.inherited])).toEqual([
      [[1], false],
      [[1], true],
      [[2], false],
    ]);
    expect(debug.measures.map((m) => m.volta)).toEqual([undefined, [1], [1], [2], undefined]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 2, 0, 3, 4]);
    expect(score.warnings).toEqual([]);
  });

  it('does not inherit a first ending that closed with a hook at the line end', () => {
    // Line 1: m1 | m2 [1. :|] closed bracket; line 2: m3 [2.] | m4. The 2nd ending is detected normally.
    const y1 = T1 - 4 * SP;
    const y2 = T2 - 4 * SP;
    const glyphs = [
      trebleClef(T1),
      ...fourFour(T1),
      head(100, M1, 's0'),
      head(170, M1 - SP, 's0'),
      glyph('dots.dot', 350, M1 - 0.5 * SP, 0.112),
      glyph('dots.dot', 350, M1 + 0.5 * SP, 0.112),
      trebleClef(T2),
      head(100, M2 + SP, 's0'),
      head(300, M2 - 0.5 * SP, 's0'),
    ];
    const paths = [
      ...staffPaths(T1),
      barline(120, T1),
      stroke(356, T1, 356, T1 + 4 * SP, 1),
      stroke(359, T1, 359, T1 + 4 * SP, 3),
      stroke(120, y1, 356, y1, 0.5),
      stroke(120, y1, 120, y1 + 2 * SP, 0.5),
      stroke(356, y1, 356, y1 + 2 * SP, 0.5),
      ...staffPaths(T2),
      barline(200, T2),
      barline(360, T2),
      stroke(30, y2, 200, y2, 0.5),
      stroke(30, y2, 30, y2 + 2 * SP, 0.5),
    ];
    const texts = [text('1.', 122, y1 + 2 * SP), text('2.', 32, y2 + 2 * SP)];
    const { score, debug } = analyze([page(glyphs, paths, { texts })], { fileName: 'voltaclosed.pdf' });
    expect(debug.voltas.map((v) => [v.numbers, !!v.inherited])).toEqual([
      [[1], false],
      [[2], false],
    ]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 0, 2, 3]);
  });
});
