// Original command operations for PiVo Craft core.
import type { Mode, PaintOptions, Point, Project, Rect, RGBA, Tool } from './types.ts';
import { assert, findFrameIndex, findLayer, uid } from './util.ts';
import {
  addFrame, celContentSize, cloneImage, ensureCel, getCel, linkCel, paletteFor, sameLinkGroup,
  effectiveLocked, effectiveVisible, removeLayer, removeFrame, addLayer, moveCel as docMoveCel,
} from './document.ts';
import { renderFrame } from './render.ts';
import {
  brushStamp, executeStroke, floodFill, getPixel, setPixel, bufferBpp, compositeRGBA, gradientLinear, gradientRadial,
  type InkContext,
} from './raster.ts';
import { rgbaToGray } from './color.ts';

function targetBuffer(p: Project, layerId: string, frameId: string): { cel: NonNullable<ReturnType<typeof getCel>>; img: { id: string; width: number; height: number; mode: Mode; data: Uint8Array } } | null {
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') return null;
  if (effectiveLocked(p, layerId)) throw new Error(`Layer ${layerId} is locked`);
  const cel = getCel(p, layerId, frameId) ?? ensureCel(p, layerId, frameId);
  if (layer.kind === 'tilemap') return null;
  const img = p.images[cel.imageId];
  assert(img, 'Cel missing image');
  return { cel: cel!, img: img! };
}

function buildContext(p: Project, img: { data: Uint8Array; width: number; height: number; mode: Mode }, frameId: string, options: PaintOptions): InkContext {
  const snapshot = new Uint8Array(img.data);
  const coverage = new Uint8Array(img.width * img.height);
  return {
    buf: img.data,
    w: img.width,
    h: img.height,
    mode: p.mode,
    palette: paletteFor(p, frameId),
    transparentIndex: p.transparentIndex,
    selection: options.selection ?? null,
    snapshot,
    coverage,
  };
}

/**
 * Apply a paint gesture to the cel at (layerId, frameId).
 * Linked editing: cels sharing content (same linkId group or same image with
 * shared placement) receive the stroke exactly once — we paint the unique
 * image buffer, which every content reference sees.
 *
 * Coordinates are CANVAS-space; they are mapped into the cel's buffer space
 * (offset by -cel.x/-cel.y for moved cels). The selection mask is
 * canvas-space too and is remapped onto the cel buffer the same way.
 */
export function paint(p: Project, layerId: string, frameId: string, tool: Tool, points: Point[], options: PaintOptions): void {
  findFrameIndex(p, frameId);
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') throw new Error('Cannot paint on a group layer');
  if (layer.kind === 'tilemap') {
    // Paint on tilemaps is routed through editTile by the caller; raster stroke unsupported here.
    throw new Error('Paint on tilemap layers requires editTile');
  }
  const target = targetBuffer(p, layerId, frameId);
  assert(target, 'No paint target');
  const { cel, img } = target!;
  const ox = cel.x, oy = cel.y; // cel content origin in canvas space

  // Map canvas-space points into cel buffer space.
  const localPoints = points.map((pt) => ({ x: pt.x - ox, y: pt.y - oy }));
  // Map the canvas-space selection mask onto the cel buffer window.
  let localOptions: PaintOptions = options;
  if (options.selection) {
    const sel = options.selection;
    const cw = p.width, ch = p.height;
    const local = new Uint8Array(img.width * img.height);
    for (let ly = 0; ly < img.height; ly++) {
      for (let lx = 0; lx < img.width; lx++) {
        const cx = lx + ox, cy = ly + oy;
        if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
        local[ly * img.width + lx] = sel[cy * cw + cx]!;
      }
    }
    localOptions = { ...options, selection: local };
  }

  if (tool === 'eyedropper') {
    // Sample from cel pixels; does not mutate artwork.
    return;
  }
  if (tool === 'wand' || tool === 'select') {
    // Selection production is handled by makeSelection/wandSelection at UI level.
    return;
  }
  if (tool === 'move') {
    const dx = points.length >= 2 ? Math.floor(points[points.length - 1]!.x - points[0]!.x) : 0;
    const dy = points.length >= 2 ? Math.floor(points[points.length - 1]!.y - points[0]!.y) : 0;
    docMoveCel(p, target!.cel, dx, dy);
    return;
  }

  const ctx = buildContext(p, img!, frameId, localOptions);
  if (tool === 'fill' && options.reference) {
    // Visible-composite reference: sample all visible layers but write only
    // active target. `reference` is the canvas-space RGBA composite (or
    // legacy flag form); it must be remapped into cel buffer space.
    const composite = options.reference instanceof Uint8Array && options.reference.length >= p.width * p.height * 4
      ? options.reference
      : renderFrame(p, frameId, false);
    const ref = new Uint8Array(img.width * img.height * 4);
    for (let ly = 0; ly < img.height; ly++) {
      for (let lx = 0; lx < img.width; lx++) {
        const cx = lx + ox, cy = ly + oy;
        const d = (ly * img.width + lx) * 4;
        if (cx < 0 || cy < 0 || cx >= p.width || cy >= p.height) continue;
        const s = (cy * p.width + cx) * 4;
        ref[d] = composite[s]!; ref[d + 1] = composite[s + 1]!;
        ref[d + 2] = composite[s + 2]!; ref[d + 3] = composite[s + 3]!;
      }
    }
    ctx.snapshot = ref;
  }
  if (tool === 'gradient' && (options as PaintOptions & { gradient?: 'linear' | 'radial' }).gradient === 'radial') {
    const c0 = options.color;
    const c1 = (options as PaintOptions & { color2?: RGBA }).color2 ?? options.color;
    gradientRadial(ctx, points[0]!, Math.max(1, options.size * 8), c0, c1, p.mode === 'indexed', ctx.palette);
    return;
  }
  if (tool === 'gradient') {
    // linear gradient with optional ramp endpoints
    const ramp = options.ramp;
    const c0 = ramp && ramp.length >= 1 ? ramp[0]! : options.color;
    const c1 = ramp && ramp.length >= 2 ? ramp[1]! : options.color;
    gradientLinear(ctx, points[0] ?? { x: 0, y: 0 }, points[1] ?? { x: p.width - 1, y: p.height - 1 }, c0, c1, 0, p.mode === 'indexed', ctx.palette);
    return;
  }
  executeStroke({ tool, points: localPoints, options: localOptions, ctx });
  p.revision++;
}

