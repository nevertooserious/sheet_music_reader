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
function arc(x1: number, x2: number, y: number, height: number): PathShape {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: x1 + (x2 - x1) * (i / 8), y: y - height * Math.sin(Math.PI * (i / 8)) });
  for (let i = 8; i >= 0; i--) pts.push({ x: x1 + (x2 - x1) * (i / 8), y: y - (height - 0.15 * SP) * Math.sin(Math.PI * (i / 8)) });
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x1, maxX: x2, minY: y - height, maxY: y }, lineWidth: 0, hasCurves: true };
}
const stemUp = (cx: number, y: number, top = y - 3.5 * SP) => rect(cx + 0.55 * SP, top, 0.3, y - top);
const flag = (cx: number, y: number) => glyph('flags.u3', cx + 0.55 * SP, y - 3.5 * SP, 0.3);
const dot = (x: number, y: number) => glyph('dots.dot', x, y, 0.112);
const smallDigit = (name: string, cxStem: number, beamTop: number) => glyph(name, cxStem - 0.5 * 0.333 * 0.5 * EM, beamTop - 1.2 * SP, 0.333, 0.5 * EM);
const beam = (x1: number, x2: number, top: number) => rect(x1 + 0.55 * SP, top, x2 - x1, 0.45 * SP);
function text(t: string, x: number, y: number, size = 8): TextRun {
  return { page: 0, fontName: 'TeXGyreSchola-Regular', text: t, x, y, size, right: x + 0.55 * size * t.length };
}
function page(glyphs: GlyphPlacement[], paths: PathShape[], extra: Partial<PageExtraction> = {}): PageExtraction {
  return { index: 0, width: 400, height: 400, fonts: [{ id: 'f3', name: 'Emmentaler-20', family: 'emmentaler' }], glyphs, paths, texts: [], imageCount: 0, ...extra };
}
const staffPaths = (top: number, x1 = 30, x2 = 360) => [0, 1, 2, 3, 4].map((i) => stroke(x1, top + i * SP, x2, top + i * SP, 0.5));
const trebleClef = (top: number) => glyph('clefs.G', 34, top + 3 * SP, 0.641);
const bassClef = (top: number) => glyph('clefs.F', 34, top + SP, 0.67);
const timeSig = (top: number, num: string, den: string) => [glyph(num, 62, top + 2 * SP, 0.4), glyph(den, 62, top + 4 * SP, 0.4)];
const barline = (x: number, top: number, bottom = top + 4 * SP) => stroke(x, top, x, bottom, 1);
const notesOf = (score: { tracks: Array<{ notes: Array<{ midi: number; startQn: number; durationQn: number }> }> }, track = 0) =>
  score.tracks[track].notes.map((n) => [n.midi, n.startQn, n.durationQn]);
const durations = (score: { measures: Array<{ durationQn: number }> }) => score.measures.map((m) => m.durationQn);

const T1 = 100;
const M1 = T1 + 2 * SP;
const T2 = 220;
const M2 = T2 + 2 * SP;

