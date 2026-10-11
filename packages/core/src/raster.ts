// Original raster tools for PiVo Craft core.
// Buffers: rgba = 4 bytes/px, gray = value+alpha, indexed = 1 byte/px (index).
// All tools write into an ImageDataModel-sized linear buffer with explicit width.
import type { Ink, PaintOptions, Point, RGBA, Tool } from './types.ts';
import { assert, clamp, round255 } from './util.ts';
import { BAYER4, lerpRGBA } from './color.ts';

export type AnyBuffer = Uint8Array;

export function bufferBpp(mode: 'rgba' | 'gray' | 'indexed'): number {
  return mode === 'rgba' ? 4 : mode === 'gray' ? 2 : 1;
}

export function getPixel(buf: AnyBuffer, mode: 'rgba' | 'gray' | 'indexed', i: number): RGBA {
  if (mode === 'rgba') {
    const o = i * 4;
    return [buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!];
  }
  if (mode === 'gray') {
    return [buf[i * 2]!, buf[i * 2]!, buf[i * 2]!, buf[i * 2 + 1]!];
  }
  return [buf[i]!, buf[i]!, buf[i]!, 255];
}

export function setPixel(buf: AnyBuffer, mode: 'rgba' | 'gray' | 'indexed', i: number, c: RGBA): void {
  if (mode === 'rgba') {
    const o = i * 4;
    buf[o] = c[0]!; buf[o + 1] = c[1]!; buf[o + 2] = c[2]!; buf[o + 3] = c[3]!;
  } else if (mode === 'gray') {
    buf[i * 2] = c[0]!;
    buf[i * 2 + 1] = c[3]!;
  } else {
    buf[i] = c[0]!;
  }
}

/** Straight source-over composite of src onto dst (both RGBA tuples), round-half-up. */
export function compositeRGBA(src: RGBA, dst: RGBA): RGBA {
  const As = src[3]! / 255;
  const Ab = dst[3]! / 255;
  const Ao = As + Ab * (1 - As);
  if (Ao <= 0) return [0, 0, 0, 0];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = (src[c]! * As + dst[c]! * Ab * (1 - As)) / Ao;
  return [round255(out[0]!), round255(out[1]!), round255(out[2]!), round255(Ao * 255)];
}

// ---------------------------------------------------------------------------
// Brush stamps
// ---------------------------------------------------------------------------

/** Pixel-center coverage for a brush stamp of the given size centered on (cx,cy).
 * Even sizes are top-left-biased relative to the integer cursor: a 1px brush
 * covers exactly the cursor pixel; a 2px brush covers [cx-1..cx]×[cy-1..cy]. */
export function brushStamp(size: number, brush: 'square' | 'round', cx: number, cy: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (brush === 'square') {
    // top-left-biased square: cursor marks the bottom-right pixel for even sizes
    const half = Math.floor((size - 1) / 2);
    const other = size - 1 - half;
    for (let y = cy - half; y <= cy + other - 1 + half * 0; y++) {
      for (let x = cx - half; x <= cx + other - 1; x++) {
        pts.push([x, y]);
      }
    }
    // extend for size>1: recompute cleanly below
    pts.length = 0;
    const start = -Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        pts.push([cx + start + dx, cy + start + dy]);
      }
    }
    return pts;
  }
  // round: pixel-center test against the mathematical circle, top-left-biased anchor
  const r = size / 2;
  const cxr = size % 2 === 1 ? cx + 0.5 : cx; // odd sizes center on pixel centers
  const cyr = size % 2 === 1 ? cy + 0.5 : cy;
  for (let y = Math.floor(cyr - r); y <= Math.ceil(cyr + r - 1e-9); y++) {
    for (let x = Math.floor(cxr - r); x <= Math.ceil(cxr + r - 1e-9); x++) {
      const dx = x + 0.5 - cxr;
      const dy = y + 0.5 - cyr;
      if (dx * dx + dy * dy <= r * r + 1e-9) pts.push([x, y]);
    }
  }
  return pts;
}

