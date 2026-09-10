import type { ClassifiedGlyph, PaintKind, PathShape, Point, Staff, System } from './model';

export interface HLine {
  x1: number;
  x2: number;
  y: number;
  thickness: number;
}

export interface VLine {
  x: number;
  y1: number;
  y2: number;
  thickness: number;
  kind: PaintKind;
}

function axisAlignedRect(points: Point[]): { x: number; y: number; w: number; h: number } | undefined {
  let pts = points;
  if (pts.length === 5) {
    const a = pts[0];
    const b = pts[4];
    if (Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6) return undefined;
    pts = pts.slice(0, 4);
  }
  if (pts.length !== 4) return undefined;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.y - b.y) > 1e-3) return undefined;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Straight horizontal strokes and flat filled rectangles (staff and ledger lines). */
export function horizontalLines(paths: PathShape[]): HLine[] {
  const out: HLine[] = [];
  for (const p of paths) {
    for (const sp of p.subpaths) {
      if (p.kind === 'stroke' && sp.length === 2) {
        const [a, b] = sp;
        if (Math.abs(a.y - b.y) <= 0.35 && Math.abs(a.x - b.x) >= 2) {
          out.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: (a.y + b.y) / 2, thickness: p.lineWidth });
        }
      } else if (p.kind === 'fill') {
        const r = axisAlignedRect(sp);
        if (r && r.h <= 1.6 && r.w >= 8 * r.h && r.w >= 2) {
          out.push({ x1: r.x, x2: r.x + r.w, y: r.y + r.h / 2, thickness: r.h });
        }
      }
    }
  }
  return out;
}

/** Straight vertical strokes and narrow filled rectangles (stems, barlines). */
export function verticalLines(paths: PathShape[]): VLine[] {
  const out: VLine[] = [];
  for (const p of paths) {
    for (const sp of p.subpaths) {
      if (p.kind === 'stroke' && sp.length === 2) {
        const [a, b] = sp;
        if (Math.abs(a.x - b.x) <= 0.35 && Math.abs(a.y - b.y) >= 1) {
          out.push({ x: (a.x + b.x) / 2, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), thickness: p.lineWidth, kind: 'stroke' });
        }
      } else {
        const r = axisAlignedRect(sp);
        if (r && r.w <= 6 && r.h >= 3 * r.w && r.h >= 1) {
          out.push({ x: r.x + r.w / 2, y1: r.y, y2: r.y + r.h, thickness: r.w, kind: p.kind });
        }
      }
    }
  }
  return out;
}

/**
 * Join collinear segments that overlap or nearly touch (staff lines drawn per
 * measure, or split at barlines) into one line; exact duplicates collapse too.
 */
export function mergeCollinear(lines: HLine[], gap = 2): HLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const rows: HLine[][] = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - l.y) < 0.5) row.push(l);
    else rows.push([l]);
  }
  const out: HLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x1 - b.x1);
    let cur = { ...row[0] };
    for (const l of row.slice(1)) {
      if (l.x1 <= cur.x2 + gap) {
        cur.x2 = Math.max(cur.x2, l.x2);
        cur.thickness = Math.max(cur.thickness, l.thickness);
      } else {
        out.push(cur);
        cur = { ...l };
      }
    }
    out.push(cur);
  }
  return out;
}

/** Axis-aligned pieces of short stroked polylines (brackets drawn as one path), as horizontal and vertical lines. */
export function polylineSegments(paths: PathShape[], maxPoints = 6): { horizontal: HLine[]; vertical: VLine[] } {
  const horizontal: HLine[] = [];
  const vertical: VLine[] = [];
  for (const p of paths) {
    if (p.kind !== 'stroke' || p.hasCurves) continue;
    for (const sp of p.subpaths) {
      if (sp.length < 3 || sp.length > maxPoints) continue;
      for (let i = 1; i < sp.length; i++) {
        const a = sp[i - 1];
        const b = sp[i];
        if (Math.abs(a.y - b.y) <= 0.35 && Math.abs(a.x - b.x) >= 1) {
          horizontal.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: (a.y + b.y) / 2, thickness: p.lineWidth });
        } else if (Math.abs(a.x - b.x) <= 0.35 && Math.abs(a.y - b.y) >= 1) {
          vertical.push({ x: (a.x + b.x) / 2, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), thickness: p.lineWidth, kind: 'stroke' });
        }
      }
    }
  }
  return { horizontal, vertical };
}