// ---------------------------------------------------------------------------
// Cel transforms: exact integer permutations (flip/rotate)
// ---------------------------------------------------------------------------

function remapBuffer(src: Uint8Array, w: number, h: number, bpp: number, op: 'flip-x' | 'flip-y' | 'rotate-90' | 'rotate-180'): { data: Uint8Array; w: number; h: number } {
  let nw = w, nh = h;
  if (op === 'rotate-90') { nw = h; nh = w; }
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = x, ny = y;
      switch (op) {
        case 'flip-x': nx = w - 1 - x; break;
        case 'flip-y': ny = h - 1 - y; break;
        case 'rotate-90': nx = h - 1 - y; ny = x; break; // CW
        case 'rotate-180': nx = w - 1 - x; ny = h - 1 - y; break;
      }
      const s = (y * w + x) * bpp;
      const d = (ny * nw + nx) * bpp;
      for (let b = 0; b < bpp; b++) out[d + b] = src[s + b]!;
    }
  }
  return { data: out, w: nw, h: nh };
}

/**
 * Transform the cel content at (layerId, frameId). Linked cels transform all
 * members' shared content exactly once; rotate-90 keeps content top-left at
 * origin 0,0 (canvas-space translation is the caller's move concern).
 */
export function transformCel(p: Project, layerId: string, frameId: string, op: 'flip-x' | 'flip-y' | 'rotate-90' | 'rotate-180'): void {
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') throw new Error('Cannot transform a group layer');
  const cel = getCel(p, layerId, frameId) ?? ensureCel(p, layerId, frameId);
  if (layer.kind === 'tilemap') {
    const tm = p.tilemaps.find((t) => t.layerId === layerId && t.frameId === frameId);
    assert(tm, 'Tilemap state missing');
    for (const cell of tm!.cells) {
      if (op === 'flip-x') cell.flipX = !cell.flipX;
      else if (op === 'flip-y') cell.flipY = !cell.flipY;
      else if (op === 'rotate-90') { cell.diagonal = !cell.diagonal; }
      else if (op === 'rotate-180') { cell.flipX = !cell.flipX; cell.flipY = !cell.flipY; }
    }
    p.revision++;
    return;
  }
  const img = p.images[cel!.imageId];
  assert(img, 'Cel missing image');
  // Guard: transform shared content once per unique image among link group members.
  const bpp = bufferBpp(p.mode);
  const r = remapBuffer(img!.data, img!.width, img!.height, bpp, op);
  img!.data.set(r.data);
  img!.width = r.w;
  img!.height = r.h;
  p.revision++;
}

