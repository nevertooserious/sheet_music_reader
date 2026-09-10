import { describe, expect, it } from 'vitest';
import { analyze, legacyFontError, RASTER_ERROR } from './analyze';
import type { GlyphPlacement, PageExtraction, PathShape, TextRun } from './model';

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

/** A tie/slur-like filled arc from (x1, y) to (x2, y) bulging upwards by `height`. */
function arc(x1: number, x2: number, y: number, height: number): PathShape {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push({ x: x1 + (x2 - x1) * t, y: y - height * Math.sin(Math.PI * t) });
  }
  for (let i = 8; i >= 0; i--) {
    const t = i / 8;
    pts.push({ x: x1 + (x2 - x1) * t, y: y - (height - 0.15 * SP) * Math.sin(Math.PI * t) });
  }
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x1, maxX: x2, minY: y - height, maxY: y }, lineWidth: 0, hasCurves: true };
}

function stemUp(cx: number, y: number): PathShape {
  return rect(cx + 0.55 * SP, y - 3.5 * SP, 0.3, 3.5 * SP);
}

function stemDown(cx: number, y: number): PathShape {
  return rect(cx - 0.55 * SP - 0.3, y, 0.3, 3.5 * SP);
}

function text(t: string, x: number, y: number, size = 8): TextRun {
  return { page: 0, fontName: 'TeXGyreSchola-Regular', text: t, x, y, size, right: x + 0.55 * size * t.length };
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
const trebleClef = () => glyph('clefs.G', 34, MIDDLE + SP, 0.641);
const fourFour = () => [glyph('four', 62, MIDDLE, 0.4), glyph('four', 62, STAFF_TOP + 4 * SP, 0.4)];
const threeFour = () => [glyph('three', 62, MIDDLE, 0.333), glyph('four', 62, STAFF_TOP + 4 * SP, 0.4)];
const barline = (x: number) => stroke(x, STAFF_TOP, x, STAFF_TOP + 4 * SP, 1);
const notesOf = (score: { tracks: Array<{ notes: Array<{ midi: number; startQn: number; durationQn: number }> }> }, track = 0) =>
  score.tracks[track].notes.map((n) => [n.midi, n.startQn, n.durationQn]);

describe('ties versus slurs', () => {
  it('does not merge a slur whose ends sit on the same pitch', () => {
    // G4 A4 B4 G4 quarters under one flat slur ending 0.6 sp above the first and last heads.
    const g4 = MIDDLE + SP;
    const glyphs = [trebleClef(), ...fourFour(), head(100, g4), head(150, MIDDLE + 0.5 * SP), head(200, MIDDLE), head(250, g4)];
    const paths = [...staffPaths(), ...[100, 150, 200, 250].map((x) => stemUp(x, x === 100 || x === 250 ? g4 : x === 150 ? MIDDLE + 0.5 * SP : MIDDLE)), arc(100, 250, g4 - 0.6 * SP, 1.0 * SP), barline(360)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'slur.pdf' });
    expect(notesOf(score)).toEqual([
      [67, 0, 1],
      [69, 1, 1],
      [71, 2, 1],
      [67, 3, 1],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('merges a real tie between neighbouring heads, also across a barline', () => {
    const glyphs = [trebleClef(), ...fourFour(), head(100, MIDDLE, 's1'), head(200, MIDDLE, 's1'), head(290, MIDDLE, 's0'), head(430, MIDDLE - SP, 's0')];
    const paths = [
      ...staffPaths(30, 500),
      stemUp(100, MIDDLE),
      stemUp(200, MIDDLE),
      arc(100, 200, MIDDLE - 0.6 * SP, 0.8 * SP),
      barline(260),
      arc(290, 430, MIDDLE - 0.6 * SP, 1.2 * SP),
      barline(400),
      barline(500),
    ];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'tie.pdf' });
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [71, 4, 4],
      [74, 8, 4],
    ]);
  });

  it('keeps a tie whose span is crossed only by the other voice', () => {
    // Voice 1 (stems up): B4 half tied to B4 half. Voice 2 (stems down): four D4 quarters.
    const d4 = MIDDLE + 2.5 * SP;
    const glyphs = [
      trebleClef(),
      ...fourFour(),
      head(100, MIDDLE, 's1'),
      head(200, MIDDLE, 's1'),
      head(100, d4),
      head(125, d4),
      head(150, d4),
      head(175, d4),
    ];
    const paths = [...staffPaths(), stemUp(100, MIDDLE), stemUp(200, MIDDLE), ...[100, 125, 150, 175].map((x) => stemDown(x, d4)), arc(100, 200, MIDDLE - 0.6 * SP, 0.8 * SP), barline(360)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'tie2.pdf' });
    expect(notesOf(score)).toEqual([
      [62, 0, 1],
      [71, 0, 4],
      [62, 1, 1],
      [62, 2, 1],
      [62, 3, 1],
    ]);
  });
});

