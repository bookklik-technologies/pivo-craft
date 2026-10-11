// Original document model operations for PiVo Craft core.
import type {
  Cel, Frame, ImageDataModel, Layer, Mode, Project, RGBA, Tag,
} from './types.ts';
import { assert, bpp, findFrameIndex, findLayer, projectBytes, requiredImageBytes, uid } from './util.ts';
import { rgbaToGray } from './color.ts';

export const MAX_DIM = 8192;
export const MAX_AREA = 16777216;
export const MAX_FRAMES = 4096;
export const MAX_LAYERS = 1024;
export const MAX_NESTING = 64;
export const MAX_PALETTE_ENTRIES = 65536;
export const MAX_TILES_PER_SET = 65536;

export function defaultPalette(mode: Mode): RGBA[] {
  if (mode === 'indexed') {
    const pal: RGBA[] = [];
    for (let i = 0; i < 32; i++) pal.push([i * 8, i * 8, i * 8, 255]);
    return pal;
  }
  return [[0, 0, 0, 255], [255, 255, 255, 255]];
}

export function makeImage(width: number, height: number, mode: Mode, fill?: RGBA): ImageDataModel {
  const data = new Uint8Array(requiredImageBytes(width, height, mode));
  if (fill && fill[3] !== 0) {
    if (mode === 'rgba') {
      for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
    } else if (mode === 'gray') {
      for (let i = 0; i < width * height; i++) {
        data[i * 2] = fill[0]!;
        data[i * 2 + 1] = fill[3]!;
      }
    } else {
      data.fill(fill[0]!); // interpret fill[0] as index in indexed mode
    }
  }
  return { id: uid(), width, height, mode, data };
}

/**
 * Deep-copy an image with a FRESH id: a clone is a distinct content object
 * and must never collide with (or alias) its source through the images map.
 * Use cloneImageWithId when identity-preserving duplication is intended.
 */
export function cloneImage(img: ImageDataModel): ImageDataModel {
  return { ...img, id: uid(), data: new Uint8Array(img.data) };
}

/** Identity-preserving deep copy (same id, independent buffer). */
export function cloneImageWithId(img: ImageDataModel): ImageDataModel {
  return { ...img, data: new Uint8Array(img.data) };
}

function makeLayer(name: string, kind: Layer['kind'], parent: string | null, background = false): Layer {
  return {
    id: uid(), name, kind, visible: true, locked: false, opacity: 255,
    blend: 'normal', continuous: false, background, parent, isolated: false,
  };
}

// ---------------------------------------------------------------------------
// createProject / clone / validate
// ---------------------------------------------------------------------------

export function createProject(width = 32, height = 32, name = 'Untitled', mode: Mode = 'rgba'): Project {
  assert(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0, 'Invalid canvas size');
  assert(width <= MAX_DIM && height <= MAX_DIM, 'Canvas dimension exceeds 8192 safety cap');
  assert(width * height <= MAX_AREA, 'Canvas area exceeds 16777216 pixel cap');
  const bg = makeLayer('Layer 1', 'image', null, false);
  const img = makeImage(width, height, mode);
  const frame: Frame = { id: uid(), duration: 100 };
  const cel: Cel = {
    id: uid(), frameId: frame.id, layerId: bg.id, imageId: img.id, x: 0, y: 0, opacity: 255, z: 0,
  };
  const palette = defaultPalette(mode);
  return {
    version: 1,
    id: uid(),
    name,
    width, height, mode,
    transparentIndex: mode === 'indexed' ? 0 : -1,
    pixelRatio: [1, 1],
    frames: [frame],
    layers: [bg],
    images: { [img.id]: img },
    cels: [cel],
    palette,
    paletteKeys: mode === 'indexed' ? [{ frameId: frame.id, colors: palette }] : [],
    tags: [],
    slices: [],
    tilesets: [],
    tilemaps: [],
    revision: 0,
    diagnostics: [],
  };
}