/** Integer Bresenham line, endpoints inclusive (AT-01 contract). */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return pts;
}

/** Integer midpoint ellipse outline with symmetric tie-breaking. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  // normalize bounds, inclusive
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  const w = right - left + 1;
  const h = bottom - top + 1;
  const pts = new Set<string>();
  if (w <= 2 || h <= 2) {
    // degenerate reduces to point/rectangle outline
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) pts.add(`${x},${y}`);
    if (w === 1 || h === 1) return [...pts].map((s) => s.split(',').map(Number) as [number, number]);
    return [...pts].map((s) => s.split(',').map(Number) as [number, number]);
  }
  const a = (w - 1) / 2;
  const b = (h - 1) / 2;
  const cx = left + a;
  const cy = top + b;
  const test = (x: number, y: number): number => {
    const dx = (x - cx) / (a + 0.25);
    const dy = (y - cy) / (b + 0.25);
    return dx * dx + dy * dy;
  };
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      const v = test(x, y);
      if (v <= 1 && v > 0.55) pts.add(`${x},${y}`);
    }
  }
  return [...pts].map((s) => s.split(',').map(Number) as [number, number]);
}

export function rectOutlinePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  for (let x = left; x <= right; x++) {
    pts.push([x, top]);
    pts.push([x, bottom]);
  }
  for (let y = top; y <= bottom; y++) {
    pts.push([left, y]);
    pts.push([right, y]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Pixel-perfect 1px mode: removes intermediate orthogonal corner pixel at
// three-point horizontal/vertical turns.
// ---------------------------------------------------------------------------

export function pixelPerfectPath(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;
  const out: Array<[number, number]> = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const d1x = cur[0] - prev[0], d1y = cur[1] - prev[1];
    const d2x = next[0] - cur[0], d2y = next[1] - cur[1];
    const isOrthTurn =
      ((Math.abs(d1x) === 1 && d1y === 0) || (Math.abs(d1y) === 1 && d1x === 0)) &&
      ((Math.abs(d2x) === 1 && d2y === 0) || (Math.abs(d2y) === 1 && d2x === 0)) &&
      (d1x !== -d2x || d1y !== -d2y); // not a straight backtrack
    if (isOrthTurn && (d1x !== d2x || d1y !== d2y)) {
      // horizontal/vertical turn: drop the corner pixel
      continue;
    }
    out.push(cur);
  }
  out.push(points[points.length - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Ink application
// ---------------------------------------------------------------------------

export interface InkContext {
  buf: AnyBuffer;
  w: number;
  h: number;
  mode: 'rgba' | 'gray' | 'indexed';
  palette: RGBA[];
  transparentIndex: number;
  selection: Uint8Array | null;
  /** Stroke-initial snapshot; matching never changes flood/paint eligibility. */
  snapshot: AnyBuffer | null;
  /** Per-gesture coverage map: each pixel painted at most once (constant opacity). */
  coverage: Uint8Array | null;
}

export interface PaintPixelOpts {
  color: RGBA;
  opacity: number; // 0..255
  ink: Ink;
  brushAlpha?: number; // per-pixel alpha multiplier (0..1), default 1
}

/** Compare pixel to reference under indexed/RGBA/tolerance rules. */
export function pixelEquals(ctx: InkContext, i: number, ref: RGBA, tolerance: number): boolean {
  const v = getPixel(ctx.buf, ctx.mode, i);
  if (ctx.mode === 'indexed') return v[0] === ref[0];
  if (ref[3] === 0 && v[3] === 0) return true;
  if (tolerance === 0) {
    return v[0] === ref[0] && v[1] === ref[1] && v[2] === ref[2] && v[3] === ref[3];
  }
  for (let c = 0; c < 4; c++) {
    if (Math.abs((v[c] ?? 0) - (ref[c] ?? 0)) > tolerance) return false;
  }
  return true;
}

