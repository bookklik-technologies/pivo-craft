// ASE (.ase/.aseprite) codec for PiVo Craft.
//
// Coverage (honest):
//  - 32/16/8 bpp (rgba/gray/indexed), layer hierarchy incl. groups, image + tilemap layers
//  - cels: raw (type 0), linked (type 1), compressed image (type 2), compressed tilemap (type 3)
//  - palettes (new 0x2019 + old 0x0004/0x0011 as fallback), palette delta application
//  - tags with per-tag user data (color), slices (9-patches + pivot), per-frame user data on sprite
//  - external files chunk parsed (palette/tileset/extension names)
//  - embedded tilesets (flag 2 = tiles inside file); external tilesets are reported as warnings
//  - unknown chunks are diagnosed as unmodeled; raw bytes are not preserved; writer BLOCKS
//    on error-level diagnostics so we never silently flatten or claim full support
//
// Not supported (diagnosed, never silently dropped):
//  - external-file palettes/tilesets (flag 1 tilesets), ICC color profiles other than sRGB/none
//  - user-data *properties* maps (extension properties) beyond tag color/text association
import type {
  Project, Layer, Cel, Frame, Tag, Slice, SliceKey, PaletteKey, TileSet, TileMap,
  ImageDataModel, Mode, RGBA, Direction, Diagnostic,
} from '../../core/src/index.ts';
import { uid,validateProject,paletteFor } from '../../core/src/index.ts';
import { ByteReader, ByteWriter, crc32 } from './bytes.ts';
import { MODE_BITS, diag } from './project.ts';
import { deflateSync, inflateReusable } from './zlib.ts';

const MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const HEADER_SIZE = 128;
const FRAME_HEADER_SIZE = 16;

const MAX_SPRITE_DIM = 65535;
const MAX_FRAMES = 8192;
const MAX_LAYERS = 1024;
const MAX_CELS_PER_FRAME = 4096;
const MAX_CHUNKS_PER_FRAME = 65535;
const MAX_PALETTE = 1024;
const MAX_TAGS = 4096;
const MAX_SLICES = 4096;
const MAX_TILES = 1 << 20;
const MAX_INFLATED_CEL = 1 << 26; // 64 MiB cap for a single cel's raw pixels
const MAX_ZLIB_RATIO = 4096; // decompression-bomb guard

enum ChunkType {
  OldPaletteA = 0x0004,
  OldPaletteB = 0x0011,
  Layer = 0x2004,
  Cel = 0x2005,
  CelExtra = 0x2006,
  ColorProfile = 0x2007,
  ExternalFiles = 0x2008,
  Mask = 0x2016,
  Path = 0x2017,
  Tags = 0x2018,
  Palette = 0x2019,
  UserData = 0x2020,
  Slice = 0x2022,
  Tileset = 0x2023,
}

const BLEND_MAP: Array<[number, Layer['blend']]> = [
  [0, 'normal'], [1, 'multiply'], [2, 'screen'], [3, 'overlay'], [4, 'darken'], [5, 'lighten'],
  [6, 'color-dodge'], [7, 'color-burn'], [8, 'hard-light'], [9, 'soft-light'], [10, 'difference'],
  [11, 'exclusion'], [12, 'hue'], [13, 'saturation'], [14, 'color'], [15, 'luminosity'],
  [16, 'addition'], [17, 'subtract'], [18, 'divide'],
];

function blendFromId(id: number): Layer['blend'] | null {
  for (const [n, b] of BLEND_MAP) if (n === id) return b;
  return null;
}

function blendToId(b: Layer['blend']): number | null {
  for (const [n, bb] of BLEND_MAP) if (bb === b) return n;
  return null;
}

const DIR_MAP: Record<number, Direction> = { 0: 'forward', 1: 'reverse', 2: 'pingpong', 3: 'pingpong-reverse' };
const DIR_TO_ID: Record<Direction, number> = { forward: 0, reverse: 1, pingpong: 2, 'pingpong-reverse': 3 };

export interface EncodeASEResult {
  bytes: Uint8Array;
  diagnostics: Diagnostic[];
}

interface AscLayer {
  layer: Layer;
  childLevel: number;
  flags: number;
  index: number;
}