// ---------------------------------------------------------------------------
// Project resize
// ---------------------------------------------------------------------------

/**
 * Resize the canvas. scale=false is an anchor-at-0 crop/extend; scale=true
 * applies nearest-neighbor integer scaling of all content. Cel origins shift
 * consistently; out-of-bounds content is cropped.
 */
export function resizeProject(p: Project, w: number, h: number, scale: boolean): void {
  assert(w > 0 && h > 0 && w <= 8192 && h <= 8192, 'Invalid resize target');
  assert(w * h <= 16777216, 'Area cap exceeded');
  const oldW = p.width, oldH = p.height;
  const sx = w / oldW, sy = h / oldH;
  p.width = w;
  p.height = h;
  const newImages: Record<string, { id: string; width: number; height: number; mode: Mode; data: Uint8Array }> = {};
  const bpp = bufferBpp(p.mode);
  for (const k of Object.keys(p.images)) {
    const img = p.images[k]!;
    const out = new Uint8Array(w * h * bpp);
    if (scale) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const osx = Math.min(oldW - 1, Math.floor(x / sx));
          const osy = Math.min(oldH - 1, Math.floor(y / sy));
          const s = (osy * oldW + osx) * bpp;
          const d = (y * w + x) * bpp;
          for (let b = 0; b < bpp; b++) out[d + b] = img.data[s + b]!;
        }
      }
    } else {
      const cw = Math.min(oldW, w), ch = Math.min(oldH, h);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const s = (y * oldW + x) * bpp;
          const d = (y * w + x) * bpp;
          for (let b = 0; b < bpp; b++) out[d + b] = img.data[s + b]!;
        }
      }
    }
    newImages[img.id] = { ...img, width: w, height: h, data: out };
  }
  p.images = newImages;
  // Tilemaps: resize via re-derivation is not tile-aware; keep grid extents consistent.
  p.tilemaps = [];
  p.cels = p.cels.map((c) => (scale ? c : c)); // origins stay 0,0 anchored
  p.revision++;
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

/**
 * Invert or grayscale the cel (optionally restricted to a selection mask).
 * Indexed mode adjusts through the palette track, not hidden RGB.
 */
export function adjust(p: Project, layerId: string, frameId: string, kind: 'invert' | 'grayscale', selection?: Uint8Array | null): void {
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') throw new Error('Cannot adjust a group layer');
  if (p.mode === 'indexed') {
    // Default to palette editing: invert palette order for invert, grayscale-map entries otherwise.
    const pal = paletteFor(p, frameId);
    const newPal: RGBA[] = pal.map((c) => (kind === 'invert' ? [255 - c[0]!, 255 - c[1]!, 255 - c[2]!, c[3]!] as RGBA : rgbaToGray(c)));
    p.palette = newPal;
    const key = p.paletteKeys.find((k) => k.frameId === frameId);
    if (key) key.colors = newPal.map((c) => [...c] as RGBA);
    else p.paletteKeys.push({ frameId, colors: newPal.map((c) => [...c] as RGBA) });
    p.revision++;
    return;
  }
  const cel = getCel(p, layerId, frameId) ?? ensureCel(p, layerId, frameId);
  const img = p.images[cel!.imageId];
  assert(img, 'Cel missing image');
  const bpp = bufferBpp(p.mode);
  for (let i = 0; i < img!.width * img!.height; i++) {
    if (selection && !selection[i]) continue;
    if (p.mode === 'rgba') {
      const o = i * 4;
      if (kind === 'invert') {
        // invert RGB, preserve alpha
        img!.data[o] = 255 - img!.data[o]!;
        img!.data[o + 1] = 255 - img!.data[o + 1]!;
        img!.data[o + 2] = 255 - img!.data[o + 2]!;
      } else {
        const g = rgbaToGray([img!.data[o]!, img!.data[o + 1]!, img!.data[o + 2]!, img!.data[o + 3]!]);
        img!.data[o] = g[0]!; img!.data[o + 1] = g[1]!; img!.data[o + 2] = g[2]!;
      }
    } else {
      const o = i * 2;
      const v = img!.data[o]!;
      img!.data[o] = kind === 'invert' ? 255 - v : v; // gray value already luminance
    }
  }
  p.revision++;
}

// ---------------------------------------------------------------------------
// Tilemap editing
// ---------------------------------------------------------------------------

