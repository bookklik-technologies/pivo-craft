// Shared Project helpers for codecs package (original work; core owns the model).
import type { Project, ImageDataModel, Mode, Diagnostic } from '../../core/src/index.ts';
import { uid } from '../../core/src/index.ts';

export const MODE_BYTES: Record<Mode, number> = { rgba: 4, gray: 2, indexed: 1 };
export const MODE_BITS: Record<Mode, number> = { rgba: 32, gray: 16, indexed: 8 };

/** Bytes per pixel for an image in the given mode. */
export function bpp(mode: Mode): number {
  return MODE_BYTES[mode];
}

export function makeImage(width: number, height: number, mode: Mode, fill: [number, number, number, number] = [0, 0, 0, 0]): ImageDataModel {
  return { id: uid(), width, height, mode, data: new Uint8Array(width * height * bpp(mode)) };
}

/** Compute a simple content hash to compare images for dedup. */
export function imageHash(img: ImageDataModel): string {
  let h = 0x811c9dc5;
  const d = img.data;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + d.length.toString(16);
}

export function diag(code: string, severity: Diagnostic['severity'], message: string): Diagnostic {
  return { code, severity, message };
}

/**
 * Structural validation for untrusted Project-shaped data (native .pvc loader).
 * Bounded: caps counts and dimension sizes so crafted JSON cannot blow up memory.
 */
export const LIMITS = {
  maxDim: 65535,
  maxFrames: 8192,
  maxLayers: 1024,
  maxImages: 16384,
  maxCels: 65536,
  maxPalette: 1024,
  maxTags: 4096,
  maxSlices: 4096,
  maxTilesets: 256,
  maxTilemaps: 4096,
  maxTotalPixels: 1 << 28, // 268M pixels across all images
} as const;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new Error(`native project validation: ${msg}`);
}

function bounded(v: unknown, name: string, max: number, min = 0): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(`${name} out of range: ${String(v)}`);
  }
  return v;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') fail(`${name} must be string`);
  if(/(?: id$|frameId|layerId|imageId|tilesetId|linkId)/.test(name)&&(!/^[A-Za-z0-9_.:-]{0,128}$/.test(v as string)||['__proto__','constructor','prototype'].includes(v as string)))fail(`${name} contains unsafe identifier characters`);
  return v as string;
}