/** Five equidistant horizontal lines with the same horizontal extent form a staff. */
export function detectStaves(paths: PathShape[], page: number): Staff[] {
  const lines = mergeCollinear(horizontalLines(paths)).filter((l) => l.x2 - l.x1 >= 40);
  const used = new Set<number>();
  const staves: Staff[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const top = lines[i];
    const run: number[] = [i];
    for (let j = i + 1; j < lines.length && run.length < 5; j++) {
      if (used.has(j)) continue;
      const l = lines[j];
      if (Math.abs(l.x1 - top.x1) <= 2.5 && Math.abs(l.x2 - top.x2) <= 2.5 && l.y > lines[run[run.length - 1]].y + 0.5) {
        run.push(j);
      }
    }
    if (run.length < 5) continue;
    const ys = run.map((k) => lines[k].y);
    const gaps = ys.slice(1).map((y, k) => y - ys[k]);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (mean < 2.5 || mean > 20 || gaps.some((g) => Math.abs(g - mean) > 0.2 * mean)) continue;
    for (const k of run) used.add(k);
    staves.push({
      page,
      lines: ys,
      top: ys[0],
      bottom: ys[4],
      x1: Math.min(...run.map((k) => lines[k].x1)),
      x2: Math.max(...run.map((k) => lines[k].x2)),
      space: mean,
      index: 0,
      system: -1,
    });
  }
  return staves.sort((a, b) => a.top - b.top);
}

function connected(upper: Staff, lower: Staff, verticals: VLine[]): boolean {
  const sp = Math.max(upper.space, lower.space);
  return verticals.some(
    (v) =>
      v.x >= Math.min(upper.x1, lower.x1) - 4 * sp &&
      v.x <= Math.max(upper.x2, lower.x2) + sp &&
      v.y1 <= upper.bottom + 0.75 * sp &&
      v.y2 >= lower.top - 0.75 * sp,
  );
}

/** Group a page's staves into systems joined by a barline or system line spanning them. */
export function groupSystems(staves: Staff[], verticals: VLine[], page: number, firstIndex: number): System[] {
  const systems: System[] = [];
  let current: Staff[] = [];
  const flush = (): void => {
    if (!current.length) return;
    const index = firstIndex + systems.length;
    current.forEach((s, i) => {
      s.index = i;
      s.system = index;
    });
    systems.push({
      index,
      page,
      staves: current,
      top: Math.min(...current.map((s) => s.top)),
      bottom: Math.max(...current.map((s) => s.bottom)),
      x1: Math.min(...current.map((s) => s.x1)),
      x2: Math.max(...current.map((s) => s.x2)),
    });
    current = [];
  };
  for (const staff of staves) {
    const prev = current[current.length - 1];
    if (prev && !connected(prev, staff, verticals)) flush();
    current.push(staff);
  }
  flush();
  return systems;
}

export interface BarlineGroup {
  xMin: number;
  xMax: number;
  x: number;
  thick: boolean;
  dotsLeft: boolean;
  dotsRight: boolean;
  staffHits: number;
}

export interface MeasureRegion {
  x1: number;
  x2: number;
  repeatStart: boolean;
  repeatEnd: boolean;
  /** Barline group closing the region, if any. */
  closing?: BarlineGroup;
}

export function glyphCenterX(g: ClassifiedGlyph): number {
  return g.x + g.advance / 2;
}

function attachedToHead(v: VLine, heads: ClassifiedGlyph[], space: number): boolean {
  return heads.some(
    (h) =>
      Math.abs(glyphCenterX(h) - v.x) <= 1.0 * space && h.y >= v.y1 - 0.75 * space && h.y <= v.y2 + 0.75 * space,
  );
}

/**
 * Barlines are vertical lines spanning a whole staff with no notehead
 * attached. Lines within about a staff space of each other form one group
 * (double, final and repeat barlines).
 */
