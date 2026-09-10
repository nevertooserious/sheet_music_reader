import type {
  BBox,
  FontFamily,
  FontInfo,
  GlyphPlacement,
  Matrix,
  PageExtraction,
  PaintKind,
  PathShape,
  Point,
  TextRun,
} from './model';

/** The subset of a pdf.js PDFPageProxy + operator list that extraction needs. */
export interface OperatorListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface FontLike {
  name?: string;
  loadedName?: string;
  differences?: ArrayLike<string | undefined> | Record<string, string>;
  defaultEncoding?: ArrayLike<string | undefined>;
  fontMatrix?: ArrayLike<number>;
  isType3Font?: boolean;
  composite?: boolean;
}

export interface PageLike {
  index: number;
  width: number;
  height: number;
  /** Viewport transform (PDF user space → top-left device space at scale 1). */
  transform: ArrayLike<number>;
  opList: OperatorListLike;
  /** The pdf.js OPS table of the build that produced the operator list. */
  ops: Record<string, number>;
  getFont(id: string): FontLike | undefined;
}

interface PdfGlyph {
  originalCharCode?: number;
  unicode?: string;
  width?: number;
  isSpace?: boolean;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Apply `m` first, then `n`. */
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function applyVector(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
}

function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

const SMUFL_FONT = /bravura|leland|mscore|petaluma|gootville|finale(maestro|broadway|ash|jazz)|sebastian|leipzig|musejazz|campania|november|beethoven|dorico|ekmelos|lilyjazz/i;
const LEGACY_MUSIC_FONT = /^(opus|maestro|sonata|jazz|inkpen|petrucci|engraver|golden ?age|reprise|helsinki)/i;

export function classifyFontFamily(name: string): FontFamily {
  if (/emmentaler|feta|parmesan|gonville|lilyjazz/i.test(name)) return 'emmentaler';
  if (/text$/i.test(name) && SMUFL_FONT.test(name)) return 'text';
  if (LEGACY_MUSIC_FONT.test(name)) return 'legacy-music';
  if (SMUFL_FONT.test(name)) return 'smufl';
  return 'text';
}

export function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '');
}

interface GState {
  ctm: Matrix;
  lineWidth: number;
  fontId: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hscale: number;
  leading: number;
  rise: number;
}