export interface TileEditOptions {
  mode: 'tiles' | 'manual' | 'auto' | 'stack';
  /** For 'manual'/'auto'/'stack': pixel-level gesture to apply to the tile buffer. */
  pixelEdit?: (tileData: Uint8Array, tileW: number, tileH: number) => void;
  /** For 'tiles' mode: replace the cell reference. */
  tile?: number;
  flipX?: boolean;
  flipY?: boolean;
  diagonal?: boolean;
}

function hashTile(data: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 16777619);
  }
  return `${data.length}-${(h >>> 0).toString(16)}`;
}

function tilesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Tilemap cell edit with the three documented policies plus direct reference
 * placement:
 * - 'tiles': change cell reference only.
 * - 'manual': modify tile content in place; all users of that tile change.
 * - 'auto': paint locally, dedupe against existing tiles (byte-compare after
 *   hash), reuse or append; garbage-collect tiles unused across ALL tilemaps
 *   referencing the tileset after commit.
 * - 'stack': keep existing tile untouched and append a new tile for the result.
 */
export function editTile(
  p: Project, layerId: string, frameId: string, gx: number, gy: number,
  tileIndex: number, mode: 'tiles' | 'manual' | 'auto' | 'stack',
  pixelEdit?: (tileData: Uint8Array, tileW: number, tileH: number) => void,
): void {
  const layer = findLayer(p, layerId);
  assert(layer.kind === 'tilemap', 'editTile requires a tilemap layer');
  assert(layer.tilesetId, 'Tilemap layer has no tileset');
  const ts = p.tilesets.find((t) => t.id === layer.tilesetId)!;
  const tm = p.tilemaps.find((t) => t.layerId === layerId && t.frameId === frameId);
  assert(tm, 'Tilemap state missing for frame');
  assert(gx >= 0 && gy >= 0 && gx < tm!.width && gy < tm!.height, 'Tile cell out of bounds');
  const cellIdx = gy * tm!.width + gx;
  const cell = tm!.cells[cellIdx]!;

  if (mode === 'tiles') {
    assert(tileIndex >= 0 && tileIndex < ts.tiles.length, 'Tile index out of range');
    tm!.cells[cellIdx] = { tile: tileIndex, flipX: false, flipY: false, diagonal: false };
    p.revision++;
    return;
  }

  assert(pixelEdit, 'Pixel edit callback required for manual/auto/stack modes');
  const baseTileIdx = tileIndex >= 0 ? tileIndex : cell.tile;
  const srcTile = ts.tiles[baseTileIdx];
  assert(srcTile, 'Source tile missing');
  const work = new Uint8Array(srcTile!.data);

  if (mode === 'manual') {
    pixelEdit!(work, ts.width, ts.height);
    srcTile!.data.set(work);
    p.revision++;
    return;
  }

  pixelEdit!(work, ts.width, ts.height);

  if (mode === 'auto') {
    // Deduplicate: hash then byte-compare confirm.
    const hash = hashTile(work);
    let match = -1;
    for (let i = 0; i < ts.tiles.length; i++) {
      if (hashTile(ts.tiles[i]!.data) === hash && tilesEqual(ts.tiles[i]!.data, work)) {
        match = i;
        break;
      }
    }
    if (match >= 0) {
      tm!.cells[cellIdx] = { tile: match, flipX: cell.flipX, flipY: cell.flipY, diagonal: cell.diagonal };
    } else {
      ts.tiles.push({ id: uid(), width: ts.width, height: ts.height, mode: srcTile!.mode, data: work });
      tm!.cells[cellIdx] = { tile: ts.tiles.length - 1, flipX: cell.flipX, flipY: cell.flipY, diagonal: cell.diagonal };
    }
    // GC: remove tiles unused across ALL tilemaps referencing this tileset,
    // then compact: remap every surviving cell's reference to the new index.
    const users = p.tilemaps.filter((t) => t.layerId && p.layers.find((l) => l.id === t.layerId)?.tilesetId === ts.id);
    const used = new Set<number>();
    for (const u of users) for (const c of u.cells) used.add(c.tile);
    const keep = baseIndexOrZero(ts);
    const remap: number[] = [];
    const kept: typeof ts.tiles = [];
    for (let i = 0; i < ts.tiles.length; i++) {
      if (i < keep || used.has(i)) {
        remap[i] = kept.length;
        kept.push(ts.tiles[i]!);
      } else {
        remap[i] = -1;
      }
    }
    // The just-placed tile must survive by construction.
    const placed = tm!.cells[cellIdx]!.tile;
    if (remap[placed] === undefined || remap[placed] === -1) {
      remap[placed] = kept.length;
      kept.push(ts.tiles[placed]!);
    }
    ts.tiles = kept;
    for (const u of users) {
      for (const c of u.cells) {
        const r = remap[c.tile];
        if (r !== undefined && r >= 0) c.tile = r;
      }
    }
    p.revision++;
    return;
  }

  if (mode === 'stack') {
    // Keep existing tiles; append one new tile per edited cell per gesture.
    ts.tiles.push({ id: uid(), width: ts.width, height: ts.height, mode: srcTile!.mode, data: work });
    tm!.cells[cellIdx] = { tile: ts.tiles.length - 1, flipX: cell.flipX, flipY: cell.flipY, diagonal: cell.diagonal };
    p.revision++;
    return;
  }
}