describe('clef changes', () => {
  it('carries a mid-system clef change into the following measures', () => {
    const glyphs = [
      trebleClef(),
      ...fourFour(),
      head(100, MIDDLE, 's0'), // B4 whole
      glyph('clefs.F_change', 126, MIDDLE - SP, 0.67, 0.8 * EM),
      head(170, MIDDLE, 's0'), // D3 in bass clef
      head(290, MIDDLE, 's0'), // still bass clef
    ];
    const paths = [...staffPaths(), barline(120), barline(240), barline(360)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'clef.pdf' });
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [50, 4, 4],
      [50, 8, 4],
    ]);
    expect(score.tracks[0].clef).toBe('treble');
    expect(score.warnings).toEqual([]);
  });
});

describe('staff lines drawn in pieces', () => {
  it('merges collinear staff-line segments into one staff', () => {
    const split = [0, 1, 2, 3, 4].flatMap((i) => [
      stroke(30, STAFF_TOP + i * SP, 200, STAFF_TOP + i * SP, 0.5),
      stroke(200.6, STAFF_TOP + i * SP, 360, STAFF_TOP + i * SP, 0.5),
    ]);
    const glyphs = [trebleClef(), ...fourFour(), head(120, MIDDLE, 's0'), head(280, MIDDLE - SP, 's0')];
    const { score, debug } = analyze([page(glyphs, [...split, barline(200.3), barline(360)])], { fileName: 'split.pdf' });
    expect(debug.staves).toHaveLength(1);
    expect(debug.staves[0].x1).toBe(30);
    expect(debug.staves[0].x2).toBe(360);
    expect(score.tracks).toHaveLength(1);
    expect(score.measures).toHaveLength(2);
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [74, 4, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });
});

describe('accidentals that are not key signatures', () => {
  it('ignores a small accidental floating above a note and warns instead of changing the key', () => {
    const c5 = MIDDLE - 0.5 * SP;
    const glyphs = [trebleClef(), ...fourFour(), head(150, c5, 's0'), glyph('accidentals.sharp', 148, c5 - 3.5 * SP, 0.275, 0.6 * EM)];
    const { score } = analyze([page(glyphs, [...staffPaths(), barline(360)])], { fileName: 'trill.pdf' });
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 0 }]);
    expect(notesOf(score)).toEqual([[72, 0, 4]]);
    expect(score.warnings).toEqual(['Measure 1, staff 1: an accidental not attached to any note was ignored.']);
  });

  it('does not read a full-size note accidental at the start of a bar as a key change', () => {
    const glyphs = [trebleClef(), ...fourFour(), head(100, MIDDLE, 's0'), glyph('accidentals.sharp', 128, STAFF_TOP, 0.275), head(140, STAFF_TOP, 's0'), head(290, STAFF_TOP, 's0')];
    const { score } = analyze([page(glyphs, [...staffPaths(), barline(120), barline(240), barline(360)])], { fileName: 'acc.pdf' });
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 0 }]);
    expect(notesOf(score)).toEqual([
      [71, 0, 4],
      [78, 4, 4],
      [77, 8, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('reads a key signature even when the first note sits on its step right after it', () => {
    const glyphs = [trebleClef(), glyph('accidentals.sharp', 52, STAFF_TOP, 0.275), head(80, STAFF_TOP, 's0')];
    const { score } = analyze([page(glyphs, [...staffPaths(), barline(360)])], { fileName: 'key.pdf' });
    expect(score.keySignatures).toEqual([{ measure: 0, fifths: 1 }]);
    expect(notesOf(score)).toEqual([[78, 0, 4]]);
  });

  it('applies a key change printed after a barline to the rest of the piece', () => {
    const c5 = MIDDLE - 0.5 * SP;
    const glyphs = [
      trebleClef(),
      ...fourFour(),
      head(100, c5, 's0'),
      glyph('accidentals.sharp', 124, STAFF_TOP, 0.275),
      glyph('accidentals.sharp', 131, c5, 0.275),
      head(180, STAFF_TOP, 's0'),
      head(290, c5, 's0'),
    ];
    const { score } = analyze([page(glyphs, [...staffPaths(), barline(120), barline(240), barline(360)])], { fileName: 'keychange.pdf' });
    expect(score.keySignatures).toEqual([
      { measure: 0, fifths: 0 },
      { measure: 1, fifths: 2 },
    ]);
    expect(notesOf(score)).toEqual([
      [72, 0, 4],
      [78, 4, 4],
      [73, 8, 4],
    ]);
    expect(score.warnings).toEqual([]);
  });
});

describe('fonts', () => {
  it('names an unsupported legacy music font instead of calling the PDF scanned', () => {
    const legacy = (code: number, x: number): GlyphPlacement => ({
      page: 0,
      fontId: 'f9',
      fontName: 'MusiSync',
      family: 'legacy-music',
      code,
      unicode: String.fromCharCode(code),
      x,
      y: MIDDLE,
      advance: 8,
      size: EM,
    });
    const p = page([legacy(38, 40), legacy(113, 100)], [...staffPaths(), barline(360)], { fonts: [{ id: 'f9', name: 'MusiSync', family: 'legacy-music' }] });
    expect(() => analyze([p], { fileName: 'old.pdf' })).toThrow(legacyFontError('old.pdf', 'MusiSync'));
    const scan = page([], [rect(0, 0, 400, 300)], { fonts: [], imageCount: 1 });
    expect(() => analyze([scan], { fileName: 'scan.pdf' })).toThrow(RASTER_ERROR);
  });
});

describe('measures', () => {
  it('accepts a pickup bar without warning', () => {
    const glyphs = [trebleClef(), ...threeFour(), head(90, MIDDLE - SP), head(150, MIDDLE), head(210, MIDDLE), head(270, MIDDLE)];
    const paths = [...staffPaths(), ...[90, 150, 210, 270].map((x) => stemUp(x, x === 90 ? MIDDLE - SP : MIDDLE)), barline(115), barline(360)];
    const { score } = analyze([page(glyphs, paths)], { fileName: 'pickup.pdf' });
    expect(score.measures.map((m) => m.durationQn)).toEqual([1, 3]);
    expect(notesOf(score).map((n) => n[1])).toEqual([0, 1, 2, 3]);
    expect(score.warnings).toEqual([]);
  });

  it('keeps a stemless chord with a displaced second on one onset', () => {
    const c5 = MIDDLE - 0.5 * SP;
    const glyphs = [trebleClef(), ...fourFour(), head(100, c5, 's0'), head(100 + 0.326 * EM, c5 - 0.5 * SP, 's0')];
    const { score, debug } = analyze([page(glyphs, [...staffPaths(), barline(360)])], { fileName: 'second.pdf' });
    expect(notesOf(score)).toEqual([
      [72, 0, 4],
      [74, 0, 4],
    ]);
    expect(debug.measures[0].method).toEqual(['single']);
    expect(score.warnings).toEqual([]);
  });
});

describe('tuplets', () => {
  it('scales a beamed triplet under a small digit centred over the beam', () => {
    const xs = [100, 118, 136];
    const beamTop = MIDDLE - 3.5 * SP;
    const beam = rect(100 + 0.55 * SP, beamTop, 36, 0.45 * SP);
    const glyphs = [
      trebleClef(),
      ...fourFour(),
      ...xs.map((x) => head(x, MIDDLE)),
      glyph('three', 118 + 0.55 * SP - 0.5 * 0.333 * 0.5 * EM, beamTop - 1.2 * SP, 0.333, 0.5 * EM),
      head(200, MIDDLE),
      head(260, MIDDLE),
      head(320, MIDDLE),
    ];
    const paths = [...staffPaths(), ...xs.map((x) => stemUp(x, MIDDLE)), beam, stemUp(200, MIDDLE), stemUp(260, MIDDLE), stemUp(320, MIDDLE), barline(360)];
    const { score, debug } = analyze([page(glyphs, paths)], { fileName: 'triplet.pdf' });
    expect(debug.tuplets).toHaveLength(1);
    expect(debug.tuplets[0]).toMatchObject({ actual: 3, normal: 2 });
    expect(notesOf(score)).toEqual([
      [71, 0, 0.3333],
      [71, 0.3333, 0.3333],
      [71, 0.6667, 0.3333],
      [71, 1, 1],
      [71, 2, 1],
      [71, 3, 1],
    ]);
    expect(score.warnings).toEqual([]);
  });

  it('scales quarter-note triplets under a bracket broken around a text "3"', () => {
    const xs = [100, 140, 180];
    const y = MIDDLE - 5.5 * SP;
    const glyphs = [trebleClef(), ...fourFour(), ...xs.map((x) => head(x, MIDDLE)), head(270, MIDDLE, 's1')];
    const paths = [
      ...staffPaths(),
      ...xs.map((x) => stemUp(x, MIDDLE)),
      stemUp(270, MIDDLE),
      stroke(97, y, 136, y, 0.6),
      stroke(146, y, 185, y, 0.6),
      stroke(97, y, 97, y + 1.2 * SP, 0.6),
      stroke(185, y, 185, y + 1.2 * SP, 0.6),
      barline(360),
    ];
    const { score } = analyze([page(glyphs, paths, { texts: [text('3', 138.5, y + 0.4 * 8)] })], { fileName: 'triplet2.pdf' });
    expect(notesOf(score)).toEqual([
      [71, 0, 0.6667],
      [71, 0.6667, 0.6667],
      [71, 1.3333, 0.6667],
      [71, 2, 2],
    ]);
    expect(score.warnings).toEqual([]);
  });
});

describe('volta brackets', () => {
  it('plays the first ending once and the second ending on the repeat', () => {
    const y = STAFF_TOP - 4 * SP;
    const glyphs = [
      trebleClef(),
      ...threeFour(),
      head(95, MIDDLE, 's1'),
      glyph('dots.dot', 101, MIDDLE - 0.5 * SP, 0.112),
      head(160, MIDDLE - SP, 's1'),
      glyph('dots.dot', 166, MIDDLE - 1.5 * SP, 0.112),
      head(240, MIDDLE + SP, 's1'),
      glyph('dots.dot', 246, MIDDLE + 0.5 * SP, 0.112),
      head(320, MIDDLE + 0.5 * SP, 's1'),
      glyph('dots.dot', 326, MIDDLE + 0.5 * SP, 0.112),
      glyph('dots.dot', 189, MIDDLE - 0.5 * SP, 0.112),
      glyph('dots.dot', 189, MIDDLE + 0.5 * SP, 0.112),
    ];
    const paths = [
      ...staffPaths(),
      ...[95, 160, 240, 320].map((x, i) => stemUp(x, [MIDDLE, MIDDLE - SP, MIDDLE + SP, MIDDLE + 0.5 * SP][i])),
      barline(120),
      stroke(196, STAFF_TOP, 196, STAFF_TOP + 4 * SP, 1),
      stroke(199, STAFF_TOP, 199, STAFF_TOP + 4 * SP, 3),
      barline(280),
      barline(360),
      stroke(120, y, 197, y, 0.5),
      stroke(120, y, 120, y + 2 * SP, 0.5),
      stroke(203, y, 260, y, 0.5),
      stroke(203, y, 203, y + 2 * SP, 0.5),
    ];
    const texts = [text('1.', 122, y + 2 * SP), text('2.', 205, y + 2 * SP)];
    const { score, debug } = analyze([page(glyphs, paths, { texts })], { fileName: 'volta.pdf' });
    expect(debug.voltas.map((v) => v.numbers)).toEqual([[1], [2]]);
    expect(debug.measures.map((m) => m.volta)).toEqual([undefined, [1], [2], undefined]);
    expect(score.measures.map((m) => !!m.repeatEnd)).toEqual([false, true, false, false]);
    expect(score.timeline.map((s) => s.measure)).toEqual([0, 1, 0, 2, 3]);
    expect(score.durationQn).toBe(15);
    expect(notesOf(score)).toEqual([
      [71, 0, 3],
      [74, 3, 3],
      [71, 6, 3],
      [67, 9, 3],
      [69, 12, 3],
    ]);
    expect(score.measures[2].firstStartQn).toBe(9);
    expect(score.warnings).toEqual([]);
  });
});