/**
 * Deep clone. Images get fresh ids and every reference (cels, tileset tiles'
 * consumers) is rewritten to the new keys, so the clone shares no mutable
 * state with the original. The project id is preserved by default — a clone
 * is the same document, copied — pass `newId` for a distinct identity.
 */
export function cloneProject(p: Project, options?: { newId?: boolean; preserveImageIds?: boolean }): Project {
  const images: Record<string, ImageDataModel> = {};
  const remap: Record<string, string> = {};
  for (const k of Object.keys(p.images)) {
    const c = options?.preserveImageIds ? cloneImageWithId(p.images[k]!) : cloneImage(p.images[k]!);
    images[c.id] = c;
    remap[k] = c.id;
  }
  const tilesets = p.tilesets.map((ts) => ({
    ...ts,
    tiles: ts.tiles.map((t) => options?.preserveImageIds ? cloneImageWithId(t) : cloneImage(t)),
  }));
  return {
    ...p,
    id: options?.newId ? uid() : p.id,
    frames: p.frames.map((f) => ({ ...f })),
    layers: p.layers.map((l) => ({ ...l })),
    images,
    cels: p.cels.map((c) => ({ ...c, imageId: remap[c.imageId] ?? c.imageId })),
    palette: p.palette.map((c) => [...c] as RGBA),
    paletteKeys: p.paletteKeys.map((k) => ({ frameId: k.frameId, colors: k.colors.map((c) => [...c] as RGBA) })),
    tags: p.tags.map((t) => ({ ...t, color: [...t.color] as RGBA })),
    slices: p.slices.map((s) => ({ ...s, keys: s.keys.map((k) => ({ ...k, center: k.center ? { ...k.center } : undefined, pivot: k.pivot ? { ...k.pivot } : undefined })) })),
    tilesets,
    tilemaps: p.tilemaps.map((tm) => ({ ...tm, cells: tm.cells.map((c) => ({ ...c })) })),
    diagnostics: p.diagnostics.map((d) => ({ ...d })),
  };
}

export function depthOf(p: Project, layerId: string): number {
  let d = 0;
  let cur = p.layers.find((l) => l.id === layerId);
  const seen = new Set<string>();
  while (cur && cur.parent) {
    assert(!seen.has(cur.id), 'Layer cycle detected');
    seen.add(cur.id);
    cur = p.layers.find((l) => l.id === cur!.parent);
    d++;
    assert(d <= MAX_NESTING, 'Layer nesting exceeds cap');
  }
  return d;
}

export function descendantsOf(p: Project, layerId: string): string[] {
  const out: string[] = [];
  const stack = [layerId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const l of p.layers) {
      if (l.parent === cur) {
        out.push(l.id);
        stack.push(l.id);
      }
    }
  }
  return out;
}

export function isAncestor(p: Project, ancestorId: string, layerId: string): boolean {
  return descendantsOf(p, ancestorId).includes(layerId);
}

/** Effective visibility = conjunction of ancestors (spec 4.1). */
export function effectiveVisible(p: Project, layerId: string): boolean {
  let cur = findLayer(p, layerId);
  let v = cur.visible;
  while (cur.parent) {
    cur = findLayer(p, cur.parent);
    v = v && cur.visible;
  }
  return v;
}

/** Effective edit lock = local lock or any ancestor lock. */
export function effectiveLocked(p: Project, layerId: string): boolean {
  let cur = findLayer(p, layerId);
  let locked = cur.locked;
  while (cur.parent) {
    cur = findLayer(p, cur.parent);
    locked = locked || cur.locked;
  }
  return locked;
}

