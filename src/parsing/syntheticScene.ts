import type { GlyphPlacement, PageExtraction, PathShape, Point, TextRun } from './model';

/**
 * A hand-built two-line page in 3/4, G major, with a first ending that runs
 * off the first line and continues (unnumbered) on the second, a tie broken
 * at the line break, a second ending and a beamed triplet. The bundled fixture
 * has plain repeats, no tuplets and no line-crossing ties, so the showcase
 * runs this page through the analyzer to exercise those paths.
 */
export const SYNTHETIC_SPACE = 6;
export const SYNTHETIC_PAGE = { width: 460, height: 340 };

const SP = SYNTHETIC_SPACE;
const EM = 4 * SP;
const TOP1 = 100;
const TOP2 = 235;
const X1 = 30;
const X2 = 430;

function glyph(name: string, x: number, y: number, advanceEm: number, size = EM): GlyphPlacement {
  return { page: 0, fontId: 'syn', fontName: 'Emmentaler-20', family: 'emmentaler', code: 0, name, x, y, advance: advanceEm * size, size };
}

function head(cx: number, y: number, shape: 's2' | 's1' | 's0' = 's2'): GlyphPlacement {
  const advance = 0.326 * EM;
  return glyph(`noteheads.${shape}`, cx - advance / 2, y, 0.326);
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
  const pts: Point[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x, maxX: x + w, minY: y, maxY: y + h }, lineWidth: 0, hasCurves: false };
}

/** Filled tie arc from (x1, y) to (x2, y) bulging upwards. */
function arc(x1: number, x2: number, y: number, height = 0.8 * SP): PathShape {
  const pts: Point[] = [];
  for (let i = 0; i <= 12; i++) pts.push({ x: x1 + (x2 - x1) * (i / 12), y: y - height * Math.sin(Math.PI * (i / 12)) });
  for (let i = 12; i >= 0; i--) pts.push({ x: x1 + (x2 - x1) * (i / 12), y: y - (height - 0.15 * SP) * Math.sin(Math.PI * (i / 12)) });
  return { page: 0, kind: 'fill', subpaths: [pts], bbox: { minX: x1, maxX: x2, minY: y - height, maxY: y }, lineWidth: 0, hasCurves: true };
}

function stem(cx: number, headY: number, topY = headY - 3.5 * SP): PathShape {
  return rect(cx + 0.55 * SP, topY, 0.3, headY - topY);
}

function text(t: string, x: number, y: number, size: number): TextRun {
  return { page: 0, fontName: 'TeXGyreSchola-Regular', text: t, x, y, size, right: x + 0.52 * size * t.length };
}

function staffLines(top: number): PathShape[] {
  return [0, 1, 2, 3, 4].map((i) => stroke(X1, top + i * SP, X2, top + i * SP, 0.5));
}

function prefatory(top: number): GlyphPlacement[] {
  return [glyph('clefs.G', 34, top + 3 * SP, 0.641), glyph('accidentals.sharp', 52, top, 0.275)];
}

function voltaHook(x: number, y: number): PathShape {
  return stroke(x, y, x, y + 2 * SP, 0.5);
}