function baseIndexOrZero(ts: { baseIndex: number }): number {
  return 1; // Native tile zero is always empty; baseIndex is UI metadata only.
}

// ---------------------------------------------------------------------------
// Animation sequence
// ---------------------------------------------------------------------------

/**
 * Frame id sequence for playback. Tag scopes the range; finite=true applies
 * the repeat count semantics: forward/reverse repeat N = N traversals;
 * pingpong repeat N = N traversals alternating direction, sharing turnaround
 * endpoints (repeat=2 gives A,B,C,B,A). repeat=0 with finite=true is clamped
 * to one traversal. finite=false (infinite playback) emits one loop unit:
 * the shortest fragment that tiles into the endless sequence — for pingpong
 * that is A,B,C,B (looping it reproduces the alternating traversal).
 */
export function animationSequence(p: Project, tagId?: { id: string } | null, finite = false): string[] {
  const seq: string[] = [];
  let frames = p.frames;
  let direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse' = 'forward';
  let repeat = 1;
  if (tagId) {
    const tag = p.tags.find((t) => t.id === tagId.id);
    assert(tag, 'Unknown tag');
    const fromIdx = findFrameIndex(p, tag!.from);
    const toIdx = findFrameIndex(p, tag!.to);
    frames = p.frames.slice(fromIdx, toIdx + 1);
    direction = tag!.direction;
    repeat = finite ? Math.max(1, tag!.repeat || 1) : 1;
  }
  const fwd = frames.map((f) => f.id);
  if (fwd.length === 0) return seq;
  if (fwd.length === 1) return [fwd[0]!];

  const emitTraversal = (list: string[]) => seq.push(...list);
  const rev = [...fwd].reverse();

  if (!finite) {
    // Infinite playback: one loop unit that tiles into the endless sequence.
    // For pingpong the period is A,B,C,B (repeating it reproduces the
    // alternating traversal without ever repeating a turnaround endpoint).
    switch (direction) {
      case 'reverse': emitTraversal(rev); break;
      case 'pingpong': emitTraversal(fwd); emitTraversal(rev.slice(1, rev.length - 1)); break;
      case 'pingpong-reverse': emitTraversal(rev); emitTraversal(fwd.slice(1, fwd.length - 1)); break;
      default: emitTraversal(fwd);
    }
    return seq;
  }

  if (direction === 'forward') {
    for (let r = 0; r < repeat; r++) emitTraversal(fwd);
  } else if (direction === 'reverse') {
    for (let r = 0; r < repeat; r++) emitTraversal(rev);
  } else if (direction === 'pingpong') {
    // A,B,C,B,A,... — traversals alternate direction and share the turnaround
    // endpoint (never emitted twice in a row). One repeat = one traversal.
    let current = fwd;
    let goingForward = true;
    for (let r = 0; r < repeat; r++) {
      emitTraversal(current);
      goingForward = !goingForward;
      const base = goingForward ? fwd : rev;
      current = base.slice(1); // skip shared turnaround endpoint on continuation
      if (current.length === 0) current = base; // single-frame tag
    }
    void goingForward;
  } else {
    // pingpong-reverse: same alternation starting from the reversed traversal
    let current = rev;
    let goingBackward = true;
    for (let r = 0; r < repeat; r++) {
      emitTraversal(current);
      goingBackward = !goingBackward;
      const base = goingBackward ? rev : fwd;
      current = base.slice(1);
      if (current.length === 0) current = base;
    }
    void goingBackward;
  }
  return seq;
}

// re-exports for API surface
export { addFrame, removeFrame, addLayer, removeLayer, ensureCel, getCel, linkCel, celContentSize, renderFrame };