describe('single-staff anacrusis', () => {
  it('accepts an eighth-note pickup in 4/4 with a complementary 3.5-qn last bar', () => {
    const glyphs = [trebleClef(T1), ...timeSig(T1, 'four', 'four'), head(100, M1), flag(100, M1), head(170, M1, 's0'), head(250, M1), head(280, M1), head(310, M1), head(340, M1), flag(340, M1)];
    const paths = [...staffPaths(T1), stemUp(100, M1), barline(118, T1), barline(230, T1), ...[250, 280, 310, 340].map((x) => stemUp(x, M1)), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'pickup44.pdf' });
    expect(durations(score)).toEqual([0.5, 4, 3.5]);
    expect(notesOf(score)).toEqual([
      [71, 0, 0.5],
      [71, 0.5, 4],
      [71, 4.5, 1],
      [71, 5.5, 1],
      [71, 6.5, 1],
      [71, 7.5, 0.5],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('accepts an eighth-note pickup in 4/4 without a complementary last bar', () => {
    const glyphs = [trebleClef(T1), ...timeSig(T1, 'four', 'four'), head(100, M1), flag(100, M1), head(170, M1, 's0'), head(290, M1, 's0')];
    const paths = [...staffPaths(T1), stemUp(100, M1), barline(118, T1), barline(230, T1), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'pickup44b.pdf' });
    expect(durations(score)).toEqual([0.5, 4, 4]);
    expect(notesOf(score)).toEqual([
      [71, 0, 0.5],
      [71, 0.5, 4],
      [71, 4.5, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('accepts an eighth-note pickup in 3/4, with and without the complementary last bar', () => {
    const base = [trebleClef(T1), ...timeSig(T1, 'three', 'four'), head(100, M1), flag(100, M1), head(170, M1, 's1'), dot(178, M1 - 0.5 * SP)];
    const plain = analyze([page(base, [...staffPaths(T1), stemUp(100, M1), barline(118, T1), stemUp(170, M1), barline(360, T1)])], { fileName: 'pickup34.pdf' });
    expect(durations(plain.score)).toEqual([0.5, 3]);
    expect(notesOf(plain.score)).toEqual([
      [71, 0, 0.5],
      [71, 0.5, 3],
    ]);
    expect(plain.score.warnings).toEqual([]);

    // Last bar: quarter, quarter, eighth = 2.5 qn, completing the 0.5-qn pickup.
    const glyphs = [...base, head(260, M1), head(295, M1), head(330, M1), flag(330, M1)];
    const paths = [...staffPaths(T1), stemUp(100, M1), barline(118, T1), stemUp(170, M1), barline(240, T1), ...[260, 295, 330].map((x) => stemUp(x, M1)), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'pickup34b.pdf' });
    expect(durations(score)).toEqual([0.5, 3, 2.5]);
    expect(notesOf(score).map((n) => n[1])).toEqual([0, 0.5, 3.5, 4.5, 5.5]);
    expect(score.warnings).toEqual([]);
  });

  it('still keeps the nominal length for a short last bar that completes nothing', () => {
    // No pickup; the last bar holds 3.5 qn in 4/4: a misread, not an anacrusis.
    const glyphs = [trebleClef(T1), ...timeSig(T1, 'four', 'four'), head(100, M1, 's0'), head(250, M1), head(280, M1), head(310, M1), head(340, M1), flag(340, M1)];
    const paths = [...staffPaths(T1), barline(230, T1), ...[250, 280, 310, 340].map((x) => stemUp(x, M1)), barline(360, T1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'shortlast.pdf' });
    expect(durations(score)).toEqual([4, 4]);
    expect(score.warnings).toEqual(['Measure 2, staff 1: durations fill 3.5 of 4 quarter notes; onsets were read left to right.']);
  });

  it('accepts a short bar after |: that a short bar before :| completes', () => {
    // Bar 1 full; |: eighth pickup | full | 3.5 :|
    const glyphs = [
      trebleClef(T1),
      ...timeSig(T1, 'four', 'four'),
      head(90, M1, 's0'),
      dot(122, M1 - 0.5 * SP),
      dot(122, M1 + 0.5 * SP),
      head(140, M1),
      flag(140, M1),
      head(190, M1, 's0'),
      head(250, M1),
      head(275, M1),
      head(300, M1),
      head(325, M1),
      flag(325, M1),
      dot(352, M1 - 0.5 * SP),
      dot(352, M1 + 0.5 * SP),
    ];
    const paths = [
      ...staffPaths(T1),
      stroke(115, T1, 115, T1 + 4 * SP, 3),
      stroke(118, T1, 118, T1 + 4 * SP, 1),
      stemUp(140, M1),
      barline(155, T1),
      barline(230, T1),
      ...[250, 275, 300, 325].map((x) => stemUp(x, M1)),
      stroke(356, T1, 356, T1 + 4 * SP, 1),
      stroke(359, T1, 359, T1 + 4 * SP, 3),
    ];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'repeatpickup.pdf' });
    expect(durations(score)).toEqual([4, 0.5, 4, 3.5]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 2, 3, 1, 2, 3]);
    expect(score.warnings).toEqual([]);
  });
});

describe('beam tuplets in short bars and mixed with fingerings', () => {
  it('applies a beamed triplet in a short last bar that completes a quarter pickup', () => {
    const bt = M1 - 3.5 * SP;
    const trip = [262, 280, 298];
    const glyphs = [trebleClef(T1), ...timeSig(T1, 'four', 'four'), head(100, M1), head(180, M1, 's0'), ...trip.map((x) => head(x, M1)), smallDigit('three', 280 + 0.55 * SP, bt), head(335, M1, 's1')];
    const paths = [...staffPaths(T1), stemUp(100, M1), barline(122, T1), barline(240, T1), ...trip.map((x) => stemUp(x, M1, bt)), beam(262, 298, bt), stemUp(335, M1), barline(360, T1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'triplet-last.pdf' });
    expect(durations(score)).toEqual([1, 4, 3]);
    expect(debug.tuplets.map((t) => `${t.actual}:${t.normal}`)).toEqual(['3:2']);
    expect(notesOf(score).map((n) => n[1])).toEqual([0, 1, 5, 5.3333, 5.6667, 6]);
    expect(score.warnings).toEqual([]);
  });

  it('keeps only the triplet when a fingering is centred over another beamed group in the same bar', () => {
    const bt = M1 - 3.5 * SP;
    const trip = [100, 118, 136];
    const three = [170, 188, 206];
    const glyphs = [
      trebleClef(T1),
      ...timeSig(T1, 'four', 'four'),
      ...trip.map((x) => head(x, M1)),
      smallDigit('three', 118 + 0.55 * SP, bt),
      ...three.map((x) => head(x, M1)),
      smallDigit('two', 188 + 0.55 * SP, bt),
      head(250, M1),
      flag(250, M1),
      head(300, M1),
    ];
    const paths = [...staffPaths(T1), ...trip.map((x) => stemUp(x, M1, bt)), beam(100, 136, bt), ...three.map((x) => stemUp(x, M1, bt)), beam(170, 206, bt), stemUp(250, M1), stemUp(300, M1), barline(360, T1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'triplet-fingering.pdf' });
    expect(debug.tuplets.map((t) => `${t.actual}:${t.normal}`)).toEqual(['3:2']);
    expect(debug.measures[0].method).toEqual(['single']);
    expect(notesOf(score).map((n) => n[1])).toEqual([0, 0.3333, 0.6667, 1, 1.5, 2, 2.5, 3]);
    expect(score.warnings).toEqual([]);
  });

  it('without a time signature believes a "3" over three beamed notes but not a "2" over them', () => {
    const bt = M1 - 3.5 * SP;
    const xs = [100, 118, 136];
    const build = (digit: string) => {
      const glyphs = [trebleClef(T1), ...xs.map((x) => head(x, M1)), smallDigit(digit, 118 + 0.55 * SP, bt), head(200, M1), head(260, M1, 's1')];
      const paths = [...staffPaths(T1), ...xs.map((x) => stemUp(x, M1, bt)), beam(100, 136, bt), stemUp(200, M1), stemUp(260, M1), barline(360, T1)];
      return analyze([page(glyphs, paths)], { fileName: `notime-${digit}.pdf` });
    };
    expect(build('three').debug.tuplets).toHaveLength(1);
    expect(durations(build('three').score)).toEqual([4]);
    expect(build('two').debug.tuplets).toHaveLength(0);
    expect(durations(build('two').score)).toEqual([4.5]);
  });

  it('without a time signature ignores a number over an even beamed group', () => {
    const bt = M1 - 3.5 * SP;
    const xs = [100, 118, 136, 154];
    const glyphs = [trebleClef(T1), ...xs.map((x) => head(x, M1)), smallDigit('four', 127 + 0.55 * SP, bt), head(220, M1, 's1')];
    const paths = [...staffPaths(T1), ...xs.map((x) => stemUp(x, M1, bt)), beam(100, 154, bt), stemUp(220, M1), barline(360, T1)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'notime-four.pdf' });
    expect(debug.tuplets).toHaveLength(0);
    expect(durations(score)).toEqual([4]);
  });
});

describe('ties broken at a line break behind a key signature', () => {
  const sharps = (top: number, count: number) => {
    const steps = [0, 1.5, -0.5, 1, 2.5, 0.5, 2];
    return steps.slice(0, count).map((s, i) => glyph('accidentals.sharp', 52 + i * 7, top + s * SP, 0.275));
  };

  for (const count of [1, 2, 4]) {
    it(`merges a continuation arc drawn after a clef and ${count} sharp(s)`, () => {
      const keyRight = 52 + (count - 1) * 7 + 0.275 * EM;
      const arcStart = keyRight + 1.5 * SP;
      const firstHead = arcStart + 2.5 * SP;
      const glyphs = [
        trebleClef(T1),
        ...sharps(T1, count),
        ...timeSig(T1, 'four', 'four'),
        head(120, M1, 's0'),
        head(200, M1, 's0'),
        head(300, M1, 's0'),
        trebleClef(T2),
        ...sharps(T2, count),
        head(firstHead, M2, 's0'),
        head(250, M2 - SP, 's0'),
      ];
      const paths = [
        ...staffPaths(T1),
        barline(150, T1),
        barline(250, T1),
        barline(360, T1),
        arc(300, 356, M1 - 0.6 * SP, 0.8 * SP),
        ...staffPaths(T2),
        arc(arcStart, firstHead - 0.4 * SP, M2 - 0.6 * SP, 0.8 * SP),
        barline(200, T2),
        barline(360, T2),
      ];
      const { score } = analyze([page(glyphs, paths)], { fileName: `tie-${count}.pdf` });
      expect(score.keySignatures[0].fifths).toBe(count);
      expect(notesOf(score).map((n) => [n[1], n[2]])).toEqual([
        [0, 4],
        [4, 4],
        [8, 8],
        [16, 4],
      ]);
      expect(score.warnings).toEqual([]);
    });
  }

  it('does not treat an arc arriving at a later head of the line as a continuation', () => {
    const glyphs = [trebleClef(T1), ...timeSig(T1, 'four', 'four'), head(100, M1, 's0'), head(300, M1, 's0'), trebleClef(T2), head(100, M2, 's0'), head(200, M2, 's0')];
    const paths = [...staffPaths(T1), barline(250, T1), barline(360, T1), arc(300, 356, M1 - 0.6 * SP, 0.8 * SP), ...staffPaths(T2), arc(150, 194, M2 - 0.6 * SP, 0.8 * SP), barline(150, T2), barline(250, T2), barline(360, T2)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'tie-later.pdf' });
    expect(notesOf(score).map((n) => [n[1], n[2]])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4],
    ]);
  });
});