function bboxOf(subpaths: Point[][]): BBox {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const sp of subpaths) {
    for (const p of sp) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

/**
 * Walks a page operator list with full graphics/text state tracking and returns
 * every glyph placement, painted path and text run in top-left viewport
 * coordinates at scale 1.
 */
export function extractPage(page: PageLike): PageExtraction {
  const OPS = page.ops;
  const base = Array.from(page.transform) as Matrix;
  const fonts = new Map<string, FontInfo>();
  const glyphs: GlyphPlacement[] = [];
  const paths: PathShape[] = [];
  const texts: TextRun[] = [];
  let imageCount = 0;

  let gs: GState = {
    ctm: base,
    lineWidth: 1,
    fontId: '',
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hscale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let path: Point[][] = [];
  let current: Point[] | null = null;
  let hasCurves = false;
  let currentRun: TextRun | null = null;

  const fontInfo = (id: string): FontInfo => {
    let info = fonts.get(id);
    if (!info) {
      const raw = page.getFont(id);
      const name = stripSubsetPrefix(raw?.name || raw?.loadedName || id);
      info = { id, name, family: classifyFontFamily(name) };
      fonts.set(id, info);
    }
    return info;
  };

  const glyphName = (font: FontLike | undefined, code: number): string | undefined => {
    if (!font) return undefined;
    const diff = font.differences as Record<string, string> | undefined;
    const fromDiff = diff ? diff[code] : undefined;
    if (fromDiff) return fromDiff;
    const enc = font.defaultEncoding;
    return enc ? enc[code] : undefined;
  };

  const flushRun = (): void => {
    if (currentRun && currentRun.text.trim().length > 0) texts.push(currentRun);
    currentRun = null;
  };

  const emitPath = (kind: PaintKind): void => {
    current = null;
    const subpaths = path.filter((sp) => sp.length > 0);
    if (subpaths.length) {
      paths.push({
        page: page.index,
        kind,
        subpaths,
        bbox: bboxOf(subpaths),
        lineWidth: kind === 'stroke' ? gs.lineWidth * scaleOf(gs.ctm) : 0,
        hasCurves,
      });
    }
  };

  const resetPath = (): void => {
    path = [];
    current = null;
    hasCurves = false;
  };

  const dev = (x: number, y: number): Point => apply(gs.ctm, x, y);

  const constructPath = (opcodes: ArrayLike<number>, args: ArrayLike<number>): void => {
    let ai = 0;
    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    const pushCurve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void => {
      hasCurves = true;
      if (!current) {
        current = [dev(cx, cy)];
        path.push(current);
      }
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const mt = 1 - t;
        const x = mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
        const y = mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
        current.push(dev(x, y));
      }
      cx = x3;
      cy = y3;
    };
    for (let i = 0; i < opcodes.length; i++) {
      const op = opcodes[i];
      switch (op) {
        case OPS.moveTo:
          cx = startX = args[ai++];
          cy = startY = args[ai++];
          current = [dev(cx, cy)];
          path.push(current);
          break;
        case OPS.lineTo:
          cx = args[ai++];
          cy = args[ai++];
          if (!current) {
            current = [dev(startX, startY)];
            path.push(current);
          }
          current.push(dev(cx, cy));
          break;
        case OPS.curveTo:
          pushCurve(args[ai], args[ai + 1], args[ai + 2], args[ai + 3], args[ai + 4], args[ai + 5]);
          ai += 6;
          break;
        case OPS.curveTo2:
          pushCurve(cx, cy, args[ai], args[ai + 1], args[ai + 2], args[ai + 3]);
          ai += 4;
          break;
        case OPS.curveTo3:
          pushCurve(args[ai], args[ai + 1], args[ai + 2], args[ai + 3], args[ai + 2], args[ai + 3]);
          ai += 4;
          break;
        case OPS.closePath:
          if (current && current.length) {
            current.push(dev(startX, startY));
            cx = startX;
            cy = startY;
          }
          current = null;
          break;
        case OPS.rectangle: {
          const x = args[ai++];
          const y = args[ai++];
          const w = args[ai++];
          const h = args[ai++];
          path.push([dev(x, y), dev(x + w, y), dev(x + w, y + h), dev(x, y + h), dev(x, y)]);
          cx = startX = x;
          cy = startY = y;
          current = null;
          break;
        }
        default:
          break;
      }
    }
  };

  const showText = (items: ArrayLike<PdfGlyph | number>): void => {
    const info = fontInfo(gs.fontId);
    const font = page.getFont(gs.fontId);
    const fontMatrixScale = font?.isType3Font && font.fontMatrix ? font.fontMatrix[0] * 1000 : 1;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item === 'number') {
        const tx = (-item / 1000) * gs.fontSize * gs.hscale;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
        continue;
      }
      const trm = mul(mul([gs.fontSize * gs.hscale, 0, 0, gs.fontSize, 0, gs.rise], tm), gs.ctm);
      const origin = apply(trm, 0, 0);
      const up = applyVector(trm, 0, 1);
      const size = Math.hypot(up.x, up.y);
      const w0 = ((item.width ?? 0) / 1000) * fontMatrixScale;
      const tx = (w0 * gs.fontSize + gs.charSpacing + (item.isSpace ? gs.wordSpacing : 0)) * gs.hscale;
      const advVec = applyVector(mul(tm, gs.ctm), tx, 0);
      const advance = Math.hypot(advVec.x, advVec.y);
      const code = item.originalCharCode ?? 0;
      if (info.family === 'text') {
        const ch = item.isSpace ? ' ' : (item.unicode ?? '');
        if (
          currentRun &&
          (currentRun.fontName !== info.name ||
            Math.abs(currentRun.y - origin.y) > size * 0.25 ||
            origin.x - currentRun.right > size * 1.2 ||
            origin.x < currentRun.right - size * 0.5)
        ) {
          flushRun();
        }
        if (!currentRun) {
          currentRun = { page: page.index, fontName: info.name, text: '', x: origin.x, y: origin.y, size, right: origin.x };
        }
        if (origin.x - currentRun.right > size * 0.2 && !currentRun.text.endsWith(' ') && currentRun.text.length) {
          currentRun.text += ' ';
        }
        currentRun.text += ch;
        currentRun.right = origin.x + advance;
        currentRun.size = Math.max(currentRun.size, size);
      } else {
        glyphs.push({
          page: page.index,
          fontId: gs.fontId,
          fontName: info.name,
          family: info.family,
          code,
          name: glyphName(font, code),
          unicode: item.unicode,
          x: origin.x,
          y: origin.y,
          advance,
          size,
        });
      }
      tm = mul([1, 0, 0, 1, tx, 0], tm);
    }
  };

  const nextLine = (): void => {
    tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
    tm = tlm;
  };

  const { fnArray, argsArray } = page.opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push({ ...gs });
        break;
      case OPS.restore:
        if (stack.length) gs = stack.pop()!;
        break;
      case OPS.transform:
        gs.ctm = mul(args as unknown as Matrix, gs.ctm);
        break;
      case OPS.setLineWidth:
        gs.lineWidth = args![0] as number;
        break;
      case OPS.setGState:
        for (const entry of args![0] as Array<[string, unknown]>) {
          const [key, value] = entry;
          if (key === 'LW') gs.lineWidth = value as number;
          else if (key === 'Font') {
            const [id, size] = value as [string, number];
            gs.fontId = id;
            gs.fontSize = size;
          }
        }
        break;
      case OPS.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case OPS.endText:
        flushRun();
        break;
      case OPS.setFont:
        gs.fontId = args![0] as string;
        gs.fontSize = args![1] as number;
        break;
      case OPS.setCharSpacing:
        gs.charSpacing = args![0] as number;
        break;
      case OPS.setWordSpacing:
        gs.wordSpacing = args![0] as number;
        break;
      case OPS.setHScale:
        gs.hscale = (args![0] as number) / 100;
        break;
      case OPS.setLeading:
        gs.leading = args![0] as number;
        break;
      case OPS.setTextRise:
        gs.rise = args![0] as number;
        break;
      case OPS.setTextMatrix:
        tm = args as unknown as Matrix;
        tlm = tm;
        break;
      case OPS.moveText:
        tlm = mul([1, 0, 0, 1, args![0] as number, args![1] as number], tlm);
        tm = tlm;
        break;
      case OPS.setLeadingMoveText:
        gs.leading = -(args![1] as number);
        tlm = mul([1, 0, 0, 1, args![0] as number, args![1] as number], tlm);
        tm = tlm;
        break;
      case OPS.nextLine:
        nextLine();
        break;
      case OPS.showText:
        showText(args![0] as ArrayLike<PdfGlyph | number>);
        break;
      case OPS.showSpacedText:
        showText(args![0] as ArrayLike<PdfGlyph | number>);
        break;
      case OPS.nextLineShowText:
        nextLine();
        showText(args![0] as ArrayLike<PdfGlyph | number>);
        break;
      case OPS.nextLineSetSpacingShowText:
        gs.wordSpacing = args![0] as number;
        gs.charSpacing = args![1] as number;
        nextLine();
        showText(args![2] as ArrayLike<PdfGlyph | number>);
        break;
      case OPS.constructPath:
        constructPath(args![0] as ArrayLike<number>, args![1] as ArrayLike<number>);
        break;
      case OPS.stroke:
      case OPS.closeStroke:
        emitPath('stroke');
        resetPath();
        break;
      case OPS.fill:
      case OPS.eoFill:
        emitPath('fill');
        resetPath();
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        emitPath('fill');
        emitPath('stroke');
        resetPath();
        break;
      case OPS.endPath:
        resetPath();
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...gs });
        const m = args![0] as Matrix | null;
        if (m) gs.ctm = mul(m, gs.ctm);
        break;
      }
      case OPS.paintFormXObjectEnd:
        if (stack.length) gs = stack.pop()!;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat:
      case OPS.paintImageMaskXObjectGroup:
      case OPS.paintImageMaskXObjectRepeat:
      case OPS.paintInlineImageXObjectGroup:
      case OPS.paintSolidColorImageMask:
        imageCount++;
        break;
      default:
        break;
    }
  }
  flushRun();

  return {
    index: page.index,
    width: page.width,
    height: page.height,
    fonts: [...fonts.values()],
    glyphs,
    paths,
    texts,
    imageCount,
  };
}
