// Original utility code for PiVo Craft core.
import type { Mode, Project } from './types.ts';

let counter = 0;

/** Stable unique id generator (crypto UUID when available). */
export function uid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round-half-up to 8-bit range (AT-03 convention: golden math uses byte/255 exactly). */
export function round255(v: number): number {
  const r = Math.floor(v + 0.5);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function bpp(mode: Mode): number {
  return mode === 'rgba' ? 4 : mode === 'gray' ? 2 : 1;
}

export function requiredImageBytes(w: number, h: number, mode: Mode): number {
  return w * h * bpp(mode);
}

/** Honest allocation estimate used for history budgeting. */
export function projectBytes(p: Project): number {
  let total = 2048; // object/overhead baseline per snapshot
  for (const key of Object.keys(p.images)) total += p.images[key]!.data.byteLength + 128;
  for (const ts of p.tilesets) {
    total += 128;
    for (const t of ts.tiles) total += t.data.byteLength + 64;
  }
  total += (p.frames.length + p.layers.length + p.cels.length + p.tags.length +
    p.slices.length + p.tilemaps.length + p.paletteKeys.length + p.palette.length) * 48;
  for (const map of p.tilemaps) total += map.cells.length * 32;
  for (const key of p.paletteKeys) total += key.colors.length * 8;
  for (const layer of p.layers) total += layer.name.length * 2;
  total += p.name.length * 2;
  return total;
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function findFrameIndex(p: Project, frameId: string): number {
  const i = p.frames.findIndex((f) => f.id === frameId);
  assert(i >= 0, `Unknown frame id: ${frameId}`);
  return i;
}

export function findLayer(p: Project, layerId: string) {
  const l = p.layers.find((l) => l.id === layerId);
  assert(l, `Unknown layer id: ${layerId}`);
  return l;
}