describe('volta continuation starting after the clef and key', () => {
  it('inherits the first ending onto a continuation line that begins 8 sp into the staff', () => {
    const y1 = T1 - 4 * SP;
    const y2 = T2 - 4 * SP;
    const glyphs = [
      trebleClef(T1),
      glyph('accidentals.sharp', 52, T1, 0.275),
      ...timeSig(T1, 'four', 'four'),
      head(100, M1, 's0'),
      head(170, M1 - SP, 's0'),
      trebleClef(T2),
      glyph('accidentals.sharp', 52, T2, 0.275),
      head(100, M2 + SP, 's0'),
      head(200, M2 + 0.5 * SP, 's0'),
      head(300, M2 - 0.5 * SP, 's0'),
      dot(140, M2 - 0.5 * SP),
      dot(140, M2 + 0.5 * SP),
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
      stroke(78, y2, 146, y2, 0.5),
      stroke(154, y2, 250, y2, 0.5),
      stroke(154, y2, 154, y2 + 2 * SP, 0.5),
    ];
    const texts = [text('1.', 122, y1 + 2 * SP), text('2.', 156, y2 + 2 * SP)];
    const { score, debug } = analyze([page(glyphs, paths, { texts })], { fileName: 'voltacont8.pdf' });
    expect(debug.voltas.map((v) => [v.numbers, !!v.inherited, Math.round(v.x1)])).toEqual([
      [[1], false, 120],
      [[1], true, 30],
      [[2], false, 154],
    ]);
    expect(debug.measures.map((m) => m.volta)).toEqual([undefined, [1], [1], [2], undefined]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it('inherits a last ending across a line break that is followed by a new |: section', () => {
    // Line 1: m1 |: m2 | m3 [1. :|] m4 [2. open at the line end]; line 2: m5 (continuation of 2.) |: m6 :|
    const y1 = T1 - 4 * SP;
    const y2 = T2 - 4 * SP;
    const glyphs = [
      trebleClef(T1),
      ...timeSig(T1, 'four', 'four'),
      head(80, M1, 's0'),
      dot(108, M1 - 0.5 * SP),
      dot(108, M1 + 0.5 * SP),
      head(140, M1 - SP, 's0'),
      head(215, M1 + SP, 's0'),
      dot(240, M1 - 0.5 * SP),
      dot(240, M1 + 0.5 * SP),
      head(305, M1, 's0'),
      trebleClef(T2),
      head(100, M2 + SP, 's0'),
      dot(158, M2 - 0.5 * SP),
      dot(158, M2 + 0.5 * SP),
      head(250, M2, 's0'),
      dot(348, M2 - 0.5 * SP),
      dot(348, M2 + 0.5 * SP),
    ];
    const paths = [
      ...staffPaths(T1),
      stroke(100, T1, 100, T1 + 4 * SP, 3),
      stroke(103, T1, 103, T1 + 4 * SP, 1),
      barline(180, T1),
      stroke(247, T1, 247, T1 + 4 * SP, 1),
      stroke(250, T1, 250, T1 + 4 * SP, 3),
      barline(360, T1),
      stroke(180, y1, 246, y1, 0.5),
      stroke(180, y1, 180, y1 + 2 * SP, 0.5),
      stroke(246, y1, 246, y1 + 2 * SP, 0.5),
      stroke(254, y1, 360, y1, 0.5),
      stroke(254, y1, 254, y1 + 2 * SP, 0.5),
      ...staffPaths(T2),
      stroke(150, T2, 150, T2 + 4 * SP, 3),
      stroke(153, T2, 153, T2 + 4 * SP, 1),
      stroke(356, T2, 356, T2 + 4 * SP, 1),
      stroke(359, T2, 359, T2 + 4 * SP, 3),
      stroke(70, y2, 148, y2, 0.5),
    ];
    const texts = [text('1.', 182, y1 + 2 * SP), text('2.', 256, y1 + 2 * SP)];
    const { score, debug } = analyze([page(glyphs, paths, { texts })], { fileName: 'voltalast.pdf' });
    expect(debug.voltas.map((v) => [v.numbers, !!v.inherited])).toEqual([
      [[1], false],
      [[2], false],
      [[2], true],
    ]);
    expect(debug.measures.map((m) => [m.volta, m.repeatStart, m.repeatEnd])).toEqual([
      [undefined, false, false],
      [undefined, true, false],
      [[1], false, true],
      [[2], false, false],
      [[2], false, false],
      [undefined, true, true],
    ]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 2, 1, 3, 4, 5, 5]);
    expect(score.warnings).toEqual([]);
  });
});

describe('two-staff scores keep the corroborated short-bar rule', () => {
  it('accepts an eighth pickup agreed by both staves', () => {
    const glyphs = [
      trebleClef(T1),
      ...timeSig(T1, 'four', 'four'),
      head(100, M1),
      flag(100, M1),
      head(200, M1, 's0'),
      bassClef(T2),
      ...timeSig(T2, 'four', 'four'),
      head(100, M2),
      flag(100, M2),
      head(200, M2, 's0'),
    ];
    const paths = [...staffPaths(T1), ...staffPaths(T2), stemUp(100, M1), stemUp(100, M2), barline(118, T1, T2 + 4 * SP), barline(360, T1, T2 + 4 * SP), stroke(30, T1, 30, T2 + 4 * SP, 1)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'piano-pickup.pdf' });
    expect(durations(score)).toEqual([0.5, 4]);
    expect(score.tracks.map((t) => t.name)).toEqual(['Right hand', 'Left hand']);
    expect(score.warnings).toEqual([]);
  });
});