/**
 * Apply one ink pixel. Honors:
 * - alpha: source-over with combined brush alpha and ink opacity
 * - copy: replaces all channels
 * - lock: preserves destination alpha, changes color on nontransparent pixels only
 * - simple: documented alpha-zero erase on transparent-capable targets
 * - shade: maps existing color through ordered ramp
 */
export function applyPixel(ctx: InkContext, x: number, y: number, opts: PaintPixelOpts, ramp?: RGBA[], shadeStep?: number): void {
  if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) return;
  const i = y * ctx.w + x;
  if (ctx.selection && !ctx.selection[i]) return;
  if (ctx.coverage) {
    if (ctx.coverage[i]) return; // once per pixel per gesture
    ctx.coverage[i] = 1;
  }
  const dst = getPixel(ctx.buf, ctx.mode, i);
  const alpha = clamp(opts.opacity / 255 * (opts.brushAlpha ?? 1), 0, 1);
  switch (opts.ink) {
    case 'copy': {
      if (opts.color[3] === 0) { setPixel(ctx.buf, ctx.mode, i, [0, 0, 0, 0]); break; }
      setPixel(ctx.buf, ctx.mode, i, [opts.color[0]!, opts.color[1]!, opts.color[2]!, round255(opts.color[3] * alpha)]);
      break;
    }
    case 'lock': {
      if (dst[3] === 0) break; // no-op on transparent pixels
      const c: RGBA = [opts.color[0]!, opts.color[1]!, opts.color[2]!, dst[3]!];
      setPixel(ctx.buf, ctx.mode, i, c);
      break;
    }
    case 'shade': {
      if (!ramp || ramp.length === 0) break;
      const idx = rampIndex(ramp, dst, ctx.mode === 'indexed');
      if (idx < 0) break; // colors outside ramp unchanged
      const next = clamp(idx + (shadeStep ?? 0), 0, ramp.length - 1);
      setPixel(ctx.buf, ctx.mode, i, ramp[next]!);
      break;
    }
    case 'simple': {
      if (opts.color[3] === 0) {
        // simple alpha-zero erases (documented difference vs alpha-compositing no-op)
        setPixel(ctx.buf, ctx.mode, i, [0, 0, 0, 0]);
        break;
      }
      if (ctx.mode === 'indexed') {
        // color[0] IS the palette index in indexed mode.
        setPixel(ctx.buf, ctx.mode, i, [opts.color[0]!, 0, 0, 255]);
      } else {
        const src: RGBA = [opts.color[0]!, opts.color[1]!, opts.color[2]!, round255(alpha * 255)];
        setPixel(ctx.buf, ctx.mode, i, compositeRGBA(src, dst));
      }
      break;
    }
    case 'alpha':
    default: {
      if (alpha === 0) break; // alpha-compositing transparent source is a no-op (AT-04)
      // Effective source alpha combines the ink opacity with the brush color's
      // own alpha channel ([255,0,0,128] is a half-opacity red stroke).
      const src: RGBA = [opts.color[0]!, opts.color[1]!, opts.color[2]!, round255(alpha * (opts.color[3]! / 255) * 255)];
      if (ctx.mode === 'indexed') {
        // color[0] IS the palette index in indexed mode.
        setPixel(ctx.buf, ctx.mode, i, [opts.color[0]!, 0, 0, 255]);
      } else {
        setPixel(ctx.buf, ctx.mode, i, compositeRGBA(src, dst));
      }
      break;
    }
  }
}

