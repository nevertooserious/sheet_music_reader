import type { ClefKind, LayoutBox, NoteEvent, PageInfo, ScoreModel } from '../core/types';

/**
 * Plausible stand-in for the parser's page renderer: staff lines, clefs, key
 * and time signatures, barlines and noteheads derived from the score's own
 * layout boxes. Only used by the ui showcase until the parsing module exists.
 */

const STAFF_LINE_GAP = 8;
const STAFF_TOP_INSET = 4;
const LETTER_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

function diatonicStep(midi: number): number {
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + LETTER_INDEX[((midi % 12) + 12) % 12];
}

function middleLineStep(clef: ClefKind): number {
  switch (clef) {
    case 'bass':
      return diatonicStep(50);
    case 'alto':
      return diatonicStep(60);
    case 'tenor':
      return diatonicStep(57);
    default:
      return diatonicStep(71);
  }
}

export function staffMiddleY(box: LayoutBox): number {
  return box.y + STAFF_TOP_INSET + STAFF_LINE_GAP * 2;
}

/** Vertical position of a notehead for a pitch on a staff box, in PDF points. */
export function noteStaffY(midi: number, clef: ClefKind, box: LayoutBox): number {
  const steps = diatonicStep(midi) - middleLineStep(clef);
  return staffMiddleY(box) - steps * (STAFF_LINE_GAP / 2);
}

let musicGlyphs: boolean | undefined;

/** Whether a system font supplies the Unicode musical symbols; otherwise clefs are drawn as paths. */
function hasMusicGlyphs(ctx: CanvasRenderingContext2D): boolean {
  if (musicGlyphs === undefined) {
    const font = ctx.font;
    ctx.font = '40px serif';
    const clef = ctx.measureText('\u{1D11E}').width;
    const unassigned = ctx.measureText('\u{1D1FF}').width;
    ctx.font = font;
    musicGlyphs = clef > 0 && Math.abs(clef - unassigned) > 0.5;
  }
  return musicGlyphs;
}

interface DrawnNote {
  note: NoteEvent;
  x: number;
  y: number;
  box: LayoutBox;
}