function validateLayerTree(p: Project): void {
  for (const l of p.layers) {
    if (l.parent !== null) {
      const parent = p.layers.find((x) => x.id === l.parent);
      assert(parent, `Layer ${l.id} references missing parent ${l.parent}`);
      assert(parent.kind === 'group', `Layer ${l.id} parent ${l.parent} is not a group`);
      assert(!isAncestor(p, l.id, l.parent), `Layer cycle: ${l.id}`);
      assert(depthOf(p, l.id) < MAX_NESTING, 'Layer nesting exceeds cap');
    }
    if (l.kind === 'group') {
      assert(!p.cels.some((c) => c.layerId === l.id), `Group ${l.id} must not have image cels`);
    }
    assert(l.opacity >= 0 && l.opacity <= 255, `Layer ${l.id} opacity out of range`);
  }
  const bgs = p.layers.filter((l) => l.background);
  assert(bgs.length <= 1, 'At most one background layer allowed');
  if (bgs.length === 1) {
    const bg = bgs[0]!;
    const bottom = p.layers[0]!;
    assert(bottom.id === bg.id, 'Background layer must be bottom-most');
    assert(!bg.parent, 'Background layer must not be nested');
  }
}

export function validateProject(p: Project): void {
  assert(p.version === 1, 'Unsupported project version');
  assert(p.frames.length >= 1, 'Document must have at least one frame');
  assert(p.layers.length >= 1, 'Document must have at least one layer');
  assert(p.frames.length <= MAX_FRAMES, 'Too many frames');
  assert(p.layers.length <= MAX_LAYERS, 'Too many layers');
  assert(p.width > 0 && p.height > 0 && p.width <= MAX_DIM && p.height <= MAX_DIM, 'Invalid canvas size');
  assert(p.width * p.height <= MAX_AREA, 'Canvas area exceeds cap');
  validateLayerTree(p);
  const layerIds = new Set(p.layers.map((l) => l.id));
  const frameIds = new Set(p.frames.map((f) => f.id));
  for (const c of p.cels) {
    assert(layerIds.has(c.layerId), `Cel ${c.id} references missing layer`);
    assert(frameIds.has(c.frameId), `Cel ${c.id} references missing frame`);
    const layer = p.layers.find((l) => l.id === c.layerId)!;
    if (layer.kind === 'group') continue;
    if (layer.kind === 'tilemap') {
      assert(p.tilemaps.some((tm) => tm.layerId === c.layerId && tm.frameId === c.frameId),
        `Tilemap cel ${c.id} has no tilemap state`);
    } else {
      const img = p.images[c.imageId];
      assert(img, `Cel ${c.id} references missing image ${c.imageId}`);
      assert(img!.mode === p.mode, `Image ${c.imageId} mode mismatch with document`);
      assert(img!.width * img!.height * bpp(img!.mode) === img!.data.byteLength, `Image ${c.imageId} buffer size mismatch`);
    }
    assert(c.opacity >= 0 && c.opacity <= 255, `Cel ${c.id} opacity out of range`);
  }
  // All images match document mode.
  for (const k of Object.keys(p.images)) {
    const img = p.images[k]!;
    assert(img.mode === p.mode, `Image ${k} mode mismatch with document`);
    assert(img.width * img.height * bpp(img.mode) === img.data.byteLength, `Image ${k} buffer size mismatch`);
  }
  // Tags and slice keys resolve to existing frames.
  for (const t of p.tags) {
    assert(frameIds.has(t.from) && frameIds.has(t.to), `Tag ${t.id} references missing frame`);
  }
  for (const s of p.slices) {
    for (const k of s.keys) assert(frameIds.has(k.frameId), `Slice ${s.id} references missing frame`);
  }
  // Tilemap layers reference compatible tilesets; tilemaps valid.
  for (const tm of p.tilemaps) {
    const layer = p.layers.find((l) => l.id === tm.layerId);
    assert(layer, `Tilemap ${tm.id} references missing layer`);
    assert(frameIds.has(tm.frameId), `Tilemap ${tm.id} references missing frame`);
    assert(layer!.tilesetId, `Tilemap layer ${tm.layerId} missing tileset reference`);
    assert(p.tilesets.some((ts) => ts.id === layer!.tilesetId), `Tilemap ${tm.id} references missing tileset`);
    assert(tm.cells.length === tm.width * tm.height, `Tilemap ${tm.id} cell count mismatch`);
    const ts = p.tilesets.find((t) => t.id === layer!.tilesetId)!;
    for (const cell of tm.cells) {
      assert(cell.tile >= 0 && cell.tile < ts.tiles.length, `Tilemap ${tm.id} tile index out of range`);
    }
  }
  // Indexed palette sane.
  if (p.mode === 'indexed') {
    assert(p.transparentIndex >= 0 && p.transparentIndex < 256, 'Indexed transparentIndex out of range');
  }
  assert(projectBytes(p) < Number.MAX_SAFE_INTEGER, 'Project size overflow');
}