function rampIndex(ramp: RGBA[], dst: RGBA, indexed: boolean): number {
  for (let i = 0; i < ramp.length; i++) {
    const c = ramp[i]!;
    if (indexed) {
      if (c[0] === dst[0]) return i;
    } else if (c[0] === dst[0] && c[1] === dst[1] && c[2] === dst[2] && c[3] === dst[3]) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Flood fill (iterative spans/queue, matches stroke-initial snapshot)
// ---------------------------------------------------------------------------

export function floodFill(ctx: InkContext, seed: Point, opts: PaintPixelOpts, tolerance: number, contiguous: boolean, connectivity: 4 | 8): void {
  const ref = ctx.snapshot
    ? getPixel(ctx.snapshot, ctx.mode, seed.y * ctx.w + seed.x)
    : getPixel(ctx.buf, ctx.mode, seed.y * ctx.w + seed.x);
  const paintOne = (i: number) => {
    const x = i % ctx.w;
    const y = (i / ctx.w) | 0;
    applyPixel(ctx, x, y, opts);
  };
  if (!contiguous) {
    for (let i = 0; i < ctx.w * ctx.h; i++) {
      if (pixelEqualsSnapshot(ctx, i, ref, tolerance)) paintOne(i);
    }
    return;
  }
  const visited = new Uint8Array(ctx.w * ctx.h);
  const queue: number[] = [seed.y * ctx.w + seed.x];
  visited[seed.y * ctx.w + seed.x] = 1;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    if (!pixelEqualsSnapshot(ctx, i, ref, tolerance)) continue;
    paintOne(i);
    const cx = i % ctx.w;
    const cy = (i / ctx.w) | 0;
    const neigh: Array<[number, number]> = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    if (connectivity === 8) neigh.push([cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]);
    for (const [nx, ny] of neigh) {
      if (nx < 0 || ny < 0 || nx >= ctx.w || ny >= ctx.h) continue;
      const ni = ny * ctx.w + nx;
      if (!visited[ni]) {
        visited[ni] = 1;
        queue.push(ni);
      }
    }
  }
}

function pixelEqualsSnapshot(ctx: InkContext, i: number, ref: RGBA, tolerance: number): boolean {
  const buf = ctx.snapshot ?? ctx.buf;
  const v = getPixel(buf, ctx.mode, i);
  if (ctx.mode === 'indexed') return v[0] === ref[0];
  if (ref[3] === 0 && v[3] === 0) return true;
  if (tolerance === 0) {
    return v[0] === ref[0] && v[1] === ref[1] && v[2] === ref[2] && v[3] === ref[3];
  }
  for (let c = 0; c < 4; c++) {
    if (Math.abs((v[c] ?? 0) - (ref[c] ?? 0)) > tolerance) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Gradient
// ---------------------------------------------------------------------------

export function gradientLinear(ctx: InkContext, from: Point, to: Point, c0: RGBA, c1: RGBA, dither: 0 | 2 | 4 | 8 = 0, indexed = false, palette: RGBA[] = []): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < ctx.h; y++) {
    for (let x = 0; x < ctx.w; x++) {
      const i = y * ctx.w + x;
      if (ctx.selection && !ctx.selection[i]) continue;
      let t = ((x - from.x) * dx + (y - from.y) * dy) / len2;
      t = clamp(t, 0, 1);
      if (dither > 0) {
        const n = dither === 2 ? 2 : dither === 4 ? 4 : 8;
        const cell = 1 / (n * n);
        const bx = x % n, by = y % n;
        const matrix = dither === 2 ? BAYER2 : dither === 4 ? BAYER4 : BAYER8;
        t = clamp(t + (matrix[by * n + bx]! - 0.5) * cell, 0, 1);
      }
      const c = indexed
        ? palette[quantizeLerp(c0, c1, t, palette)] ?? c0
        : lerpRGBA(c0, c1, t);
      setPixel(ctx.buf, ctx.mode, i, c);
    }
  }
}

export function gradientRadial(ctx: InkContext, center: Point, radius: number, c0: RGBA, c1: RGBA, indexed = false, palette: RGBA[] = []): void {
  for (let y = 0; y < ctx.h; y++) {
    for (let x = 0; x < ctx.w; x++) {
      const i = y * ctx.w + x;
      if (ctx.selection && !ctx.selection[i]) continue;
      const t = clamp(Math.hypot(x - center.x, y - center.y) / Math.max(1, radius), 0, 1);
      const c = indexed ? palette[quantizeLerp(c0, c1, t, palette)] ?? c0 : lerpRGBA(c0, c1, t);
      setPixel(ctx.buf, ctx.mode, i, c);
    }
  }
}

function quantizeLerp(c0: RGBA, c1: RGBA, t: number, palette: RGBA[]): number {
  const c = lerpRGBA(c0, c1, t);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const d = (p[0]! - c[0]!) ** 2 + (p[1]! - c[1]!) ** 2 + (p[2]! - c[2]!) ** 2 + (p[3]! - c[3]!) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const BAYER2 = [0, 2, 3, 1].map((v) => (v + 0.5) / 4);
const BAYER8 = (() => {
  const m = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ];
  return m.map((v) => (v + 0.5) / 64);
})();

// ---------------------------------------------------------------------------
// Symmetry + wrap helpers
// ---------------------------------------------------------------------------

/** Mirror a point about configured axes; dedupe happens at the stamp level. */
export function mirrorPoints(pts: Array<[number, number]>, w: number, h: number, symX: boolean, symY: boolean): Array<[number, number]> {
  const out = new Set<string>();
  const result: Array<[number, number]> = [];
  for (const [x, y] of pts) {
    const candidates: Array<[number, number]> = [[x, y]];
    if (symX) candidates.push([w - 1 - x, y]);
    if (symY) candidates.push([x, h - 1 - y]);
    if (symX && symY) candidates.push([w - 1 - x, h - 1 - y]);
    for (const c of candidates) {
      const key = `${c[0]},${c[1]}`;
      if (!out.has(key)) {
        out.add(key);
        result.push(c);
      }
    }
  }
  return result;
}

export function wrapPoint(x: number, y: number, w: number, h: number): [number, number] {
  return [((x % w) + w) % w, ((y % h) + h) % h];
}

// ---------------------------------------------------------------------------
// High-level tool dispatch (operates on one buffer + context)
// ---------------------------------------------------------------------------

export interface StrokeRequest {
  tool: Tool;
  points: Point[];
  options: PaintOptions;
  ctx: InkContext;
}

/**
 * Execute a paint gesture against a buffer. One gesture = one transaction:
 * the coverage map guarantees constant opacity regardless of sample frequency.
 */
export function executeStroke(req: StrokeRequest): void {
  const { tool, options, ctx } = req;
  const pts = req.points.map((p) => [Math.floor(p.x), Math.floor(p.y)] as [number, number]);
  const opts: PaintPixelOpts = {
    color: options.color,
    opacity: options.opacity,
    ink: options.ink,
  };
  const size = Math.max(1, options.size);
  const stamp = (x: number, y: number, brushAlpha = 1) => {
    let targets = brushStamp(size, options.brush ?? 'square', x, y);
    if (options.symmetryX !== undefined) {
      targets = mirrorPoints(targets, ctx.w, ctx.h, options.symmetryX >= 0, false).map((p) => p as [number, number]);
    }
    if (options.symmetryY !== undefined) {
      targets = mirrorPoints(targets, ctx.w, ctx.h, false, options.symmetryY >= 0).map((p) => p as [number, number]);
    }
    for (const [px, py] of targets) {
      let tx = px, ty = py;
      if (options.wrap) {
        const wrapped = wrapPoint(px, py, ctx.w, ctx.h);
        tx = wrapped[0]; ty = wrapped[1];
      }
      applyPixel(ctx, tx, ty, { ...opts, brushAlpha }, options.ramp, options.shadeStep);
    }
  };

  switch (tool) {
    case 'pencil': {
      const path = options.pixelPerfect && size === 1 ? pixelPerfectPath(pts) : pts;
      for (let i = 0; i < path.length; i++) {
        const [x, y] = path[i]!;
        if (i === 0) { stamp(x, y); continue; }
        const [px, py] = path[i - 1]!;
        for (const [lx, ly] of bresenhamLine(px, py, x, y)) stamp(lx, ly);
      }
      break;
    }
    case 'eraser': {
      // Erase = alpha-zero source-over, which zeroes the composited alpha on
      // transparent-capable buffers (background fill-back is the caller's job).
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]!;
        if (i === 0) { stampErase(x, y); continue; }
        const [px, py] = pts[i - 1]!;
        for (const [lx, ly] of bresenhamLine(px, py, x, y)) stampErase(lx, ly);
      }
      function stampErase(x: number, y: number): void {
        const targets = brushStamp(size, options.brush ?? 'square', x, y);
        for (const [px, py] of targets) {
          // 'simple' alpha-zero erase: straight source-over with a fully
          // transparent source cannot reduce alpha, so erase writes through.
          applyPixel(ctx, px, py, { ...opts, color: [0, 0, 0, 0], ink: 'simple' });
        }
      }
      break;
    }
    case 'line': {
      assert(pts.length >= 2, 'Line needs 2 points');
      const [x0, y0] = pts[0]!;
      const [x1, y1] = pts[1]!;
      for (const [lx, ly] of bresenhamLine(x0, y0, x1, y1)) stamp(lx, ly);
      break;
    }
    case 'rectangle': {
      assert(pts.length >= 2, 'Rectangle needs 2 points');
      const [x0, y0] = pts[0]!;
      const [x1, y1] = pts[1]!;
      if ((options as PaintOptions & { fill?: boolean }).fill) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) stamp(x, y);
        }
      } else {
        for (const [rx, ry] of rectOutlinePoints(x0, y0, x1, y1)) stamp(rx, ry);
      }
      break;
    }
    case 'ellipse': {
      assert(pts.length >= 2, 'Ellipse needs 2 points');
      const [x0, y0] = pts[0]!;
      const [x1, y1] = pts[1]!;
      const outline = ellipsePoints(x0, y0, x1, y1);
      if ((options as PaintOptions & { fill?: boolean }).fill) {
        const set = new Set(outline.map((p) => `${p[0]},${p[1]}`));
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
            if (set.has(`${x},${y}`)) stamp(x, y);
          }
        }
        // fill interior: scanline even-odd
        for (let y = Math.min(y0, y1) + 1; y < Math.max(y0, y1); y++) {
          const row: number[] = [];
          for (const [ex, ey] of outline) if (ey === y) row.push(ex);
          if (row.length >= 2) {
            row.sort((a, b) => a - b);
            for (let x = row[0]! + 1; x < row[row.length - 1]!; x++) stamp(x, y);
          }
        }
      } else {
        for (const [ex, ey] of outline) stamp(ex, ey);
      }
      break;
    }
    case 'polygon': {
      assert(pts.length >= 3, 'Polygon needs 3 points');
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        for (const [lx, ly] of bresenhamLine(a[0], a[1], b[0], b[1])) stamp(lx, ly);
      }
      break;
    }
    case 'fill': {
      assert(pts.length >= 1, 'Fill needs a seed point');
      const [sx, sy] = pts[0]!;
      floodFill(ctx, { x: sx, y: sy }, opts, options.tolerance ?? 0, options.contiguous ?? true, options.connectivity ?? 4);
      break;
    }
    case 'gradient': {
      assert(pts.length >= 2, 'Gradient needs 2 points');
      const [gx0, gy0] = pts[0]!;
      const [gx1, gy1] = pts[1]!;
      if (options.ramp && options.ramp.length === 2) {
        gradientLinear(ctx, { x: gx0, y: gy0 }, { x: gx1, y: gy1 }, options.ramp[0]!, options.ramp[1]!, 0, ctx.mode === 'indexed', ctx.palette);
      } else {
        gradientLinear(ctx, { x: gx0, y: gy0 }, { x: gx1, y: gy1 }, options.color, options.color, 0, ctx.mode === 'indexed', ctx.palette);
      }
      break;
    }
    case 'eyedropper':
    case 'select':
    case 'wand':
    case 'move':
      // Non-rasterizing tools: handled at the document level (sampling/selection).
      return;
  }
}