export function drawMockPage(
  canvas: HTMLCanvasElement,
  score: ScoreModel,
  page: PageInfo,
  scale: number,
): void {
  const width = Math.max(1, Math.round(page.width * scale));
  const height = Math.max(1, Math.round(page.height * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, page.width, page.height);

  const ink = '#1c1a17';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textBaseline = 'alphabetic';

  const measures = score.measures.filter((m) => m.layout.some((b) => b.page === page.index));
  if (page.index === 0) {
    ctx.textAlign = 'center';
    ctx.font = '600 22px Georgia, "Times New Roman", serif';
    ctx.fillText((score.title ?? 'Untitled').replace(/\s*\(.*\)\s*$/, ''), page.width / 2, 64);
    ctx.font = 'italic 11px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'right';
    if (score.composer) ctx.fillText(score.composer, page.width - 60, 92);
    ctx.textAlign = 'left';
    ctx.fillText('Allegretto', 60, 92);
  }

  const systems = new Map<number, typeof measures>();
  for (const m of measures) {
    const key = Math.round(m.layout[0].y);
    const list = systems.get(key) ?? [];
    list.push(m);
    systems.set(key, list);
  }

  const clefs = score.tracks.map((t) => t.clef);
  const fifths = score.keySignatures[0]?.fifths ?? 0;
  const keyCount = Math.min(7, Math.abs(fifths));
  let firstSystem = true;
  for (const [, systemMeasures] of [...systems.entries()].sort((a, b) => a[0] - b[0])) {
    systemMeasures.sort((a, b) => a.layout[0].x - b.layout[0].x);
    const first = systemMeasures[0];
    const last = systemMeasures[systemMeasures.length - 1];
    const staves = first.layout.filter((b) => b.page === page.index);
    const left = first.layout[0].x;
    const right = last.layout[0].x + last.layout[0].width;
    const top = staves[0].y + STAFF_TOP_INSET;
    const bottom = staves[staves.length - 1].y + STAFF_TOP_INSET + STAFF_LINE_GAP * 4;
    // Clef, key and time live in an indent left of the first measure box, as in real engraving.
    const indent = Math.min(left - 10, 42 + 6 * keyCount);
    const staffStart = left - indent;

    ctx.lineWidth = 0.7;
    for (const box of staves) {
      for (let i = 0; i < 5; i++) {
        const y = box.y + STAFF_TOP_INSET + i * STAFF_LINE_GAP;
        line(ctx, staffStart, y, right, y);
      }
    }

    ctx.lineWidth = 1;
    line(ctx, staffStart, top, staffStart, bottom);
    if (staves.length > 2) drawBracket(ctx, staffStart - 5, top, bottom);
    else drawBrace(ctx, staffStart - 6, top, bottom);

    staves.forEach((box, i) => {
      const clef = clefs[i] ?? 'treble';
      drawClef(ctx, clef, staffStart + 3, box);
      drawKeySignature(ctx, fifths, clef, staffStart + 27, box);
      if (firstSystem && page.index === 0) drawTimeSignature(ctx, score.timeSignatures[0], staffStart + 27 + 6 * keyCount + 9, box);
    });

    ctx.lineWidth = 0.9;
    for (const m of systemMeasures) {
      const x = m.layout[0].x + m.layout[0].width;
      if (m.repeatEnd) drawRepeat(ctx, x, top, bottom, staves, 'end');
      else line(ctx, x, top, x, bottom);
      // A repeat sign at the very start of a piece is conventionally not printed.
      if (m.repeatStart && m.index > 0) drawRepeat(ctx, m.layout[0].x, top, bottom, staves, 'start');
    }

    ctx.font = 'italic 9px Georgia, serif';
    ctx.textAlign = 'left';
    if (!firstSystem || page.index > 0) ctx.fillText(String(first.index + 1), staffStart + 2, top - 6);
    firstSystem = false;
  }

  const seen = new Set<string>();
  const drawn: DrawnNote[] = [];
  score.tracks.forEach((track, staffIndex) => {
    for (const note of track.notes) {
      if (!note.layout || note.layout.page !== page.index) continue;
      const measure = score.measures[note.measure];
      const box = measure?.layout[staffIndex];
      if (!box) continue;
      const key = `${track.id}:${note.midi}:${note.layout.x.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drawn.push({ note, x: note.layout.x, y: note.layout.y, box });
    }
  });

  const groups = new Map<string, DrawnNote[]>();
  for (const d of drawn) {
    const key = `${d.note.trackId}:${d.x.toFixed(1)}:${d.note.startQn.toFixed(3)}`;
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  for (const group of groups.values()) drawChord(ctx, group);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawBrace(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  const mid = (top + bottom) / 2;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x - 7, top + 10, x - 1, mid - 10, x - 7, mid);
  ctx.bezierCurveTo(x - 1, mid + 10, x - 7, bottom - 10, x, bottom);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawBracket(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  ctx.lineWidth = 3;
  line(ctx, x, top - 2, x, bottom + 2);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 1.5, top - 2);
  ctx.quadraticCurveTo(x + 4, top - 4, x + 7, top - 9);
  ctx.moveTo(x - 1.5, bottom + 2);
  ctx.quadraticCurveTo(x + 4, bottom + 4, x + 7, bottom + 9);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawClef(ctx: CanvasRenderingContext2D, clef: ClefKind, x: number, box: LayoutBox): void {
  const top = box.y + STAFF_TOP_INSET;
  if (hasMusicGlyphs(ctx)) {
    ctx.font = `${STAFF_LINE_GAP * 5.6}px serif`;
    ctx.textAlign = 'left';
    if (clef === 'bass') ctx.fillText('\u{1D122}', x, top + STAFF_LINE_GAP * 2);
    else if (clef === 'alto' || clef === 'tenor') ctx.fillText('\u{1D121}', x, top + STAFF_LINE_GAP * 2);
    else ctx.fillText('\u{1D11E}', x, top + STAFF_LINE_GAP * 3);
    return;
  }
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  if (clef === 'bass') {
    const y = top + STAFF_LINE_GAP;
    ctx.beginPath();
    ctx.arc(x + 4, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.bezierCurveTo(x + 4, y - 9, x + 14, y - 7, x + 14, y + 1);
    ctx.bezierCurveTo(x + 14, y + 9, x + 8, y + 16, x + 1, y + 21);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 18, y - 3, 1.3, 0, Math.PI * 2);
    ctx.arc(x + 18, y + 5, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const y = top + STAFF_LINE_GAP * 3;
    ctx.beginPath();
    ctx.moveTo(x + 9, y - 30);
    ctx.bezierCurveTo(x + 16, y - 22, x + 15, y - 14, x + 8, y - 6);
    ctx.bezierCurveTo(x - 1, y + 4, x + 3, y + 12, x + 10, y + 10);
    ctx.bezierCurveTo(x + 16, y + 8, x + 16, y - 1, x + 9, y - 1);
    ctx.bezierCurveTo(x + 3, y - 1, x + 3, y + 7, x + 9, y + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 9, y - 30);
    ctx.lineTo(x + 12, y + 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 10, y + 19, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
}

function drawKeySignature(
  ctx: CanvasRenderingContext2D,
  fifths: number,
  clef: ClefKind,
  x: number,
  box: LayoutBox,
): void {
  if (fifths === 0) return;
  const sharpsTreble = [77, 72, 79, 74, 69, 76, 71];
  const sharpsBass = [53, 48, 55, 50, 45, 52, 47];
  const flatsTreble = [71, 76, 69, 74, 67, 72, 65];
  const flatsBass = [47, 52, 45, 50, 43, 48, 41];
  const count = Math.min(7, Math.abs(fifths));
  const pitches = fifths > 0 ? (clef === 'bass' ? sharpsBass : sharpsTreble) : clef === 'bass' ? flatsBass : flatsTreble;
  const glyphs = hasMusicGlyphs(ctx);
  if (glyphs) {
    ctx.font = `${STAFF_LINE_GAP * 3.4}px serif`;
    ctx.textAlign = 'center';
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const y = noteStaffY(pitches[i], clef, box);
    const ax = x + i * 6;
    if (glyphs) {
      ctx.fillText(fifths > 0 ? '\u266F' : '\u266D', ax, y + (fifths > 0 ? STAFF_LINE_GAP * 0.7 : STAFF_LINE_GAP * 0.2));
      continue;
    }
    if (fifths > 0) {
      line(ctx, ax - 1.5, y - 5, ax - 1.5, y + 5);
      line(ctx, ax + 1.5, y - 6, ax + 1.5, y + 4);
      ctx.lineWidth = 1.6;
      line(ctx, ax - 3.5, y - 1, ax + 3.5, y - 3);
      line(ctx, ax - 3.5, y + 3, ax + 3.5, y + 1);
      ctx.lineWidth = 1;
    } else {
      line(ctx, ax - 2, y - 9, ax - 2, y + 3);
      ctx.beginPath();
      ctx.moveTo(ax - 2, y - 2);
      ctx.bezierCurveTo(ax + 4, y - 4, ax + 4, y + 1, ax - 2, y + 3);
      ctx.stroke();
    }
  }
  ctx.textAlign = 'left';
}

function drawTimeSignature(
  ctx: CanvasRenderingContext2D,
  sig: ScoreModel['timeSignatures'][number] | undefined,
  x: number,
  box: LayoutBox,
): void {
  if (!sig) return;
  const top = box.y + STAFF_TOP_INSET;
  ctx.font = 'bold 15px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(sig.beats), x, top + STAFF_LINE_GAP * 2 - 1);
  ctx.fillText(String(sig.beatType), x, top + STAFF_LINE_GAP * 4 - 1);
  ctx.textAlign = 'left';
}

function drawRepeat(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  staves: LayoutBox[],
  kind: 'start' | 'end',
): void {
  const dir = kind === 'start' ? 1 : -1;
  ctx.lineWidth = 2.6;
  line(ctx, x, top, x, bottom);
  ctx.lineWidth = 0.9;
  line(ctx, x + dir * 4, top, x + dir * 4, bottom);
  for (const box of staves) {
    const staffTop = box.y + STAFF_TOP_INSET;
    ctx.beginPath();
    ctx.arc(x + dir * 8, staffTop + STAFF_LINE_GAP * 1.5, 1.3, 0, Math.PI * 2);
    ctx.arc(x + dir * 8, staffTop + STAFF_LINE_GAP * 2.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawChord(ctx: CanvasRenderingContext2D, group: DrawnNote[]): void {
  group.sort((a, b) => a.y - b.y);
  const { box, x } = group[0];
  const duration = group[0].note.durationQn;
  const staffTop = box.y + STAFF_TOP_INSET;
  const staffBottom = staffTop + STAFF_LINE_GAP * 4;
  const middle = staffMiddleY(box);
  const filled = duration < 2;
  const hasStem = duration < 4;

  ctx.lineWidth = 0.8;
  for (const d of group) {
    if (d.y < staffTop - 1) {
      for (let y = staffTop - STAFF_LINE_GAP; y >= d.y - 1; y -= STAFF_LINE_GAP) line(ctx, d.x - 7, y, d.x + 7, y);
    } else if (d.y > staffBottom + 1) {
      for (let y = staffBottom + STAFF_LINE_GAP; y <= d.y + 1; y += STAFF_LINE_GAP) line(ctx, d.x - 7, y, d.x + 7, y);
    }
  }

  for (const d of group) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.7, 3.3, 0, 0, Math.PI * 2);
    ctx.restore();
    if (filled) ctx.fill();
    else {
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.lineWidth = 0.8;
    }
  }

  if (!hasStem) return;
  const avgY = group.reduce((s, d) => s + d.y, 0) / group.length;
  const up = avgY >= middle;
  const stemX = up ? x + 4.2 : x - 4.2;
  const stemStart = up ? group[group.length - 1].y : group[0].y;
  const stemEnd = up ? group[0].y - 27 : group[group.length - 1].y + 27;
  ctx.lineWidth = 1.1;
  line(ctx, stemX, stemStart, stemX, stemEnd);

  if (duration < 1) {
    const flagDir = up ? 1 : -1;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(stemX, stemEnd);
    ctx.bezierCurveTo(stemX + 2, stemEnd + 6 * flagDir, stemX + 9, stemEnd + 8 * flagDir, stemX + 7, stemEnd + 17 * flagDir);
    ctx.stroke();
    ctx.lineWidth = 0.8;
  }
  const dotted = Math.abs(duration - 1.5) < 1e-6 || Math.abs(duration - 3) < 1e-6 || Math.abs(duration - 0.75) < 1e-6;
  if (dotted) {
    for (const d of group) {
      ctx.beginPath();
      ctx.arc(d.x + 8, d.y - 2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