export function detectBarlines(
  system: System,
  verticals: VLine[],
  heads: ClassifiedGlyph[],
  dots: ClassifiedGlyph[],
  barlineGlyphs: ClassifiedGlyph[],
): BarlineGroup[] {
  interface Hit {
    x: number;
    thick: boolean;
    staff: number;
    width: number;
  }
  const hits: Hit[] = [];
  for (const staff of system.staves) {
    const sp = staff.space;
    const staffHeads = heads.filter((h) => h.y >= staff.top - 8 * sp && h.y <= staff.bottom + 8 * sp);
    for (const v of verticals) {
      if (v.x < staff.x1 - 0.5 * sp || v.x > staff.x2 + 0.5 * sp) continue;
      if (v.y1 > staff.top + 0.35 * sp || v.y2 < staff.bottom - 0.35 * sp) continue;
      if (attachedToHead(v, staffHeads, sp)) continue;
      hits.push({ x: v.x, thick: v.thickness >= 0.3 * sp, staff: staff.index, width: v.thickness });
    }
    for (const g of barlineGlyphs) {
      if (g.y < staff.top - sp || g.y > staff.bottom + sp || g.x < staff.x1 - sp || g.x > staff.x2 + sp) continue;
      const kind = g.music.barline;
      hits.push({ x: glyphCenterX(g), thick: kind !== 'single' && kind !== 'double', staff: staff.index, width: g.advance });
    }
  }
  const sp = system.staves[0].space;
  hits.sort((a, b) => a.x - b.x);
  const groups: BarlineGroup[] = [];
  let members: Hit[] = [];
  const flush = (): void => {
    if (!members.length) return;
    const xMin = Math.min(...members.map((m) => m.x - m.width / 2));
    const xMax = Math.max(...members.map((m) => m.x + m.width / 2));
    groups.push({
      xMin,
      xMax,
      x: (xMin + xMax) / 2,
      thick: members.some((m) => m.thick),
      dotsLeft: false,
      dotsRight: false,
      staffHits: new Set(members.map((m) => m.staff)).size,
    });
    members = [];
  };
  for (const h of hits) {
    const last = members[members.length - 1];
    if (last && h.x - last.x > 1.3 * sp) flush();
    members.push(h);
  }
  flush();

  const needed = Math.ceil(system.staves.length / 2);
  const kept = groups.filter((g) => g.staffHits >= needed);
  for (const g of kept) {
    for (const staff of system.staves) {
      const s = staff.space;
      for (const d of dots) {
        if (d.y < staff.top - 0.2 * s || d.y > staff.bottom + 0.2 * s) continue;
        const cx = glyphCenterX(d);
        const augmentation = heads.some(
          (h) => cx - glyphCenterX(h) > 0 && cx - glyphCenterX(h) <= 2.0 * s && Math.abs(h.y - d.y) <= 0.8 * s,
        );
        if (augmentation) continue;
        if (cx < g.xMin && cx >= g.xMin - 2.2 * s) g.dotsLeft = true;
        if (cx > g.xMax && cx <= g.xMax + 2.2 * s) g.dotsRight = true;
      }
    }
    for (const bg of barlineGlyphs) {
      const cx = glyphCenterX(bg);
      if (cx < g.xMin - 0.1 || cx > g.xMax + 0.1) continue;
      const k = bg.music.barline;
      if (k === 'repeatEnd' || k === 'repeatBoth') g.dotsLeft = true;
      if (k === 'repeatStart' || k === 'repeatBoth') g.dotsRight = true;
    }
  }
  return kept;
}

/** Split a system into measure regions between its barline groups. */
export function measureRegions(system: System, groups: BarlineGroup[]): MeasureRegion[] {
  const sp = system.staves[0].space;
  const boundaries = groups.filter((g) => g.x > system.x1 + 1.0 * sp).sort((a, b) => a.x - b.x);
  const regions: MeasureRegion[] = [];
  let startX = system.x1;
  let startGroup: BarlineGroup | undefined;
  for (const g of boundaries) {
    if (g.x - startX >= 2 * sp) {
      regions.push({
        x1: startX,
        x2: g.xMin,
        repeatStart: !!startGroup?.dotsRight,
        repeatEnd: g.dotsLeft,
        closing: g,
      });
    } else if (regions.length) {
      const last = regions[regions.length - 1];
      last.repeatEnd = last.repeatEnd || g.dotsLeft;
      last.closing = g;
    }
    startX = g.xMax;
    startGroup = g;
  }
  if (system.x2 - startX >= 3 * sp) {
    regions.push({ x1: startX, x2: system.x2, repeatStart: !!startGroup?.dotsRight, repeatEnd: false });
  }
  return regions;
}