// ---------------------------------------------------------------------------
// Palette per frame: ordered frame-keyed deltas with last-known continuing.
// ---------------------------------------------------------------------------

export function paletteFor(p: Project, frameId: string): RGBA[] {
  findFrameIndex(p, frameId);
  if (p.mode !== 'indexed') return p.palette;
  const keys = [...p.paletteKeys].sort((a, b) =>
    findFrameIndex(p, a.frameId) - findFrameIndex(p, b.frameId));
  let colors: RGBA[] | null = null;
  for (const k of keys) {
    if (findFrameIndex(p, k.frameId) > findFrameIndex(p, frameId)) break;
    colors = k.colors;
  }
  return colors ?? p.palette;
}

// ---------------------------------------------------------------------------
// Cel access
// ---------------------------------------------------------------------------

export function getCel(p: Project, layerId: string, frameId: string): Cel | undefined {
  return p.cels.find((c) => c.layerId === layerId && c.frameId === frameId);
}

function tileCelSize(p: Project, layerId: string): { w: number; h: number } | null {
  const layer = findLayer(p, layerId);
  if (layer.kind !== 'tilemap') return null;
  const tm = p.tilemaps.find((t) => t.layerId === layerId && t.frameId === frameIdOfCel(p, layerId));
  if (!tm) return null;
  const ts = p.tilesets.find((t) => t.id === layer.tilesetId);
  return ts ? { w: ts.width * tm.width, h: ts.height * tm.height } : null;
}

function frameIdOfCel(p: Project, layerId: string): string {
  // helper used only to find tilemap state; first cel of the layer decides frame
  return p.cels.find((c) => c.layerId === layerId)?.frameId ?? p.frames[0]!.id;
}

export function ensureCel(p: Project, layerId: string, frameId: string): Cel {
  findLayer(p, layerId);
  findFrameIndex(p, frameId);
  let cel = getCel(p, layerId, frameId);
  if (cel) return cel;
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') {
    throw new Error('Groups cannot hold cels');
  }
  if (layer.kind === 'tilemap') {
    const tsId = layer.tilesetId ?? (() => {
      const ts = { id: uid(), name: 'Tileset', width: 16, height: 16, tiles: [makeImage(16, 16, p.mode, [0, 0, 0, 0])], baseIndex: 1 };
      p.tilesets.push(ts);
      layer.tilesetId = ts.id;
      return ts.id;
    })();
    const ts = p.tilesets.find((t) => t.id === tsId)!;
    const tm = {
      id: uid(), frameId, layerId, width: Math.ceil(p.width / ts.width), height: Math.ceil(p.height / ts.height),
      x: 0, y: 0, cells: Array.from({ length: Math.ceil(p.width / ts.width) * Math.ceil(p.height / ts.height) }, () => ({ tile: 0, flipX: false, flipY: false, diagonal: false })),
    };
    p.tilemaps.push(tm);
    cel = { id: uid(), frameId, layerId, imageId: '', x: 0, y: 0, opacity: 255, z: 0 };
  } else {
    const img = makeImage(p.width, p.height, p.mode);
    p.images[img.id] = img;
    cel = { id: uid(), frameId, layerId, imageId: img.id, x: 0, y: 0, opacity: 255, z: 0 };
  }
  p.cels.push(cel);
  p.revision++;
  return cel;
}