interface AscCel {
  cel: Cel;
  layerIndex: number;
  image: ImageDataModel | null;
  linkedFrame: number | null;
  tilemap: TileMap | null;
  frameIndex: number;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function encodeASE(p: Project): EncodeASEResult {
  // Writer blocking: error-level diagnostics in the project mean lossy output is not proven safe.
  const blocked = p.diagnostics.filter((d) => d.severity === 'error');
  if (blocked.length > 0) {
    throw new Error(`encodeASE blocked by ${blocked.length} error-level project diagnostic(s): ${blocked[0].code} ${blocked[0].message}`);
  }

  validateProject(p);
  if(p.palette.length>1024||p.paletteKeys.some(k=>k.colors.length>1024))throw new Error('ASE supported palette limit is 1024 entries');
  if(p.cels.some(c=>p.layers.find(l=>l.id===c.layerId)?.kind==='group'))throw new Error('ASE group layers cannot own cels');
  if(p.frames.some(f=>!Number.isInteger(f.duration)||f.duration<1||f.duration>65535)||p.pixelRatio.some(v=>!Number.isInteger(v)||v<1||v>255))throw new Error('ASE duration or pixel ratio exceeds serialized fields');
  if(p.tags.some(t=>!Number.isInteger(t.repeat)||t.repeat<0||t.repeat>65535))throw new Error('ASE repeat count exceeds unsigned 16-bit field');
  for(const obj of [...p.layers,...p.tags,...p.slices,...p.tilesets])if(new TextEncoder().encode(obj.name).length>65535)throw new Error('ASE name exceeds UTF-8 length field');
  if(p.layers.some(l=>l.kind==='group'&&!l.isolated))throw new Error('ASE export cannot safely represent passthrough groups; isolate groups explicitly first');
  for(const c of p.cels)if(!Number.isInteger(c.x)||!Number.isInteger(c.y)||c.x<-32768||c.x>32767||c.y<-32768||c.y>32767||c.z<-32768||c.z>32767)throw new Error('ASE cel coordinates/z-order exceed signed 16-bit fields');
  const warnings: Diagnostic[] = [];
  const modeBits = MODE_BITS[p.mode];
  const frames = p.frames;

  // Plan layer order: ASE requires depth-first parent-before-child ordering.
  const layersByParent = new Map<string | null, Layer[]>();
  for (const l of p.layers) {
    const arr = layersByParent.get(l.parent) ?? [];
    arr.push(l);
    layersByParent.set(l.parent, arr);
  }
  const ordered: AscLayer[] = [];
  const walk = (parent: string | null): void => {
    const kids = layersByParent.get(parent) ?? [];
    for (const l of kids) {
      ordered.push({ layer: l, childLevel: depthOf(l), flags: 0, index: 0 });
      if (l.kind === 'group') walk(l.id);
    }
  };
  const depthOf = (l: Layer): number => {
    let d = 0;
    let cur: Layer | undefined = l;
    while (cur && cur.parent !== null) {
      cur = p.layers.find((x) => x.id === cur!.parent);
      d++;
      if (d > 128) break;
    }
    return d;
  };
  walk(null);
  ordered.forEach((a, i) => (a.index = i));

  const layerIndexById = new Map<string, number>();
  for (const a of ordered) layerIndexById.set(a.layer.id, a.index);

  // Cels grouped by frame. Tilemap layers synthesize a cel from their tilemap data when
  // the project has no explicit cel for that layer/frame.
  const celsByFrame = new Map<number, Cel[]>();
  for (const cel of p.cels) {
    const fi = frames.findIndex((f) => f.id === cel.frameId);
    if (fi < 0) {
      warnings.push(diag('ASE_CEL_ORPHAN', 'warning', `cel ${cel.id} references missing frame ${cel.frameId}; skipped`));
      continue;
    }
    const arr = celsByFrame.get(fi) ?? [];
    arr.push(cel);
    celsByFrame.set(fi, arr);
  }
  for (const layer of p.layers) {
    if (layer.kind !== 'tilemap') continue;
    for (let fi = 0; fi < frames.length; fi++) {
      const frameId = frames[fi]!.id;
      const hasCel = p.cels.some((c) => c.layerId === layer.id && c.frameId === frameId);
      if (hasCel) continue;
      const hasMap = p.tilemaps.some((m) => m.layerId === layer.id && m.frameId === frameId);
      if (!hasMap) continue;
      const arr = celsByFrame.get(fi) ?? [];
      arr.push({ id: uid(), frameId, layerId: layer.id, imageId: '', x: 0, y: 0, opacity: 255, z: 0 });
      celsByFrame.set(fi, arr);
    }
  }

  // Frame 1 carries: layers, palettes, tags, slices, external files, tilesets, sprite user data.
  // Other frames carry cels (+ any per-frame paletteKeys as palette deltas).
  const paletteForFrame = new Map<number, RGBA[]>();
  for (const pk of p.paletteKeys) {
    const fi = frames.findIndex((f) => f.id === pk.frameId);
    if (fi >= 0) paletteForFrame.set(fi, pk.colors);
  }

  const perFrameCunks: number[] = [];

  // Build chunk blobs per frame first so we can size frame headers.
  const frameBlobs: Uint8Array[] = frames.map(() => new Uint8Array(0));

  // --- frame 0 structural chunks ---
  const header = new ByteWriter();
  header.u32(0); // filesize patched later
  header.u16(MAGIC);
  header.u16(frames.length);
  header.u16(p.width);
  header.u16(p.height);
  header.u16(modeBits);
  const flags =
    1 | // Layer opacity has valid value
    2 | // blend/opacity valid for groups
    0; // no UUIDs (we don't need them; reduces interop risk)
  header.u32(flags);
  header.u16(frames[0]?.duration ?? 100); // deprecated speed field
  header.u32(0);
  header.u32(0);
  header.u8(p.transparentIndex & 0xff);
  header.raw(new Uint8Array(3));
  const numColors = p.mode === 'indexed' ? Math.max(p.palette.length, 1) : p.palette.length;
  header.u16(numColors === 256 ? 256 : numColors);
  header.u8(p.pixelRatio[0]);
  header.u8(p.pixelRatio[1]);
  header.i16(0); // grid x
  header.i16(0); // grid y
  header.u16(0); // grid w
  header.u16(0); // grid h
  header.raw(new Uint8Array(84));
  const headerBytes = header.toBytes();

  // Frame 0 chunks (chunk stream):
  const f0 = new ByteWriter();
  let chunkCount0 = 0;
  const chunkHeader = (w: ByteWriter, dataLen: number, type: number): void => {
    // chunk size includes the 6-byte header
    w.u32(dataLen + 6);
    w.u16(type);
  };

  // Layers
  for (const a of ordered) {
    const l = a.layer;
    const nameLen = new TextEncoder().encode(l.name).length;
    const body = 2 + 2 + 2 + 2 + 2 + 2 + 1 + 3 + (2 + nameLen) + (l.kind === 'tilemap' ? 4 : 0);
    chunkHeader(f0, body, ChunkType.Layer);
    chunkCount0++;
    let lf = 0;
    if (l.visible) lf |= 1;
    if (!l.locked) lf |= 2;
    if (l.locked) lf |= 4;
    if (l.background) lf |= 8;
    if (l.continuous) lf |= 16;
    if (l.kind === 'group') lf |= 32; // collapsed
    f0.u16(lf);
    f0.u16(l.kind === 'group' ? 1 : l.kind === 'tilemap' ? 2 : 0);
    f0.u16(a.childLevel);
    f0.u16(0); // default width (ignored)
    f0.u16(0); // default height (ignored)
    const bid = blendToId(l.blend);
    if (bid === null) {
      throw new Error(`layer ${l.id}: blend mode ${l.blend} has no ASE mapping`);
    }
    f0.u16(bid);
    f0.u8(l.opacity & 0xff);
    f0.raw(new Uint8Array(3));
    f0.string(l.name);
    if (l.kind === 'tilemap') {
      const tsIndex = p.tilesets.findIndex((t) => t.id === l.tilesetId);
      if (tsIndex < 0) throw new Error(`tilemap layer ${l.id} has no resolvable tileset`);
      f0.u32(tsIndex);
    }
  }

  // External files chunk (only if we have external references to declare: none today)
  // Palette chunk (frame 0 = full palette for indexed; optional otherwise)
  if (p.mode === 'indexed' || p.palette.length > 0) {
    const initial=paletteFor(p,frames[0].id);const colors = initial.length > 0 ? initial : [[0, 0, 0, 255] as RGBA];
    let body = 4 + 4 + 4 + 8;
    for (const _c of colors) body += 2 + 4;
    chunkHeader(f0, body, ChunkType.Palette);
    chunkCount0++;
    f0.u32(colors.length); // new palette size
    f0.u32(0); // first index
    f0.u32(colors.length - 1); // last index
    f0.raw(new Uint8Array(8));
    for (const c of colors) {
      f0.u16(0); // flags: no name
      f0.u8(c[0]);
      f0.u8(c[1]);
      f0.u8(c[2]);
      f0.u8(c[3]);
    }
  }

  // Sprite user data (v1.3 convention: a user data chunk right after palette on frame 0)
  {
    // We only write color/text-free user data (empty) to mark the sprite as v1.3-compatible.
    const body = 4;
    chunkHeader(f0, body, ChunkType.UserData);
    chunkCount0++;
    f0.u32(0); // flags: nothing set
  }

  // Tags (frame 0) with one user-data chunk per tag
  if (p.tags.length > 0) {
    let body = 2 + 8;
    for (const t of p.tags) body += 2 + 2 + 1 + 2 + 6 + 3 + 1 + (2 + new TextEncoder().encode(t.name).length);
    chunkHeader(f0, body, ChunkType.Tags);
    chunkCount0++;
    f0.u16(p.tags.length);
    f0.raw(new Uint8Array(8));
    for (const t of p.tags) {
      const from = frames.findIndex((f) => f.id === t.from);
      const to = frames.findIndex((f) => f.id === t.to);
      if (from < 0 || to < 0) throw new Error(`tag ${t.id} references missing frames`);
      f0.u16(from);
      f0.u16(to);
      f0.u8(DIR_TO_ID[t.direction]);
      f0.u16(t.repeat);
      f0.raw(new Uint8Array(6));
      f0.u8(t.color[0]); f0.u8(t.color[1]); f0.u8(t.color[2]); // deprecated RGB
      f0.u8(0); // extra byte
      f0.string(t.name);
    }
    // one user data chunk per tag carrying the RGBA color (spec: associate in order)
    for (const t of p.tags) {
      const body2 = 4 + 4;
      chunkHeader(f0, body2, ChunkType.UserData);
      chunkCount0++;
      f0.u32(2); // flags: has color
      f0.u8(t.color[0]); f0.u8(t.color[1]); f0.u8(t.color[2]); f0.u8(t.color[3]);
    }
  }

  // Slices (frame 0)
  for (const s of p.slices) {
    const nameLen = new TextEncoder().encode(s.name).length;
    let body = 4 + 4 + 4 + (2 + nameLen);
    let sflags = 0;
    for (const k of s.keys) {
      if (k.center) sflags |= 1;
      if (k.pivot) sflags |= 2;
    }
    for (const k of s.keys) {
      body += 4 + 4 + 4 + 4 + 4;
      if (k.center) body += 4 + 4 + 4 + 4;
      if (k.pivot) body += 4 + 4;
    }
    chunkHeader(f0, body, ChunkType.Slice);
    chunkCount0++;
    f0.u32(s.keys.length);
    f0.u32(sflags);
    f0.u32(0); // reserved
    f0.string(s.name);
    for (const k of s.keys) {
      const fi = frames.findIndex((f) => f.id === k.frameId);
      if (fi < 0) throw new Error(`slice ${s.id} key references missing frame ${k.frameId}`);
      f0.u32(fi);
      f0.i32(k.x);
      f0.i32(k.y);
      f0.u32(k.width);
      f0.u32(k.height);
      if (k.center) {
        f0.i32(k.center.x); f0.i32(k.center.y);
        f0.u32(k.center.width); f0.u32(k.center.height);
      }
      if (k.pivot) {
        f0.i32(k.pivot.x); f0.i32(k.pivot.y);
      }
    }
  }

  // Tilesets (frame 0): embedded tiles only
  for (const ts of p.tilesets) {
    const nameLen = new TextEncoder().encode(ts.name).length;
    const tileCount = ts.tiles.length;
    if (tileCount === 0) {
      warnings.push(diag('ASE_TILESET_EMPTY', 'warning', `tileset ${ts.id} has no tiles; skipped`));
      continue;
    }
    // Compose the tileset image: tileCount tiles stacked vertically.
    const imgW = ts.width;
    const imgH = ts.height * tileCount;
    const bppOf = p.mode === 'rgba' ? 4 : p.mode === 'gray' ? 2 : 1;
    const raw = new Uint8Array(imgW * imgH * bppOf);
    ts.tiles.forEach((tile, i) => {
      raw.set(tile.data.subarray(0, Math.min(tile.data.length, imgW * ts.height * bppOf)), i * imgW * ts.height * bppOf);
    });
    const compressed = deflateSync(raw);
    const body = 4 + 4 + 4 + 2 + 2 + 2 + 14 + (2 + nameLen) + 4 + compressed.length;
    chunkHeader(f0, body, ChunkType.Tileset);
    chunkCount0++;
    const tsId = p.tilesets.indexOf(ts);
    f0.u32(Number.isFinite(tsId) ? tsId : 0);
    f0.u32(2 | 4); // tiles inside this file; tile ID 0 is empty
    f0.u32(tileCount);
    f0.u16(ts.width);
    f0.u16(ts.height);
    f0.i16(ts.baseIndex);
    f0.raw(new Uint8Array(14));
    f0.string(ts.name);
    f0.u32(compressed.length);
    f0.raw(compressed);
  }

  perFrameCunks.push(chunkCount0);

  // Cels for each frame
  const frameIndices=new Map(frames.map((f,i)=>[f.id,i])),canonicalOrigins=new Map<string,Cel>();
  for(const c of p.cels){const key=JSON.stringify([c.layerId,c.imageId]),old=canonicalOrigins.get(key);if(!old||(frameIndices.get(c.frameId)??Infinity)<(frameIndices.get(old.frameId)??Infinity))canonicalOrigins.set(key,c);}
  const layersById=new Map(p.layers.map(l=>[l.id,l]));
  const celBlobs: Array<Array<Uint8Array>> = frames.map(() => []);
  for (const [fi, cels] of celsByFrame) {
    for (const cel of cels) {
      const li = layerIndexById.get(cel.layerId);
      if (li === undefined) {
        warnings.push(diag('ASE_CEL_ORPHAN_LAYER', 'warning', `cel ${cel.id} references missing layer ${cel.layerId}; skipped`));
        continue;
      }
      const layer = layersById.get(cel.layerId)!;
      const image = p.images[cel.imageId];
      const w = new ByteWriter();
      const namePrefix = 2 + 2 + 2 + 1 + 2 + 2 + 5; // through the reserved 5 bytes
      const sharedOrigin=image&&layer.kind==='image'?canonicalOrigins.get(JSON.stringify([cel.layerId,cel.imageId])):undefined;
      if (sharedOrigin && sharedOrigin.frameId !== cel.frameId || cel.linkId && image === undefined) {
        // linked cel: point at origin frame of the linked cel
        const origin = sharedOrigin ?? p.cels.find((c) => c.id === cel.linkId);
        if (!origin) {
          throw new Error('ASE linked cel origin is missing');
        }
        const originFrame = origin ? frames.findIndex((f) => f.id === origin.frameId) : 0;
        chunkHeader(w, namePrefix + 2, ChunkType.Cel);
        w.u16(li);
        w.i16(cel.x);
        w.i16(cel.y);
        w.u8(cel.opacity & 0xff);
        w.u16(1); // linked
        w.i16(cel.z);
        w.raw(new Uint8Array(5));
        w.u16(Math.max(0, originFrame));
        celBlobs[fi].push(w.toBytes());
        continue;
      }
      if (layer.kind === 'tilemap') {
        const tm = p.tilemaps.find((m) => m.layerId === layer.id && m.frameId === cel.frameId);
        if (!tm) {
          warnings.push(diag('ASE_TILEMAP_MISSING', 'warning', `tilemap cel ${cel.id} has no tilemap data; skipped`));
          continue;
        }
        const cellsRaw = new Uint8Array(tm.cells.length * 4);
        const dv = new DataView(cellsRaw.buffer);
        tm.cells.forEach((c, i) => {
          let v = c.tile & 0x1fffffff;
          if (c.flipX) v |= 1 << 29;
          if (c.flipY) v |= 1 << 30;
          if (c.diagonal) v |= 1 << 31;
          dv.setUint32(i * 4, v >>> 0, true);
        });
        const compressed = deflateSync(cellsRaw);
        const body = namePrefix + 2 + 2 + 2 + 4 * 4 + 10 + compressed.length;
        chunkHeader(w, body, ChunkType.Cel);
        w.u16(li);
        w.i16(cel.x);
        w.i16(cel.y);
        w.u8(cel.opacity & 0xff);
        w.u16(3); // compressed tilemap
        w.i16(cel.z);
        w.raw(new Uint8Array(5));
        w.u16(tm.width);
        w.u16(tm.height);
        w.u16(32); // bits per tile
        w.u32(0x1fffffff);
        w.u32(1 << 29);
        w.u32(1 << 30);
        w.u32(1 << 31);
        w.raw(new Uint8Array(10));
        w.raw(compressed);
        celBlobs[fi].push(w.toBytes());
        continue;
      }
      if (!image) {
        warnings.push(diag('ASE_CEL_NO_IMAGE', 'warning', `cel ${cel.id} references missing image ${cel.imageId}; skipped`));
        continue;
      }
      const compressed = deflateSync(image.data);
      const body = namePrefix + 2 + 2 + compressed.length;
      chunkHeader(w, body, ChunkType.Cel);
      w.u16(li);
      w.i16(cel.x);
      w.i16(cel.y);
      w.u8(cel.opacity & 0xff);
      w.u16(2); // compressed image
      w.i16(cel.z);
      w.raw(new Uint8Array(5));
      w.u16(image.width);
      w.u16(image.height);
      w.raw(compressed);
      celBlobs[fi].push(w.toBytes());
    }
  }

  // Compose frames. Frame 0 layout: frame header, then structural chunks (f0 stream),
  // then cels. Other frames: frame header, optional palette delta chunks, then cels.
  const extraChunkCounts: number[] = frames.map(() => 0);
  const frameWriters: ByteWriter[] = [];
  for (let fi = 0; fi < frames.length; fi++) {
    const fw = new ByteWriter();
    if (fi === 0) {
      fw.u32(0); // patch: frame size
      fw.u16(FRAME_MAGIC);
      fw.u16(0); // patch: old chunks field
      fw.u16(frames[0].duration);
      fw.raw(new Uint8Array(2));
      fw.u32(chunkCount0 + celBlobs[0].length);
      fw.raw(f0.toBytes());
      for (const b of celBlobs[0]) fw.raw(b);
      frameWriters.push(fw);
      continue;
    }
    const paletteChunks=new ByteWriter();let extraChunks=0;
    const current=paletteFor(p,frames[fi].id),previous=paletteFor(p,frames[fi-1].id);
    if(JSON.stringify(current)!==JSON.stringify(previous)){
      if(!current.length||current.length>1024)throw new Error('Palette changes need 1-1024 entries for ASE export');
      chunkHeader(paletteChunks,20+current.length*6,ChunkType.Palette);extraChunks=1;extraChunkCounts[fi]=1;
      paletteChunks.u32(current.length);paletteChunks.u32(0);paletteChunks.u32(current.length-1);paletteChunks.raw(new Uint8Array(8));
      for(const c of current){paletteChunks.u16(0);for(const value of c)paletteChunks.u8(value);}
    }
    fw.u32(0); // patch
    fw.u16(FRAME_MAGIC);
    fw.u16(0); // patch old field
    fw.u16(frames[fi].duration);
    fw.raw(new Uint8Array(2));
    fw.u32(extraChunks + celBlobs[fi].length);fw.raw(paletteChunks.toBytes());
    for (const b of celBlobs[fi]) fw.raw(b);
    frameWriters.push(fw);
  }

  // Patch frame sizes and old chunk-count fields
  const frame0Writer = frameWriters[0];
  {
    const size = FRAME_HEADER_SIZE + f0.length + celBlobs[0].reduce((n, b) => n + b.length, 0);
    frame0Writer.patchU32(0, size);
    const count0 = chunkCount0 + celBlobs[0].length;
    frame0Writer.patchU16(6, count0 > 0xffff ? 0xffff : count0);
  }
  for (let fi = 1; fi < frames.length; fi++) {
    const w = frameWriters[fi];
    const size = FRAME_HEADER_SIZE + w.length - FRAME_HEADER_SIZE;
    w.patchU32(0, size);
    const count = extraChunkCounts[fi] + celBlobs[fi].length;
    w.patchU16(6, count > 0xffff ? 0xffff : count);
  }

  // Assemble: header + frames; patch total size in header.
  const totalSize = HEADER_SIZE + frameWriters.reduce((n, w) => n + w.length, 0);
  const out = new ByteWriter();
  out.raw(headerBytes);
  out.patchU32(0, totalSize);
  for (const w of frameWriters) out.raw(w.toBytes());
  return { bytes: out.toBytes(), diagnostics: warnings };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface DecodeAcc {
  frames: Frame[];
  layers: AscLayer[];
  cels: AscCel[];
  palette: RGBA[];
  paletteKeys: PaletteKey[];
  tags: Tag[];
  tagUserColors: Array<RGBA | null>;
  pendingTags: Array<{ from: number; to: number; name: string; direction: Direction; repeat: number; rgb: [number, number, number] }>;
  slices: Slice[];
  tilesets: Array<{ id: number; name: string; width: number; height: number; baseIndex: number; tiles: ImageDataModel[];flags:number }>;
  externalFiles: Array<{ id: number; type: number; name: string }>;
  diagnostics: Diagnostic[];
  spriteUserData: { text: string | null; color: RGBA | null };
  width: number;
  height: number;
  mode: Mode;
  transparentIndex: number;
  pixelRatio: [number, number];
  speed: number;
  decodedBudget:number;
  tileCellBudget:number;
}

export function decodeASE(bytes: Uint8Array): Project {
  if (bytes.length < HEADER_SIZE || bytes.length>134217728) {
    throw new Error('aseprite file truncated (below minimum header size)');
  }
  const r = new ByteReader(bytes);
  const fileSize = r.u32();
  const magic = r.u16();
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)} (expected 0xa5e0)`);
  // size sanity: fileSize may be smaller than actual in some writers; require it not to exceed the buffer
  if (fileSize !== bytes.length) throw new Error(`header file size ${fileSize} exceeds buffer ${bytes.length}`);

  const numFrames = r.u16();if(numFrames<1||numFrames>4096)throw new Error('ASE frame count exceeds editable limits');
  const width = r.u16();
  const height = r.u16();
  const colorDepth = r.u16();
  if (width === 0 || height === 0 || width > 8192 || height > 8192 || width*height>16777216) {
    throw new Error(`bad sprite dimensions ${width}x${height}`);
  }
  const headerFlags = r.u32();
  const speed = r.u16();
  r.u32();
  r.u32();
  const transparentIndex = r.u8();
  r.bytesAt(3);
  const numColors = r.u16();
  const pixelWidth = r.u8();
  const pixelHeight = r.u8();
  r.i16(); r.i16(); r.u16(); r.u16();
  r.bytesAt(84);
  void numColors;

  const mode: Mode = colorDepth === 32 ? 'rgba' : colorDepth === 16 ? 'gray' : colorDepth === 8 ? 'indexed' : null as never;
  if (!mode) throw new Error(`unsupported color depth ${colorDepth}`);
  const bytesPP = mode === 'rgba' ? 4 : mode === 'gray' ? 2 : 1;
  const pixelRatio: [number, number] = pixelWidth === 0 || pixelHeight === 0 ? [1, 1] : [pixelWidth, pixelHeight];

  let hasModernPalette=false,scan=128;const scanView=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let n=0;n<numFrames&&!hasModernPalette;n++){if(scan+16>bytes.length)break;const end=scan+scanView.getUint32(scan,true);if(end>bytes.length||end<=scan+15)break;let at=scan+16,guard=0;while(at+6<=end&&guard++<65536){const size=scanView.getUint32(at,true);if(size<6||at+size>end)break;if(scanView.getUint16(at+4,true)===0x2019){hasModernPalette=true;break;}at+=size;}scan=end;}
  const allFrameIds=Array.from({length:numFrames},()=>uid());
  const acc: DecodeAcc = {
    frames: [], layers: [], cels: [], palette: [], paletteKeys: [], tags: [], tagUserColors: [], pendingTags: [],
    slices: [], tilesets: [], externalFiles: [], diagnostics: [],
    spriteUserData: { text: null, color: null },
    width, height, mode, transparentIndex, pixelRatio, speed,decodedBudget:0,tileCellBudget:0,
  };

  // Read frames
  let lastCel: AscCel | null = null;
  let lastLayer: AscLayer | null = null;
  let lastTileset: { tilesetIndex: number; pendingTileUserData: number } | null = null;
  let tagsPendingUserData = -1;

  for (let fi = 0; fi < numFrames; fi++) {
    if (!r.remaining(FRAME_HEADER_SIZE)) throw new Error(`frame ${fi}: truncated frame header`);
    const frameStart = r.position;
    const frameBytes = r.u32();
    const fmagic = r.u16();
    if (fmagic !== FRAME_MAGIC) throw new Error(`frame ${fi}: bad magic 0x${fmagic.toString(16)}`);
    if (frameBytes < FRAME_HEADER_SIZE || frameStart + frameBytes > bytes.length) {
      throw new Error(`frame ${fi}: bad frame size ${frameBytes}`);
    }
    const oldChunks = r.u16();
    const durationField = r.u16();const duration=durationField||speed||100;
    r.bytesAt(2);
    const newChunks = r.u32();
    const chunkCount = newChunks !== 0 ? newChunks : oldChunks;
    if (chunkCount > MAX_CHUNKS_PER_FRAME) throw new Error(`frame ${fi}: too many chunks ${chunkCount}`);
    acc.frames.push({ id: allFrameIds[fi], duration });
    if(!durationField&&!speed)acc.diagnostics.push(diag('ASE_ZERO_DURATION','error','Zero legacy/frame duration repaired to 100ms; strict rewrite blocked'));

    const frameEnd = frameStart + frameBytes;
    let chunksRead = 0,frameCelCount=0;
    while (r.position < frameEnd && chunksRead < chunkCount) {
      if (!r.remaining(6)) throw new Error(`frame ${fi} chunk ${chunksRead}: truncated chunk header`);
      const chunkStart = r.position;
      const chunkSize = r.u32();
      const chunkType = r.u16();
      if (chunkSize < 6 || chunkStart + chunkSize > frameEnd) {
        throw new Error(`frame ${fi} chunk ${chunksRead}: bad chunk size ${chunkSize}`);
      }
      const chunkEnd = chunkStart + chunkSize;
      const data = r.sliceTo(chunkEnd);
      const cr = new ByteReader(data);

      switch (chunkType as ChunkType) {
        case ChunkType.Layer: {
          const layer = readLayerChunk(cr, headerFlags, acc);
          lastLayer = layer;
          lastCel = null;
          break;
        }
        case ChunkType.Cel: {
          const cel = readCelChunk(cr, fi, acc, bytesPP);
          lastCel = cel;
          if (cel){if(acc.cels.length>=262144||++frameCelCount>4096)throw new Error('ASE cel count exceeds budget');acc.cels.push(cel);}
          break;
        }
        case ChunkType.CelExtra:
          acc.diagnostics.push(diag('ASE_PRECISE_BOUNDS','error','Precise cel geometry is not modeled; strict rewrite blocked'));
          break;
        case ChunkType.ColorProfile: {
          const type = cr.u16();
          const profileFlags=cr.u16(),gamma=cr.fixed();if(type>2||profileFlags&1)acc.diagnostics.push(diag('ASE_PROFILE_UNMODELED','error','Profile/gamma interpretation is not fully supported'));
          cr.bytesAt(8);
          if (type === 2) {
            const len = cr.u32();
            cr.bytesAt(len);
            acc.diagnostics.push(diag('ASE_ICC_IGNORED', 'error', 'embedded ICC color profile ignored; colors treated as-is'));
          }
          break;
        }
        case ChunkType.ExternalFiles: {
          const count = cr.u32();if(count>4096)throw new Error('Too many ASE external references');
          acc.diagnostics.push(diag('ASE_EXTERNAL_METADATA','error','External references cannot be safely rewritten'));
          cr.bytesAt(8);
          for (let i = 0; i < count; i++) {
            const id = cr.u32();
            const t = cr.u8();
            cr.bytesAt(7);
            const name = cr.string();
            acc.externalFiles.push({ id, type: t, name });
          }
          break;
        }
        case ChunkType.Mask:
          acc.diagnostics.push(diag('ASE_MASK_DROPPED','error','Legacy mask is not preserved')); 
          break;
        case ChunkType.Path:
          acc.diagnostics.push(diag('ASE_PATH_UNSUPPORTED','error','Path chunk is not modeled'));break;
        case ChunkType.Tags: {
          if(acc.pendingTags.length)throw new Error('Repeated ASE tag chunks are not supported');readTagsChunk(cr, acc);
          tagsPendingUserData = acc.pendingTags.length;
          lastCel = null;
          break;
        }
        case ChunkType.Palette: {
          readPaletteChunk(cr, acc, fi);lastCel=null;lastLayer=null;lastTileset=null;tagsPendingUserData=-1;
          break;
        }
        case ChunkType.OldPaletteA:
        case ChunkType.OldPaletteB: {
          // only applies if no new palette chunk has been seen
          if(!hasModernPalette){readOldPaletteChunk(cr,acc,chunkType as ChunkType);if(fi>0)acc.paletteKeys.push({frameId:allFrameIds[fi],colors:acc.palette.map(c=>[...c] as RGBA)});}
          break;
        }
        case ChunkType.UserData: {
          readUserDataChunk(cr, acc, { lastCel, lastLayer, lastTileset, tagsPendingUserData });
          if (tagsPendingUserData > 0) {
            tagsPendingUserData--;
            if (tagsPendingUserData === 0) tagsPendingUserData = -1;
          }
          break;
        }
        case ChunkType.Slice: {
          readSliceChunk(cr, acc);
          break;
        }
        case ChunkType.Tileset: {
          const tsIndex = readTilesetChunk(cr, acc, bytesPP);
          lastTileset = tsIndex >= 0 ? { tilesetIndex: tsIndex, pendingTileUserData: 0 } : null;
          break;
        }
        default:
          // Unknown chunk: retain honestly as a diagnostic (not silently dropped)
          acc.diagnostics.push(diag('ASE_UNKNOWN_CHUNK', 'error', `frame ${fi}: unhandled chunk type 0x${chunkType.toString(16)} (${chunkSize} bytes) skipped`));
          lastCel=null;lastLayer=null;lastTileset=null;tagsPendingUserData=-1;break;
      }
      r.seek(chunkEnd);
      chunksRead++;
    }
    if(chunksRead!==chunkCount||r.position!==frameEnd)throw new Error('ASE frame chunk count/size mismatch');
    r.seek(frameEnd);
    if(fi===0)acc.paletteKeys.unshift({frameId:allFrameIds[0],colors:acc.palette.map(c=>[...c] as RGBA)});
  }

  if(r.position!==bytes.length)throw new Error('ASE trailing data after declared frames');
  for(const slice of acc.slices)for(const key of slice.keys){const index=Number(key.frameId.slice(6));if(!Number.isInteger(index)||index>=numFrames)throw new Error('ASE slice frame outside document');key.frameId=allFrameIds[index];}
  return assemble(acc);
}

function readLayerChunk(cr: ByteReader, headerFlags: number, acc: DecodeAcc): AscLayer {
  const flags = cr.u16();
  const type = cr.u16();
  const childLevel = cr.u16();
  cr.u16();
  cr.u16();
  const blendId = cr.u16();
  const opacity = cr.u8();
  cr.bytesAt(3);
  const name = cr.string();
  let tilesetId: string | undefined;
  if (type === 2) {
    const idx = cr.u32();
    tilesetId = `ts${idx}`;
  }
  if(acc.layers.length>=1024||childLevel>64||type>2)throw new Error('Unsupported/excessive ASE layer structure');
  if(headerFlags&4){cr.bytesAt(16);acc.diagnostics.push(diag('ASE_UUID_UNMODELED','error','Layer UUID metadata is not preserved'));}
  if(flags&64)acc.diagnostics.push(diag('ASE_REFERENCE_LAYER','error','Reference layer semantics are not modeled'));
  if(flags&4&&flags&2)acc.diagnostics.push(diag('ASE_MOVEMENT_LOCK','error','Separate movement lock is not modeled'));
  const kind: Layer['kind'] = type === 1 ? 'group' : type === 2 ? 'tilemap' : 'image';
  const blend = blendFromId(blendId);
  if (blend === null) {
    acc.diagnostics.push(diag('ASE_BLEND_UNKNOWN', 'error', `layer ${name}: unknown blend mode ${blendId}; treating as normal`));
  }
  const layer: Layer = {
    id: uid(),
    name,
    kind,
    visible: (flags & 1) !== 0,
    locked: (flags & 2) === 0 || (flags & 4)!==0,
    opacity: kind==='group'?(headerFlags&2?opacity:255):(headerFlags&1?opacity:255),
    blend: blend ?? 'normal',
    continuous: (flags & 16) !== 0,
    background: (flags & 8) !== 0,
    parent: null,
    isolated: kind==='group'&&!!(headerFlags&2),
    ...(tilesetId ? { tilesetId } : {}),
  };
  // resolve parent from child level via stack of previously read layers
  const stack: AscLayer[] = [];
  for (const a of acc.layers) {
    if (a.childLevel >= childLevel) stack.length = 0;
    else stack.push(a);
  }
  // simplest correct approach: find nearest previous layer with childLevel = childLevel-1
  for (let i = acc.layers.length - 1; i >= 0; i--) {
    if (acc.layers[i].childLevel === childLevel - 1) {
      layer.parent = acc.layers[i].layer.id;
      break;
    }
    if (acc.layers[i].childLevel < childLevel - 1) break;
  }
  if(childLevel>0&&(!layer.parent||acc.layers.find(l=>l.layer.id===layer.parent)?.layer.kind!=='group'))throw new Error('Invalid ASE layer hierarchy');
  const asc: AscLayer = { layer, childLevel, flags, index: acc.layers.length };
  acc.layers.push(asc);
  return asc;
}

function decompressCapped(data: Uint8Array, expected: number, what: string): Uint8Array {
  if (expected > MAX_INFLATED_CEL) throw new Error(`${what}: expected size ${expected} exceeds cap`);
  const out = inflateReusable(data, expected, MAX_ZLIB_RATIO);
  return out;
}

function readCelChunk(cr: ByteReader, frameIndex: number, acc: DecodeAcc, bytesPP: number): AscCel | null {
  const layerIndex = cr.u16();
  const x = cr.i16();
  const y = cr.i16();
  const opacity = cr.u8();
  const celType = cr.u16();
  const z = cr.i16();
  cr.bytesAt(5);

  if (layerIndex >= acc.layers.length) {
    throw new Error('ASE cel references an unknown layer');
  }
  const ascLayer = acc.layers[layerIndex];if(ascLayer.layer.kind==='group')throw new Error('ASE group layers cannot contain cels');if((celType===3)!==(ascLayer.layer.kind==='tilemap')&&celType!==1)throw new Error('ASE cel type does not match layer kind');

  if (celType === 1) {
    const linkedFrame = cr.u16();
    const cel: Cel = {
      id: uid(), frameId: acc.frames[frameIndex].id, layerId: ascLayer.layer.id,
      imageId: '', x, y, opacity, z, linkId: undefined,
    };
    const asc: AscCel = { cel, layerIndex, image: null, linkedFrame, tilemap: null, frameIndex };
    // link resolution in assemble()
    return asc;
  }
  if (celType === 0 || celType === 2) {
    const w = cr.u16();
    const h = cr.u16();
    const expected = w * h * bytesPP;if(!w||!h||w>8192||h>8192||expected>MAX_INFLATED_CEL)throw new Error('ASE cel dimensions exceed limits');
    acc.decodedBudget+=expected;if(acc.decodedBudget>268435456)throw new Error('ASE decoded raster budget exceeded');
    let raw: Uint8Array;
    if (celType === 2) {
      raw = decompressCapped(cr.bytesAt(cr.bytes.length - cr.position), expected, `cel ${layerIndex}/${frameIndex}`);
    } else {
      raw = cr.bytesAt(expected);
    }
    const img: ImageDataModel = { id: uid(), width: w, height: h, mode: acc.mode, data: raw };
    const cel: Cel = {
      id: uid(), frameId: acc.frames[frameIndex].id, layerId: ascLayer.layer.id,
      imageId: img.id, x, y, opacity, z,
    };
    return { cel, layerIndex, image: img, linkedFrame: null, tilemap: null, frameIndex };
  }
  if (celType === 3) {
    const tw = cr.u16();
    const th = cr.u16();
    const bitsPerTile = cr.u16();
    if (bitsPerTile !== 32) {
      throw new Error('Only 32-bit ASE tilemaps are currently supported');
    }
    const maskTile = cr.u32();
    const maskX = cr.u32();
    const maskY = cr.u32();
    const maskD = cr.u32();
    cr.bytesAt(10);
    if(!tw||!th||tw*th>1048576)throw new Error('ASE tile grid exceeds limits');
    const count = tw * th;acc.tileCellBudget+=count;if(acc.tileCellBudget>1048576)throw new Error('ASE total tile-cell budget exceeded');
    const expected = count * 4;
    const compressed = cr.bytesAt(cr.bytes.length - cr.position);
    const raw = decompressCapped(compressed, expected, `tilemap ${layerIndex}/${frameIndex}`);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if(!maskTile||(maskTile&(maskX|maskY|maskD))||(maskX&maskY)||(maskX&maskD)||(maskY&maskD))throw new Error('ASE tile masks overlap');
    const cells: TileMap['cells'] = [];
    for (let i = 0; i < count; i++) {
      const v = dv.getUint32(i * 4, true);
      cells.push({
        tile: v===0xffffffff?0xffffffff:(v & maskTile)>>>0,
        flipX: (v & maskX) !== 0,
        flipY: (v & maskY) !== 0,
        diagonal: (v & maskD) !== 0,
      });
    }
    const tilemap: TileMap = {
      id: uid(), frameId: acc.frames[frameIndex].id, layerId: ascLayer.layer.id,
      width: tw, height: th, x, y, cells,
    };
    // tilemap cels need a placeholder cel for stacking; imageId empty
    const cel: Cel = {
      id: uid(), frameId: acc.frames[frameIndex].id, layerId: ascLayer.layer.id,
      imageId: '', x, y, opacity, z,
    };
    return { cel, layerIndex, image: null, linkedFrame: null, tilemap, frameIndex };
  }
  acc.diagnostics.push(diag('ASE_CEL_UNKNOWN_TYPE', 'error', `frame ${frameIndex}: unknown cel type ${celType}; skipped`));
  return null;
}

function readTagsChunk(cr: ByteReader, acc: DecodeAcc): void {
  const count = cr.u16();
  if (count > MAX_TAGS) throw new Error(`too many tags: ${count}`);
  cr.bytesAt(8);
  for (let i = 0; i < count; i++) {
    const from = cr.u16();
    const to = cr.u16();
    const dirId = cr.u8();
    const repeat = cr.u16();
    cr.bytesAt(6);
    const r8 = cr.u8();
    const g8 = cr.u8();
    const b8 = cr.u8();
    const extra = cr.u8();
    void extra;
    const name = cr.string();
    if(!DIR_MAP[dirId])throw new Error('Unknown ASE tag direction');const direction = DIR_MAP[dirId];
    // Frame ids resolved after all frames are read (tags appear in frame 0 but may
    // reference later frames). Store indices temporarily in `pendingTags`.
    acc.pendingTags.push({ from, to, name, direction, repeat, rgb: [r8, g8, b8] });
  }
}

function readPaletteChunk(cr: ByteReader, acc: DecodeAcc, frameIndex: number): void {
  const newSize = cr.u32();
  const from = cr.u32();
  const to = cr.u32();
  cr.bytesAt(8);
  if (newSize > MAX_PALETTE) throw new Error(`palette too large: ${newSize}`);
  if (to < from || to >= newSize) throw new Error(`bad palette range ${from}..${to} of ${newSize}`);
  // grow palette to newSize with default
  while (acc.palette.length < newSize) acc.palette.push([0, 0, 0, 255]);
  if (acc.palette.length > newSize) acc.palette.length = newSize;
  const count = to - from + 1;
  for (let i = 0; i < count; i++) {
    const flags = cr.u16();
    const r8 = cr.u8();
    const g8 = cr.u8();
    const b8 = cr.u8();
    const a8 = cr.u8();
    if (flags & 1){cr.string();acc.diagnostics.push(diag('ASE_PALETTE_NAMES','error','Palette names are not modeled'));}
    acc.palette[from + i] = [r8, g8, b8, a8];
  }
  // per-frame palette delta
  if (frameIndex > 0) {
    acc.paletteKeys.push({ frameId: acc.frames[frameIndex].id, colors: acc.palette.map((c) => [c[0], c[1], c[2], c[3]] as RGBA) });
  }
}

function readOldPaletteChunk(cr: ByteReader, acc: DecodeAcc, type: ChunkType): void {
  const packets = cr.u16();
  const scale = type === ChunkType.OldPaletteB ? 255 / 63 : 1;
  let idx = 0;
  for (let p = 0; p < packets; p++) {
    if (!cr.remaining(2)) break;
    const skip = cr.u8();
    const rawCount = cr.u8();
    const count = rawCount === 0 ? 256 : rawCount;
    idx += skip;
    for (let i = 0; i < count && idx < MAX_PALETTE; i++) {
      if (!cr.remaining(3)) break;
      const r8 = cr.u8();
      const g8 = cr.u8();
      const b8 = cr.u8();
      while (acc.palette.length <= idx) acc.palette.push([0, 0, 0, 255]);
      acc.palette[idx] = [
        Math.min(255, Math.round(r8 * scale)),
        Math.min(255, Math.round(g8 * scale)),
        Math.min(255, Math.round(b8 * scale)),
        255,
      ];
      idx++;
    }
  }
}

interface UserDataCtx {
  lastCel: AscCel | null;
  lastLayer: AscLayer | null;
  lastTileset: { tilesetIndex: number; pendingTileUserData: number } | null;
  tagsPendingUserData: number;
}

function readUserDataChunk(cr: ByteReader, acc: DecodeAcc, ctx: UserDataCtx): void {
  const flags = cr.u32();
  let text: string | null = null;
  let color: RGBA | null = null;
  if (flags & 1) text = cr.string();
  if (flags & 2) {
    const r8 = cr.u8(); const g8 = cr.u8(); const b8 = cr.u8(); const a8 = cr.u8();
    color = [r8, g8, b8, a8];
  }
  if(flags&4){cr.bytesAt(cr.bytes.length-cr.position);acc.diagnostics.push(diag('ASE_USERDATA_PROPERTIES_DROPPED','error','Unsupported property maps skipped without recursive allocation; strict rewrite blocked'));}
  // association, per spec:
  if (ctx.tagsPendingUserData > 0) {
    const tagIndex = acc.pendingTags.length - ctx.tagsPendingUserData;
    const pending = acc.pendingTags[tagIndex];
    if (pending) {
      acc.tagUserColors[tagIndex] = color;
      if (text) acc.diagnostics.push(diag('ASE_TAG_TEXT_DROPPED', 'error', `tag ${pending.name}: user text not modeled`));
    }
    return;
  }
  if (ctx.lastCel && ctx.lastCel.cel) {
    // cel user data: color/text not part of the Project cel model — note it
    if (color || text) {
      acc.diagnostics.push(diag('ASE_CEL_USERDATA_DROPPED', 'error', 'cel user data (color/text) not modeled'));
    }
    return;
  }
  if (ctx.lastLayer) {
    if (color || text) {
      acc.diagnostics.push(diag('ASE_LAYER_USERDATA_DROPPED', 'error', `layer ${ctx.lastLayer.layer.name}: user data not modeled`));
    }
    return;
  }
  // sprite user data (first frame after palette)
  acc.spriteUserData = { text, color };if(text||color)acc.diagnostics.push(diag('ASE_USERDATA_OWNER_UNMODELED','error','Sprite/unknown-owner metadata is not modeled')); 
}

function skipPropertyValue(cr: ByteReader, type: number): void {
  switch (type) {
    case 0x0001: case 0x0002: case 0x0003: cr.u8(); break;
    case 0x0004: case 0x0005: cr.u16(); break;
    case 0x0006: case 0x0007: case 0x000a: case 0x000b: cr.u32(); break;
    case 0x0008: case 0x0009: case 0x000c: cr.u64(); break;
    case 0x000d: cr.string(); break;
    case 0x000e: cr.u32(); cr.u32(); break;
    case 0x000f: cr.u32(); cr.u32(); break;
    case 0x0010: cr.u32(); cr.u32(); cr.u32(); cr.u32(); break;
    case 0x0011: {
      const n = cr.u32();
      if (n > 1 << 20) throw new Error('vector property too large');
      const etype = cr.u16();
      for (let i = 0; i < n; i++) {
        if (etype === 0) {
          const et = cr.u16();
          skipPropertyValue(cr, et);
        } else {
          skipPropertyValue(cr, etype);
        }
      }
      break;
    }
    case 0x0012: {
      const n = cr.u32();
      if (n > 1 << 16) throw new Error('nested properties too large');
      for (let i = 0; i < n; i++) {
        cr.string();
        const t = cr.u16();
        skipPropertyValue(cr, t);
      }
      break;
    }
    case 0x0013: cr.bytesAt(16); break;
    default: throw new Error(`unknown property value type 0x${type.toString(16)}`);
  }
}

function readSliceChunk(cr: ByteReader, acc: DecodeAcc): void {
  const keyCount = cr.u32();
  if (keyCount > 65536) throw new Error(`too many slice keys: ${keyCount}`);
  const flags = cr.u32();
  cr.u32();
  const name = cr.string();
  const keys: SliceKey[] = [];
  for (let i = 0; i < keyCount; i++) {
    const frameNum = cr.u32();
    const x = cr.i32();
    const y = cr.i32();
    const w = cr.u32();
    const h = cr.u32();
    const frameId = 'frame:'+frameNum;
    const key: SliceKey = { frameId, x, y, width: w, height: h };
    if (flags & 1) {
      const cx = cr.i32(); const cy = cr.i32(); const cw = cr.u32(); const ch = cr.u32();
      key.center = { x: cx, y: cy, width: cw, height: ch };
    }
    if (flags & 2) {
      const px = cr.i32(); const py = cr.i32();
      key.pivot = { x: px, y: py };
    }
    keys.push(key);
  }
  acc.slices.push({ id: uid(), name, keys });
}

function readTilesetChunk(cr: ByteReader, acc: DecodeAcc, bytesPP: number): number {
  const id = cr.u32();
  const flags = cr.u32();
  const tileCount = cr.u32();
  if (tileCount > MAX_TILES) throw new Error(`too many tiles: ${tileCount}`);
  const tw = cr.u16();
  const th = cr.u16();
  const baseIndex = cr.i16();
  cr.bytesAt(14);
  const name = cr.string();
  if (flags & 1) {
    cr.u32(); cr.u32();
    acc.diagnostics.push(diag('ASE_TILESET_EXTERNAL', 'error', `tileset ${name}: external tileset link not supported; tiles unavailable`));
    return -1;
  }
  if (!(flags & 2)) {
    acc.diagnostics.push(diag('ASE_TILESET_NO_TILES', 'error', `tileset ${name}: no embedded tile image data`));
    return -1;
  }
  const dataLen = cr.u32();
  if (tw === 0 || th === 0 || tileCount === 0) {
    acc.diagnostics.push(diag('ASE_TILESET_BAD_DIMS', 'warning', `tileset ${name}: zero dimensions; skipped`));
    cr.bytesAt(cr.bytes.length - cr.position);
    return -1;
  }
  const expected = tw * (th * tileCount) * bytesPP;
  acc.decodedBudget+=expected;if(acc.decodedBudget>268435456)throw new Error('ASE tileset decoded budget exceeded');
  const raw = decompressCapped(cr.bytesAt(dataLen), expected, `tileset ${name}`);
  const tiles: ImageDataModel[] = [];
  for (let i = 0; i < tileCount; i++) {
    const off = i * tw * th * bytesPP;
    tiles.push({
      id: uid(), width: tw, height: th, mode: acc.mode,
      data: raw.slice(off, off + tw * th * bytesPP),
    });
  }
  acc.tilesets.push({ id, name, width: tw, height: th, baseIndex, tiles,flags });
  return acc.tilesets.length - 1;
}

function assemble(acc: DecodeAcc): Project {
  // Resolve linked cels: point at the image of the origin cel (recursively).
  const byFrameLayer = new Map<string, AscCel>();
  for(const c of acc.cels){const key=`${c.frameIndex}:${c.layerIndex}`;if(byFrameLayer.has(key))throw new Error('Duplicate ASE cel in one layer/frame');byFrameLayer.set(key,c);}
  const resolved=new Map<AscCel,AscCel>();
  for (const c of acc.cels) {
    if (c.linkedFrame === null) continue;
    let origin = c;const chain:AscCel[]=[];
    const seen = new Set<number>();
    while (origin.linkedFrame !== null && !seen.has(origin.frameIndex)) {
      if(resolved.has(origin)){origin=resolved.get(origin)!;break;}chain.push(origin);
      seen.add(origin.frameIndex);
      const next = byFrameLayer.get(`${origin.linkedFrame}:${origin.layerIndex}`);
      if (!next) {
        throw new Error('ASE linked cel target is missing');
      }
      origin = next;
    }
    if(origin.linkedFrame!==null)throw new Error('ASE linked cel cycle');for(const node of chain)resolved.set(node,origin);
    if(origin.tilemap){c.tilemap={...origin.tilemap,id:uid(),frameId:c.cel.frameId,x:c.cel.x,y:c.cel.y,cells:origin.tilemap.cells.map(cell=>({...cell}))};acc.diagnostics.push(diag('ASE_TILE_LINK_UNMODELED','error','Tilemap link editing semantics are not preserved'));}
    if (origin.image) {
      c.cel.linkId = origin.cel.id;
      c.cel.imageId = origin.image.id;
      c.image = origin.image;
    }
  }

  const images: Record<string, ImageDataModel> = {};
  for (const c of acc.cels) {
    if (c.image) images[c.image.id] = c.image;
  }

  // Palette: indexed requires one; others get it if present
  const palette = acc.palette.length > 0 ? acc.palette : [];
  if (acc.mode === 'indexed' && palette.length === 0) {
    acc.diagnostics.push(diag('ASE_NO_PALETTE', 'warning', 'indexed sprite has no palette chunk; empty palette'));
  }

  // paletteKeys for frame 0 (base) when per-frame deltas exist
  const paletteKeys: PaletteKey[] = [];
  if (acc.paletteKeys.length > 0) {
    // Base palette snapshot was captured after frame zero, not after all later deltas.
    for (const pk of acc.paletteKeys) paletteKeys.push(pk);
  }

  const tilesets: TileSet[] = acc.tilesets.map((t,i) => ({
    id: `ts${i}`, name: t.name, width: t.width, height: t.height, tiles: t.tiles, baseIndex: t.baseIndex,
  }));

  for(const c of acc.cels){if(!c.tilemap)continue;const layer=acc.layers[c.layerIndex].layer,tsIndex=Number(layer.tilesetId?.slice(2)),ts=tilesets[tsIndex],source=acc.tilesets[tsIndex];if(!ts)throw new Error('ASE tilemap has an unresolved tileset');
    if(!(source.flags&4)){if(!source.tiles.length)throw new Error('Empty legacy tileset');const blank={id:uid(),width:ts.width,height:ts.height,mode:acc.mode,data:new Uint8Array(ts.width*ts.height*({rgba:4,gray:2,indexed:1}[acc.mode]))};if(acc.mode==='indexed')blank.data.fill(acc.transparentIndex);if(!('__normalized' in source)){ts.tiles=[blank,...ts.tiles];Object.assign(source,{__normalized:true});}for(const cell of c.tilemap.cells)cell.tile=cell.tile===0xffffffff?0:cell.tile+1;}
    for(const cell of c.tilemap.cells)if(cell.tile!==0&&cell.diagonal&&ts.width!==ts.height)throw new Error('Non-square diagonal ASE tile transform is unsupported');
    for(const cell of c.tilemap.cells)if(cell.tile<0||cell.tile>=ts.tiles.length)throw new Error('ASE tile index outside tileset');const dummy:ImageDataModel={id:uid(),width:1,height:1,mode:acc.mode,data:new Uint8Array({rgba:4,gray:2,indexed:1}[acc.mode])};images[dummy.id]=dummy;c.cel.imageId=dummy.id;
  }
  // Content sharing and placement linking are different. Equal-origin imported
  // cels form editor placement groups; differing origins keep independent placement.
  const placementGroups=new Map<string,Cel[]>();
  for(const c of acc.cels){if(c.tilemap)continue;const key=JSON.stringify([c.cel.layerId,c.cel.imageId,c.cel.x,c.cel.y]);const group=placementGroups.get(key)??[];group.push(c.cel);placementGroups.set(key,group);c.cel.linkId=undefined;}
  for(const group of placementGroups.values())if(group.length>1){const id=uid();for(const cel of group)cel.linkId=id;}
  let decodedBytes=0;for(const im of Object.values(images))decodedBytes+=im.data.byteLength;for(const ts of tilesets)for(const tile of ts.tiles)decodedBytes+=tile.data.byteLength;if(decodedBytes>268435456)throw new Error('ASE total decoded raster budget exceeded');
  const project: Project = {
    version: 1,
    id: uid(),
    name: 'imported-aseprite',
    width: acc.width,
    height: acc.height,
    mode: acc.mode,
    transparentIndex: acc.transparentIndex,
    pixelRatio: acc.pixelRatio,
    frames: acc.frames,
    layers: acc.layers.map((a) => a.layer),
    images,
    cels: acc.cels.map((c) => c.cel),
    palette,
    paletteKeys,
    tags: acc.pendingTags.map((pt, i) => ({
      id: uid(),
      name: pt.name,
      from: acc.frames[pt.from]?.id ?? acc.frames[0].id,
      to: acc.frames[pt.to]?.id ?? acc.frames[0].id,
      direction: pt.direction,
      repeat: pt.repeat,
      color: acc.tagUserColors[i] ?? [pt.rgb[0], pt.rgb[1], pt.rgb[2], 255],
    })),
    slices: acc.slices,
    tilesets,
    tilemaps: acc.cels.filter((c) => c.tilemap).map((c) => c.tilemap!),
    revision: 1,
    diagnostics: acc.diagnostics,
  };
  if(acc.pendingTags.some(t=>t.from>t.to||t.from<0||t.to>=acc.frames.length))throw new Error('ASE tag range outside frames');
  return project;
}

export { MAGIC as ASE_MAGIC, FRAME_MAGIC as ASE_FRAME_MAGIC };