/** Validate and normalize a parsed JSON envelope into a Project. Throws on tampering. */
export function validateProjectShape(input: unknown): Project {
  if (!isRecord(input)) fail('root must be an object');
  const o = input;
  if (o.version !== 1) fail(`unsupported version ${String(o.version)}`);

  // Prototype-pollution guard: keys merged into Record fields must not be dangerous.
  const safeKey = (k: string): string => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail(`illegal image key: ${k}`);
    return k;
  };

  const width = bounded(o.width, 'width', LIMITS.maxDim, 1);
  const height = bounded(o.height, 'height', LIMITS.maxDim, 1);
  const mode = o.mode;
  if (mode !== 'rgba' && mode !== 'gray' && mode !== 'indexed') fail(`bad mode ${String(mode)}`);
  const bytes = bpp(mode);

  const frames = o.frames;
  if (!Array.isArray(frames) || frames.length > LIMITS.maxFrames) fail('bad frames');
  const layers = o.layers;
  if (!Array.isArray(layers) || layers.length > LIMITS.maxLayers) fail('bad layers');

  const imagesRaw = o.images;
  if (!isRecord(imagesRaw)) fail('bad images');
  const imageIds = Object.keys(imagesRaw);
  if (imageIds.length > LIMITS.maxImages) fail('too many images');
  let totalPixels = 0;
  const images: Record<string, ImageDataModel> = {};
  for (const key of imageIds) {
    safeKey(key);
    const im = imagesRaw[key];
    if (!isRecord(im)) fail(`image ${key} not an object`);
    const iw = bounded(im.width, `image ${key} width`, LIMITS.maxDim, 1);
    const ih = bounded(im.height, `image ${key} height`, LIMITS.maxDim, 1);
    if (im.mode !== mode) fail(`image ${key} mode mismatch`);
    const data = im.data;
    if (!(data instanceof Uint8Array)) fail(`image ${key} data must be Uint8Array (JSON envelope must decode arrays first)`);
    if (data.length !== iw * ih * bytes) fail(`image ${key} data length mismatch`);
    totalPixels += iw * ih;
    if (totalPixels > LIMITS.maxTotalPixels) fail('total pixel budget exceeded');
    images[key] = { id: str(im.id, 'image id'), width: iw, height: ih, mode, data };
  }

  const cels = o.cels;
  if (!Array.isArray(cels) || cels.length > LIMITS.maxCels) fail('bad cels');
  const palette = o.palette;
  if (!Array.isArray(palette) || palette.length > LIMITS.maxPalette) fail('bad palette');
  for (const c of palette) {
    if (!Array.isArray(c) || c.length !== 4 || c.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 255)) fail('bad palette color');
  }
  const paletteKeys = o.paletteKeys;
  if (!Array.isArray(paletteKeys)) fail('bad paletteKeys');
  const tags = o.tags;
  if (!Array.isArray(tags) || tags.length > LIMITS.maxTags) fail('bad tags');
  const slices = o.slices;
  if (!Array.isArray(slices) || slices.length > LIMITS.maxSlices) fail('bad slices');
  const tilesets = o.tilesets;
  if (tilesets === undefined || tilesets === null) {
    // envelope may omit tilesets/tilemaps when empty
    o.tilesets = [];
  } else if (!Array.isArray(tilesets) || tilesets.length > LIMITS.maxTilesets) fail('bad tilesets');
  const tilemaps = o.tilemaps;
  if (tilemaps === undefined || tilemaps === null) {
    o.tilemaps = [];
  } else if (!Array.isArray(tilemaps) || tilemaps.length > LIMITS.maxTilemaps) fail('bad tilemaps');
  if (!Array.isArray(o.diagnostics)) o.diagnostics = [];
  if (typeof o.revision !== 'number' || !Number.isFinite(o.revision) || o.revision < 0 || o.revision > 0xffffffff) fail('bad revision');
  const tilesetsArr = o.tilesets as Project['tilesets'];
  const tilemapsArr = o.tilemaps as Project['tilemaps'];

  const transparentIndex = bounded(o.transparentIndex, 'transparentIndex', 1024, -1);
  const pr = o.pixelRatio;
  if (!Array.isArray(pr) || pr.length !== 2 || pr.some((x) => typeof x !== 'number' || x <= 0 || x > 255)) fail('bad pixelRatio');

  const out: Project = {
    version: 1,
    id: str(o.id, 'id'),
    name: str(o.name, 'name'),
    width,
    height,
    mode,
    transparentIndex,
    pixelRatio: [pr[0], pr[1]],
    frames: frames.map((f) => {
      if (!isRecord(f)) fail('bad frame');
      return { id: str(f.id, 'frame id'), duration: bounded(f.duration, 'frame duration', 655350, 1) };
    }),
    layers: layers.map((l) => {
      if (!isRecord(l)) fail('bad layer');
      const kind = l.kind;
      if (kind !== 'image' && kind !== 'group' && kind !== 'tilemap') fail('bad layer kind');
      const blend = l.blend;
      if (typeof blend !== 'string') fail('bad layer blend');
      return {
        id: str(l.id, 'layer id'),
        name: str(l.name, 'layer name'),
        kind,
        visible: l.visible === true,
        locked: l.locked === true,
        opacity: bounded(l.opacity, 'layer opacity', 255, 0),
        blend: blend as Project['layers'][number]['blend'],
        continuous: l.continuous === true,
        background: l.background === true,
        parent: l.parent === null ? null : str(l.parent, 'layer parent'),
        isolated: l.isolated === true,
        ...(l.tilesetId === undefined ? {} : { tilesetId: str(l.tilesetId, 'tilesetId') }),
      };
    }),
    images,
    cels: cels.map((c) => {
      if (!isRecord(c)) fail('bad cel');
      const cid = str(c.id, 'cel id');
      const cel: Project['cels'][number] = {
        id: cid,
        frameId: str(c.frameId, 'cel frameId'),
        layerId: str(c.layerId, 'cel layerId'),
        imageId: str(c.imageId, 'cel imageId'),
        x: bounded(c.x, 'cel x', 1 << 20, -(1 << 20)),
        y: bounded(c.y, 'cel y', 1 << 20, -(1 << 20)),
        opacity: bounded(c.opacity, 'cel opacity', 255, 0),
        z: bounded(c.z, 'cel z', 1 << 20, -(1 << 20)),
      };
      if (c.linkId !== undefined) cel.linkId = str(c.linkId, 'cel linkId');
      return cel;
    }),
    palette: palette.map((c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]),
    paletteKeys: paletteKeys.map((pk) => {
      if (!isRecord(pk)) fail('bad paletteKey');
      const colors = pk.colors;
      if (!Array.isArray(colors)||colors.length>LIMITS.maxPalette||colors.some(c=>!Array.isArray(c)||c.length!==4||c.some(v=>!Number.isInteger(v)||v<0||v>255))) fail('bad paletteKey colors');
      return { frameId: str(pk.frameId, 'paletteKey frameId'), colors: colors.map((c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]) };
    }),
    tags: tags.map((t) => {
      if (!isRecord(t)) fail('bad tag');
      const dir = t.direction;
      if (dir !== 'forward' && dir !== 'reverse' && dir !== 'pingpong' && dir !== 'pingpong-reverse') fail('bad tag direction');
      const color = t.color;
      if (!Array.isArray(color) || color.length !== 4) fail('bad tag color');
      return {
        id: str(t.id, 'tag id'),
        name: str(t.name, 'tag name'),
        from: str(t.from, 'tag from'),
        to: str(t.to, 'tag to'),
        direction: dir,
        repeat: bounded(t.repeat, 'tag repeat', 65536),
        color: [color[0], color[1], color[2], color[3]] as [number, number, number, number],
      };
    }),
    slices: slices.map((s) => {
      if (!isRecord(s)) fail('bad slice');
      const keys = s.keys;
      if (!Array.isArray(keys)) fail('bad slice keys');
      return {
        id: str(s.id, 'slice id'),
        name: str(s.name, 'slice name'),
        keys: keys.map((k) => {
          if (!isRecord(k)) fail('bad slice key');
          const sk: Project['slices'][number]['keys'][number] = {
            frameId: str(k.frameId, 'slice key frameId'),
            x: bounded(k.x, 'slice key x', 1 << 20, -(1 << 20)),
            y: bounded(k.y, 'slice key y', 1 << 20, -(1 << 20)),
            width: bounded(k.width, 'slice key width', LIMITS.maxDim),
            height: bounded(k.height, 'slice key height', LIMITS.maxDim),
          };
          if (isRecord(k.center)) {
            sk.center = {
              x: bounded(k.center.x, 'center x', 1 << 20, -(1 << 20)),
              y: bounded(k.center.y, 'center y', 1 << 20, -(1 << 20)),
              width: bounded(k.center.width, 'center width', LIMITS.maxDim),
              height: bounded(k.center.height, 'center height', LIMITS.maxDim),
            };
          }
          if (isRecord(k.pivot)) {
            sk.pivot = {
              x: bounded(k.pivot.x, 'pivot x', 1 << 20, -(1 << 20)),
              y: bounded(k.pivot.y, 'pivot y', 1 << 20, -(1 << 20)),
            };
          }
          return sk;
        }),
      };
    }),
    tilesets: tilesetsArr.map((t) => {
      if (!isRecord(t)) fail('bad tileset');
      const tiles = t.tiles;
      if (!Array.isArray(tiles)) fail('bad tileset tiles');
      return {
        id: str(t.id, 'tileset id'),
        name: str(t.name, 'tileset name'),
        width: bounded(t.width, 'tileset width', LIMITS.maxDim, 1),
        height: bounded(t.height, 'tileset height', LIMITS.maxDim, 1),
        tiles: tiles.map((im) => {
          if (!isRecord(im)) fail('bad tile image');
          const tw = bounded(im.width, 'tile width', LIMITS.maxDim, 1);
          const th = bounded(im.height, 'tile height', LIMITS.maxDim, 1);
          const data = im.data;
          if (!(data instanceof Uint8Array)) fail('tile data must be Uint8Array');
          if (data.length !== tw * th * bytes) fail('tile data length mismatch');
          return { id: str(im.id, 'tile id'), width: tw, height: th, mode, data };
        }),
        baseIndex: bounded(t.baseIndex, 'tileset baseIndex', 0xffff),
      };
    }),
    tilemaps: tilemapsArr.map((m) => {
      if (!isRecord(m)) fail('bad tilemap');
      const cells = m.cells;
      if (!Array.isArray(cells)) fail('bad tilemap cells');
      return {
        id: str(m.id, 'tilemap id'),
        frameId: str(m.frameId, 'tilemap frameId'),
        layerId: str(m.layerId, 'tilemap layerId'),
        width: bounded(m.width, 'tilemap width', LIMITS.maxDim, 0),
        height: bounded(m.height, 'tilemap height', LIMITS.maxDim, 0),
        x: bounded(m.x, 'tilemap x', 1 << 20, -(1 << 20)),
        y: bounded(m.y, 'tilemap y', 1 << 20, -(1 << 20)),
        cells: cells.map((c) => {
          if (!isRecord(c)) fail('bad tile cell');
          return {
            tile: bounded(c.tile, 'cell tile', 0xffffffff),
            flipX: c.flipX === true,
            flipY: c.flipY === true,
            diagonal: c.diagonal === true,
          };
        }),
      };
    }),
    revision: bounded(o.revision, 'revision', 0xffffffff),
    diagnostics: Array.isArray(o.diagnostics)
      ? o.diagnostics.map((d) => {
          if (!isRecord(d)) fail('bad diagnostic');
          const severity = d.severity;
          if (severity !== 'warning' && severity !== 'error' && severity !== 'info') fail('bad diagnostic severity');
          return { code: str(d.code, 'diag code'), severity, message: str(d.message, 'diag message') };
        })
      : [],
  };
  return out;
}