/** Rendered size of a cel's content (canvas-sized for image layers, grid size for tilemaps). */
export function celContentSize(p: Project, cel: Cel): { w: number; h: number } {
  const layer = findLayer(p, cel.layerId);
  if (layer.kind === 'tilemap') {
    const tm = p.tilemaps.find((t) => t.layerId === cel.layerId && t.frameId === cel.frameId);
    const ts = layer.tilesetId ? p.tilesets.find((t) => t.id === layer.tilesetId) : undefined;
    if (tm && ts) return { w: ts.width * tm.width, h: ts.height * tm.height };
    return { w: 0, h: 0 };
  }
  const img = p.images[cel.imageId];
  return img ? { w: img.width, h: img.height } : { w: 0, h: 0 };
}

// ---------------------------------------------------------------------------
// Link sets
// ---------------------------------------------------------------------------

/**
 * True when two cels are content-linked: same imageId and same linkId group.
 * Imported same-image/different-placement links share content but NOT placement.
 */
export function sameLinkGroup(p: Project, a: Cel, b: Cel): boolean {
  return a.linkId !== undefined && a.linkId === b.linkId;
}

/** True when these two cels share content AND placement (editor LinkSet). */
export function shareContentAndPlacement(p: Project, a: Cel, b: Cel): boolean {
  if (a.imageId !== b.imageId) return false;
  return a.x === b.x && a.y === b.y;
}

// ---------------------------------------------------------------------------
// Layer ops
// ---------------------------------------------------------------------------

export function addLayer(p: Project, name: string, kind: 'image' | 'group' | 'tilemap' = 'image', parent: string | null = null): Layer {
  assert(p.layers.length < MAX_LAYERS, 'Layer cap reached');
  let parentLayer: Layer | null = null;
  if (parent !== null) {
    parentLayer = findLayer(p, parent);
    assert(parentLayer.kind === 'group', 'Parent must be a group layer');
  }
  const layer = makeLayer(name, kind, parent);
  if (parentLayer) parentLayer.kind = 'group';
  p.layers.push(layer);
  if (kind === 'image') {
    // Give the new layer an image cel on the first frame (empty, transparent).
    const img = makeImage(p.width, p.height, p.mode);
    p.images[img.id] = img;
    p.cels.push({ id: uid(), frameId: p.frames[0]!.id, layerId: layer.id, imageId: img.id, x: 0, y: 0, opacity: 255, z: 0 });
  }
  p.revision++;
  return layer;
}

export function removeLayer(p: Project, id: string): void {
  const layer = findLayer(p, id);
  const doomed = new Set([id, ...descendantsOf(p, id)]);
  const remainingLayers = p.layers.filter((l) => !doomed.has(l.id));
  const layerIds = new Set(remainingLayers.map((l) => l.id));
  assert(remainingLayers.length >= 1, 'Cannot remove the last layer');
  const remainingCels = p.cels.filter((c) => layerIds.has(c.layerId));
  // Delete images no longer referenced (shared data still in use elsewhere survives).
  const used = new Set(remainingCels.map((c) => c.imageId));
  for (const k of Object.keys(p.images)) {
    if (!used.has(k)) delete p.images[k];
  }
  p.tilemaps = p.tilemaps.filter((tm) => layerIds.has(tm.layerId));
  p.tilesets = p.tilesets.filter((ts) => {
    if (!ts.id) return true;
    const stillUsed = p.layers.some((l) => l.tilesetId === ts.id && layerIds.has(l.id));
    return stillUsed || p.layers.some((l) => l.tilesetId === ts.id);
  });
  p.layers = remainingLayers;
  p.cels = remainingCels;
  p.revision++;
  void layer;
}

export function reorderLayer(p: Project, id: string, targetIndex: number): void {
  const layer = findLayer(p, id);
  const idx = p.layers.indexOf(layer);
  assert(idx >= 0, 'Layer not found');
  p.layers.splice(idx, 1);
  p.layers.splice(Math.max(0, Math.min(p.layers.length, targetIndex)), 0, layer);
  if (layer.background) {
    assert(p.layers[0]!.id === layer.id, 'Background layer must remain bottom-most');
  }
  p.revision++;
}

// ---------------------------------------------------------------------------
// Frame ops
// ---------------------------------------------------------------------------

