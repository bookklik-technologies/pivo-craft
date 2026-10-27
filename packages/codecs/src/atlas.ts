// Atlas builder: trims, dedupes, and packs frames into a single RGBA buffer.
// Packed layout is a shelf packer (rows sorted by height) — deterministic and dependency-free.
import type { Project, AtlasOptions, AtlasResult, AtlasRecord, RGBA } from '../../core/src/index.ts';
import { uid, renderFrame } from '../../core/src/index.ts';
import { imageHash, diag } from './project.ts';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface WorkFrame {
  record: AtlasRecord;
  pixels: Uint8Array; // RGBA
  w: number;
  h: number;
}

function frameRGBA(p: Project, frameId: string): Uint8Array { return renderFrame(p,frameId); }

function trimRGBA(pixels: Uint8Array, w: number, h: number): { pixels: Uint8Array; w: number; h: number; offsetX: number; offsetY: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // fully transparent
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    out.set(pixels.subarray(((minY + y) * w + minX) * 4, ((minY + y) * w + maxX + 1) * 4), y * tw * 4);
  }
  return { pixels: out, w: tw, h: th, offsetX: minX, offsetY: minY };
}

/** Shelf packer. Returns per-frame placements. */
function shelfPack(frames: Array<{ w: number; h: number }>, columns: number, padding: number, layout: AtlasOptions['layout']): Array<{ x: number; y: number }> {
  const placements: Array<{ x: number; y: number }> = frames.map(() => ({ x: 0, y: 0 }));
  if (layout === 'horizontal') {
    let x = padding;
    for (let i = 0; i < frames.length; i++) {
      placements[i] = { x, y: padding };
      x += frames[i].w + padding;
    }
    return placements;
  }
  if (layout === 'vertical') {
    let y = padding;
    for (let i = 0; i < frames.length; i++) {
      placements[i] = { x: padding, y };
      y += frames[i].h + padding;
    }
    return placements;
  }
  if (layout === 'grid') {
    const cols = Math.max(1, columns);
    let maxW = 0;
    let maxH = 0;
    for (const f of frames) {
      if (f.w > maxW) maxW = f.w;
      if (f.h > maxH) maxH = f.h;
    }
    for (let i = 0; i < frames.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements[i] = { x: padding + col * (maxW + padding), y: padding + row * (maxH + padding) };
    }
    return placements;
  }
  // packed: shelf packing with height-sorted rows (stable: sort by index for determinism)
  const order = frames.map((f, i) => ({ i, f })).sort((a, b) => b.f.h - a.f.h || a.i - b.i);
  let x = padding;
  let y = padding;
  let rowH = 0;
  for (const { i, f } of order) {
    if (x + f.w + padding > 1 << 28) break;
    placements[i] = { x, y };
    x += f.w + padding;
    if (f.h > rowH) rowH = f.h;
    if (x > (1 << 27)) {
      x = padding;
      y += rowH + padding;
      rowH = 0;
    }
  }
  return placements;
}