export function buildSyntheticPage(): PageExtraction {
  const mid1 = TOP1 + 2 * SP;
  const mid2 = TOP2 + 2 * SP;
  const pitch = (mid: number, steps: number): number => mid - steps * 0.5 * SP;
  const volta1Y = TOP1 - 5.5 * SP;
  const volta2Y = TOP2 - 5.5 * SP;

  // Line 1: bar 1 | bar 2 | bar 3 [1. ---> (open at the line end; the last A4 is tied over the break)
  const line1Heads: Array<[number, number, 's2' | 's1']> = [
    [92, pitch(mid1, 0), 's2'],
    [110, pitch(mid1, 2), 's2'],
    [128, pitch(mid1, -2), 's2'],
    [165, pitch(mid1, -1), 's2'],
    [190, pitch(mid1, 0), 's2'],
    [215, pitch(mid1, 1), 's2'],
    [265, pitch(mid1, -2), 's1'],
    [350, pitch(mid1, -1), 's2'],
  ];
  // Line 2: bar 4 (continuation of 1., :|) | bar 5 [2.] triplet + two quarters | bar 6 final
  const beamTop = pitch(mid2, 3) - 3.5 * SP;
  const triplet: Array<[number, number]> = [
    [190, pitch(mid2, 3)],
    [206, pitch(mid2, 2)],
    [222, pitch(mid2, 1)],
  ];
  const line2Heads: Array<[number, number, 's2' | 's1']> = [
    [90, pitch(mid2, -1), 's2'],
    [130, pitch(mid2, 0), 's1'],
    ...triplet.map(([x, y]): [number, number, 's2'] => [x, y, 's2']),
    [255, pitch(mid2, 0), 's2'],
    [285, pitch(mid2, -2), 's2'],
    [330, pitch(mid2, 4), 's2'],
    [363, pitch(mid2, 2), 's2'],
    [396, pitch(mid2, -2), 's2'],
  ];

  const glyphs: GlyphPlacement[] = [
    ...prefatory(TOP1),
    glyph('three', 66, mid1, 0.4),
    glyph('four', 66, TOP1 + 4 * SP, 0.4),
    ...line1Heads.map(([x, y, s]) => head(x, y, s)),
    ...prefatory(TOP2),
    ...line2Heads.map(([x, y, s]) => head(x, y, s)),
    glyph('three', 206 + 0.55 * SP - 0.5 * 0.4 * 0.5 * EM, beamTop - 1.2 * SP, 0.4, 0.5 * EM),
    glyph('dots.dot', 158, mid2 - 0.5 * SP, 0.112),
    glyph('dots.dot', 158, mid2 + 0.5 * SP, 0.112),
  ];
  const paths: PathShape[] = [
    ...staffLines(TOP1),
    ...line1Heads.map(([x, y]) => stem(x, y)),
    stroke(150, TOP1, 150, TOP1 + 4 * SP, 1),
    stroke(235, TOP1, 235, TOP1 + 4 * SP, 1),
    stroke(429, TOP1, 429, TOP1 + 4 * SP, 1),
    arc(356, 428, pitch(mid1, -1) - 0.6 * SP),
    stroke(235, volta1Y, X2, volta1Y, 0.5),
    voltaHook(235, volta1Y),

    ...staffLines(TOP2),
    ...line2Heads.map(([x, y]) => stem(x, y)),
    ...triplet.map(([x, y]) => stem(x, y, beamTop)),
    rect(190 + 0.55 * SP, beamTop, 222 - 190, 0.45 * SP),
    arc(72, 86, pitch(mid2, -1) - 0.6 * SP),
    stroke(167, TOP2, 167, TOP2 + 4 * SP, 1),
    stroke(170, TOP2, 170, TOP2 + 4 * SP, 3),
    stroke(310, TOP2, 310, TOP2 + 4 * SP, 1),
    stroke(424, TOP2, 424, TOP2 + 4 * SP, 1),
    stroke(428, TOP2, 428, TOP2 + 4 * SP, 3),
    // The first ending resumes after the key signature (8 sp in), without a hook or number.
    stroke(78, volta2Y, 166, volta2Y, 0.5),
    stroke(174, volta2Y, 310, volta2Y, 0.5),
    voltaHook(174, volta2Y),
    voltaHook(310, volta2Y),
  ];
  const texts: TextRun[] = [
    text('Synthetic page: endings across a line break, a tie and a triplet', 30, 40, 13),
    text('1.', 237, volta1Y + 2 * SP, 8),
    text('2.', 176, volta2Y + 2 * SP, 8),
  ];
  return {
    index: 0,
    width: SYNTHETIC_PAGE.width,
    height: SYNTHETIC_PAGE.height,
    fonts: [{ id: 'syn', name: 'Emmentaler-20', family: 'emmentaler' }],
    glyphs,
    paths,
    texts,
    imageCount: 0,
  };
}

/** Engrave the synthetic page onto a canvas context whose transform already maps PDF points to pixels. */
export function drawSyntheticPage(ctx: CanvasRenderingContext2D, page: PageExtraction): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  for (const p of page.paths) {
    for (const sub of p.subpaths) {
      ctx.beginPath();
      sub.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      if (p.kind === 'fill') {
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.lineWidth = p.lineWidth;
        ctx.stroke();
      }
    }
  }
  for (const g of page.glyphs) {
    const cx = g.x + g.advance / 2;
    const sp = g.size / 4;
    if (g.name?.startsWith('noteheads.')) {
      ctx.beginPath();
      ctx.ellipse(cx, g.y, 0.62 * sp, 0.45 * sp, -0.35, 0, Math.PI * 2);
      if (g.name.endsWith('s2')) ctx.fill();
      else {
        ctx.lineWidth = g.name.endsWith('s0') ? 1.6 : 1.3;
        ctx.stroke();
      }
    } else if (g.name === 'dots.dot') {
      ctx.beginPath();
      ctx.arc(cx, g.y, 0.2 * sp, 0, Math.PI * 2);
      ctx.fill();
    } else if (g.name === 'clefs.G') {
      ctx.font = `${7 * sp}px serif`;
      ctx.fillText('\u{1D11E}', g.x, g.y + 1.2 * sp);
    } else if (g.name === 'accidentals.sharp') {
      ctx.font = `${2.6 * sp}px serif`;
      ctx.fillText('♯', g.x, g.y + 0.9 * sp);
    } else if (g.name === 'three' || g.name === 'four') {
      ctx.font = `bold ${2.3 * sp}px serif`;
      ctx.fillText(g.name === 'three' ? '3' : '4', g.x, g.y);
    }
  }
  for (const t of page.texts) {
    ctx.font = `${t.text.length > 2 ? '' : 'italic '}${t.size}px serif`;
    ctx.fillText(t.text, t.x, t.y);
  }
}