export function addFrame(p: Project, afterId: string, empty = false): Frame {
  findFrameIndex(p, afterId);
  assert(p.frames.length < MAX_FRAMES, 'Frame cap reached');
  const frame: Frame = { id: uid(), duration: p.frames[findFrameIndex(p,afterId)].duration };
  const idx = findFrameIndex(p, afterId);
  p.frames.splice(idx + 1, 0, frame);
  if (!empty) {
    // Duplicate current frame's cels: continuous layers link, others deep-copy.
    for (const layer of p.layers) {
      if (layer.kind === 'group') continue;
      const src = getCel(p, layer.id, afterId);
      if (!src) continue;
      if (layer.continuous) {
        const linked: Cel = { ...src, id: uid(), frameId: frame.id, linkId: src.linkId ?? src.id };
        // establish link group id based on source cel identity
        if (!src.linkId) {
          src.linkId = src.id;
        }
        p.cels.push({ ...linked, linkId: src.linkId });
      } else {
        if (layer.kind === 'tilemap') {
          const tm = p.tilemaps.find((t) => t.layerId === layer.id && t.frameId === afterId);
          if (tm) {
            p.tilemaps.push({ ...tm, id: uid(), frameId: frame.id, cells: tm.cells.map((c) => ({ ...c })) });
          }
          p.cels.push({ id: uid(), frameId: frame.id, layerId: layer.id, imageId: '', x: src.x, y: src.y, opacity: src.opacity, z: src.z });
        } else {
          const img = cloneImage(p.images[src.imageId]!);
          p.images[img.id] = img;
          p.cels.push({ id: uid(), frameId: frame.id, layerId: layer.id, imageId: img.id, x: src.x, y: src.y, opacity: src.opacity, z: src.z });
        }
      }
    }
  } else {
    // New empty frame: absent cels, but background layer must keep its opaque invariant.
    const bg = p.layers.find((l) => l.background);
    if (bg && bg.kind === 'image') {
      ensureCel(p, bg.id, frame.id);
      const cel = getCel(p, bg.id, frame.id)!;
      const img = p.images[cel.imageId]!;
      fillImage(img, currentBackgroundColor(p));
    }
  }
  p.revision++;
  return frame;
}

export function currentBackgroundColor(p: Project): RGBA {
  const bgLayer = p.layers.find((l) => l.background);
  if (bgLayer && bgLayer.kind === 'image') {
    const first = p.cels.find((c) => c.layerId === bgLayer.id);
    if (first) {
      const img = p.images[first.imageId];
      if (img && img.data.byteLength >= 4) return [img.data[0]!, img.data[1]!, img.data[2]!, 255];
    }
  }
  return [255, 255, 255, 255];
}

export function fillImage(img: ImageDataModel, color: RGBA): void {
  if (img.mode === 'rgba') {
    for (let i = 0; i < img.width * img.height; i++) img.data.set(color, i * 4);
  } else if (img.mode === 'gray') {
    for (let i = 0; i < img.width * img.height; i++) {
      img.data[i * 2] = color[0]!;
      img.data[i * 2 + 1] = color[3]!;
    }
  } else {
    img.data.fill(color[0]!);
  }
}