export function createAtlas(p: Project, options: AtlasOptions): AtlasResult {
  const padding = clamp(Math.floor(options.padding), 0, 64);
  const columns = clamp(Math.floor(options.columns), 1, 4096);
  const frameIds = options.frameIds && options.frameIds.length > 0
    ? options.frameIds.filter((id) => p.frames.some((f) => f.id === id))
    : p.frames.map((f) => f.id);

  const work: WorkFrame[] = [];
  const hashToFirst = new Map<string, number>();
  const dedupMap = new Map<number, number>(); // frame index -> canonical frame index

  for (let i = 0; i < frameIds.length; i++) {
    const frameId = frameIds[i];
    const frame = p.frames.find((f) => f.id === frameId);
    if (!frame) continue;
    const full = frameRGBA(p, frameId);
    let pixels = full;
    let w = p.width;
    let h = p.height;
    let trimmed = false;
    let offsetX = 0;
    let offsetY = 0;
    if (options.trim) {
      const t = trimRGBA(full, w, h);
      if (t) {
        pixels = t.pixels;
        w = t.w;
        h = t.h;
        offsetX = t.offsetX;
        offsetY = t.offsetY;
        trimmed = true;
      } else {
        // fully transparent: keep a 1x1 placeholder so the frame still exists
        pixels = new Uint8Array(4);
        w = 1; h = 1;
        trimmed = true;
      }
    }
    let canonical = i;
    if (options.deduplicate) {
      const hash = imageHash({ id: '', width: w, height: h, mode: 'rgba', data: pixels });
      const first = hashToFirst.get(hash);
      if (first !== undefined) {
        canonical = first;
        dedupMap.set(i, first);
      } else {
        hashToFirst.set(hash, i);
      }
    }
    const record: AtlasRecord = {
      filename: frameId,
      frame: { x: 0, y: 0, w, h },
      rotated: false,
      trimmed,
      spriteSourceSize: { x: offsetX, y: offsetY, w, h },
      sourceSize: { w: p.width, h: p.height },
      duration: frame.duration,
    };
    work.push({ record, pixels, w, h });
    if (canonical !== i) {
      // alias frame: record exists but shares pixels; mark via same frame rect after packing
      dedupMap.set(i, canonical);
      work.pop();
    }
  }

  const placements = shelfPack(
    work.map((w) => ({ w: w.w, h: w.h })),
    columns,
    padding,
    options.layout,
  );

  // compute canvas size
  let cw = 0;
  let ch = 0;
  for (let i = 0; i < work.length; i++) {
    const pl = placements[i];
    if (pl.x + work[i].w + padding > cw) cw = pl.x + work[i].w + padding;
    if (pl.y + work[i].h + padding > ch) ch = pl.y + work[i].h + padding;
  }
  if (work.length === 0) {
    cw = padding * 2;
    ch = padding * 2;
  }
  const canvas = new Uint8Array(cw * ch * 4);
  for (let i = 0; i < work.length; i++) {
    const pl = placements[i];
    const w = work[i];
    for (let y = 0; y < w.h; y++) {
      canvas.set(
        w.pixels.subarray(y * w.w * 4, (y + 1) * w.w * 4),
        ((pl.y + y) * cw + pl.x) * 4,
      );
    }
    w.record.frame.x = pl.x;
    w.record.frame.y = pl.y;
    w.record.frame.w = w.w;
    w.record.frame.h = w.h;
  }

  // build final record list including dedup aliases
  const records: AtlasRecord[] = [];
  for (let i = 0; i < frameIds.length; i++) {
    const canonical = dedupMap.get(i);
    if (canonical !== undefined && canonical !== i) {
      const src = work.find((w) => w.record.filename === frameIds[canonical]);
      if (src) {
        records.push({ ...src.record, filename: frameIds[i], duration: p.frames.find((f) => f.id === frameIds[i])?.duration ?? 0 });
        continue;
      }
    }
    const w = work.find((x) => x.record.filename === frameIds[i]);
    if (w) records.push(w.record);
  }

  return {
    width: cw,
    height: ch,
    pixels: canvas,
    frames: records,
    meta: {
      app: 'pivo-craft',
      layout: options.layout,
      padding,
      columns,
      trim: options.trim,
      deduplicate: options.deduplicate,
      scale: 1,
    },
  };
}

/** Export atlas metadata as JSON text — either a plain array or a hash-keyed object. */
export function exportMetadata(atlas: AtlasResult, format: 'array' | 'hash'): string {
  if (format === 'array') {
    return JSON.stringify({
      frames: atlas.frames,
      meta: atlas.meta,
    });
  }
  const out: Record<string, AtlasRecord> = {};
  for (const f of atlas.frames) out[f.filename] = f;
  return JSON.stringify({ frames: out, meta: atlas.meta });
}