export function removeFrame(p: Project, id: string): void {
  assert(p.frames.length > 1, 'Cannot remove the last frame');
  const idx = findFrameIndex(p, id);
  // Capture tag ranges in pre-removal indices so surviving ranges can be
  // rebound after the splice (AT-19: tags stay valid or are removed).
  const tagRanges = p.tags.map((t) => ({
    tag: t,
    a: p.frames.findIndex((f) => f.id === t.from),
    b: p.frames.findIndex((f) => f.id === t.to),
  }));
  p.frames.splice(idx, 1);
  p.cels = p.cels.filter((c) => c.frameId !== id);
  p.tilemaps = p.tilemaps.filter((tm) => tm.frameId !== id);
  // Drop orphaned images.
  const used = new Set(p.cels.map((c) => c.imageId));
  for (const k of Object.keys(p.images)) {
    if (!used.has(k)) delete p.images[k];
  }
  // Rebind slice keys to the next surviving frame or drop.
  for (const s of p.slices) {
    s.keys = s.keys.filter((k) => k.frameId !== id);
  }
  p.slices = p.slices.filter((s) => s.keys.length > 0);
  // Tags: rebind endpoints to the surviving bounds of their original range;
  // a tag is removed when its range collapses (fewer than 2 surviving frames,
  // i.e. no strict from<to span remains).
  p.tags = tagRanges.filter(({ tag: t, a, b }) => {
    if (a < 0 || b < 0 || a > b) return false; // dangling endpoints
    if (idx < a || idx > b) return true; // deletion outside the range
    const surviving = b - a; // frames left in [a,b] after removing idx
    if (surviving < 2) return false; // range collapsed
    t.from = p.frames[a]!.id;
    t.to = p.frames[b - 1]!.id;
    return true;
  }).map(({ tag: t }) => t);
  p.paletteKeys = p.paletteKeys.filter((k) => k.frameId !== id);
  p.revision++;
}

// ---------------------------------------------------------------------------
// Linked cel operations
// ---------------------------------------------------------------------------

/**
 * Link the cel at (layerId, frameId) to share content+placement with the cel
 * at (layerId, targetFrameId). Content link joins the target's link group;
 * placement is synchronized for editor LinkSets.
 */
export function linkCel(p: Project, layerId: string, frameId: string, targetFrameId: string): void {
  findFrameIndex(p, frameId);
  findFrameIndex(p, targetFrameId);
  const target = getCel(p, layerId, targetFrameId);
  assert(target, 'Target frame has no cel to link to');
  const cel = ensureCel(p, layerId, frameId);
  const groupId = target!.linkId ?? target!.id;
  target!.linkId = groupId;
  cel.linkId = groupId;
  cel.imageId = target!.imageId;
  // Editor LinkSet: share placement.
  cel.x = target!.x;
  cel.y = target!.y;
  p.revision++;
}

/** Unlink clones content and detaches placement membership in one operation. */
export function unlinkCel(p: Project, layerId: string, frameId: string): void {
  const cel = getCel(p, layerId, frameId);
  assert(cel, 'No cel to unlink');
  if (cel!.linkId === undefined) return;
  const group = p.cels.filter((c) => c.linkId === cel!.linkId);
  if (group.length <= 1) {
    cel!.linkId = undefined;
    p.revision++;
    return;
  }
  // Clone content for this cel only.
  const src = p.images[cel!.imageId];
  assert(src, 'Linked cel missing content');
  const img = cloneImage(src!);
  p.images[img.id] = img;
  cel!.imageId = img.id;
  cel!.linkId = undefined;
  p.revision++;
}

/**
 * Move a cel's content by (dx,dy). For editor LinkSets (same linkId) all
 * members move together. Content editing through this entry point for linked
 * pixels must be applied once per unique image (see paint core).
 */
export function moveCel(p: Project, cel: Cel, dx: number, dy: number): void {
  const live = getCel(p, cel.layerId, cel.frameId) ?? cel;
  if (live.linkId !== undefined) {
    for (const c of p.cels) {
      if (c.linkId === live.linkId) {
        c.x += dx;
        c.y += dy;
      }
    }
  } else {
    live.x += dx;
    live.y += dy;
  }
  p.revision++;
}

// ---------------------------------------------------------------------------
// Tags / slices helpers
// ---------------------------------------------------------------------------

export function addTag(p: Project, name: string, fromFrameId: string, toFrameId: string,
  direction: Tag['direction'] = 'forward', repeat = 0, color: RGBA = [255, 255, 255, 255]): Tag {
  const fromIdx = findFrameIndex(p, fromFrameId);
  const toIdx = findFrameIndex(p, toFrameId);
  assert(fromIdx <= toIdx, 'Tag range must be ordered');
  const tag: Tag = { id: uid(), name, from: fromFrameId, to: toFrameId, direction, repeat, color };
  p.tags.push(tag);
  p.revision++;
  return tag;
}

// ---------------------------------------------------------------------------
// Mode conversion
// ---------------------------------------------------------------------------

/**
 * Convert document color mode atomically. RGBA↔gray uses sRGB Rec.709
 * luminance; RGBA/gray→indexed maps each pixel to the nearest palette entry
 * (deterministic tie-break: lowest index); indexed→RGBA resolves the palette
 * effective at each frame, which may require breaking shared content.
 */
export function convertMode(p: Project, mode: Mode): void {
  if (mode === p.mode) return;
  const oldMode = p.mode;
  // Snapshot original pixel content as canonical RGBA per cel (per frame palette aware).
  const snapshots = new Map<string, RGBA[]>(); // cel id -> rgba pixels
  for (const cel of p.cels) {
    if (!cel.imageId) continue;
    const img = p.images[cel.imageId];
    if (!img) continue;
    snapshots.set(cel.id, imageToRGBA(p, img, cel.frameId));
  }
  p.mode = mode;
  const newImages: Record<string, ImageDataModel> = {};
  for (const cel of p.cels) {
    if (!cel.imageId) continue;
    const px = snapshots.get(cel.id);
    if (!px) continue;
    const img = makeImage(p.width, p.height, mode);
    if (mode === 'rgba') {
      for (let i = 0; i < px.length; i++) img.data.set(px[i]!, i * 4);
    } else if (mode === 'gray') {
      for (let i = 0; i < px.length; i++) {
        const g = rgbaToGray(px[i]!);
        img.data[i * 2] = g[0]!;
        img.data[i * 2 + 1] = g[3]!;
      }
    } else {
      // indexed: map to palette effective at this cel's frame
      const pal = paletteFor(p, cel.frameId);
      for (let i = 0; i < px.length; i++) {
        img.data[i] = nearestIndex(pal, px[i]!, p.transparentIndex);
      }
    }
    newImages[img.id] = img;
    cel.imageId = img.id;
  }
  p.images = newImages;
  if (mode === 'indexed') {
    if (p.palette.length === 0 || oldMode !== 'indexed') {
      p.transparentIndex = 0;
    }
    if (p.paletteKeys.length === 0) {
      p.paletteKeys = [{ frameId: p.frames[0]!.id, colors: p.palette }];
    }
  } else {
    p.transparentIndex = -1;
    p.paletteKeys = [];
  }
  p.revision++;
  // Breaking shared raster content: indexed conversion per-cel above already
  // produced distinct images, so link groups are dissolved.
  for (const cel of p.cels) cel.linkId = undefined;
}

export function imageToRGBA(p: Project, img: ImageDataModel, frameId: string): RGBA[] {
  const n = img.width * img.height;
  const out: RGBA[] = new Array(n);
  if (img.mode === 'rgba') {
    for (let i = 0; i < n; i++) {
      out[i] = [img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!, img.data[i * 4 + 3]!];
    }
  } else if (img.mode === 'gray') {
    for (let i = 0; i < n; i++) {
      const v = img.data[i * 2]!;
      out[i] = [v, v, v, img.data[i * 2 + 1]!];
    }
  } else {
    const pal = paletteFor(p, frameId);
    for (let i = 0; i < n; i++) {
      const idx = img.data[i]!;
      out[i] = idx === p.transparentIndex ? [0, 0, 0, 0] : [...(pal[idx] ?? [0, 0, 0, 255])] as RGBA;
    }
  }
  return out;
}

/** Deterministic nearest-palette-index with lowest-index tie-break. */
export function nearestIndex(palette: RGBA[], px: RGBA, transparentIndex: number): number {
  if (px[3] === 0 && transparentIndex >= 0 && transparentIndex < palette.length) return transparentIndex;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const d = (c[0]! - px[0]!) ** 2 + (c[1]! - px[1]!) ** 2 + (c[2]! - px[2]!) ** 2 + (c[3]! - px[3]!) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export { findFrameIndex, findLayer, projectBytes, requiredImageBytes, uid, bpp };
