// Original selection mask engine for PiVo Craft core.
// A selection is a canvas-space byte mask: 255 = selected, 0 = not. Bounded to the
// canvas it was created for; combine ops require identical dimensions.
import type { Project, Rect } from './types.ts';
import { assert } from './util.ts';

export type Selection = Uint8Array;

export function makeSelection(width: number, height: number, rect: Rect): Uint8Array {
  assert(width >= 0 && height >= 0, 'Invalid mask size');
  const mask = new Uint8Array(width * height);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    mask.fill(255, y * width + x0, y * width + x1);
  }
  return mask;
}

export function makeEllipseSelection(width: number, height: number, rect: Rect): Uint8Array {
  const mask = new Uint8Array(width * height);
  const cx = rect.x + (rect.width - 1) / 2;
  const cy = rect.y + (rect.height - 1) / 2;
  const rx = Math.max(rect.width, 1) / 2;
  const ry = Math.max(rect.height, 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1 + 1e-9) mask[y * width + x] = 255;
    }
  }
  return mask;
}

/** Polygon (lasso) selection via even-odd scan conversion with inclusive edges. */
export function makePolygonSelection(width: number, height: number, points: Array<{ x: number; y: number }>): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (points.length < 3) return mask;
  for (let y = 0; y < height; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const ay = a.y, by = b.y;
      if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) {
        const t = (y + 0.5 - ay) / (by - ay);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i]! - 0.5));
      const xb = Math.min(width - 1, Math.floor(xs[i + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * width + x] = 255;
    }
  }
  return mask;
}

export function combineSelection(a: Uint8Array, b: Uint8Array, op: 'replace' | 'add' | 'subtract' | 'intersect'): Uint8Array {
  assert(a.length === b.length, 'Selection masks must match canvas size');
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const av = a[i]! > 0;
    const bv = b[i]! > 0;
    let v: boolean;
    switch (op) {
      case 'replace': v = bv; break;
      case 'add': v = av || bv; break;
      case 'subtract': v = av && !bv; break;
      case 'intersect': v = av && bv; break;
    }
    out[i] = v ? 255 : 0;
  }
  return out;
}

export function isEmptySelection(mask: Uint8Array | null | undefined): boolean {
  if (!mask) return true;
  for (let i = 0; i < mask.length; i++) if (mask[i]!) return false;
  return true;
}

export function boundsOfSelection(mask: Uint8Array, width: number): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Magic wand. Indexed mode compares indices; RGBA compares exact bytes unless
 * tolerance > 0 (max absolute channel difference in straight RGBA). Fully
 * transparent pixels compare equal regardless of hidden RGB.
 */
export function wandSelection(
  pixels: Uint8Array, w: number, h: number, x: number, y: number,
  tolerance = 0, connectivity: 4 | 8 = 4, mode: 'rgba' | 'gray' | 'indexed' = 'rgba',
  transparentIndex = -1,
): Uint8Array {
  assert(w > 0 && h > 0, 'Invalid wand bounds');
  assert(x >= 0 && y >= 0 && x < w && y < h, 'Wand seed out of bounds');
  const mask = new Uint8Array(w * h);
  const bpp = mode === 'rgba' ? 4 : mode === 'gray' ? 2 : 1;
  const read = (i: number): number[] => {
    const o = i * bpp;
    if (mode === 'rgba') return [pixels[o]!, pixels[o + 1]!, pixels[o + 2]!, pixels[o + 3]!];
    if (mode === 'gray') return [pixels[o]!, pixels[o]!, pixels[o]!, pixels[o + 1]!];
    return [pixels[o]!];
  };
  const startIdx = y * w + x;
  const start = read(startIdx);
  const startTransparent = mode !== 'indexed' && start[3] === 0;
  const startIsTransparentIndex = mode === 'indexed' && start[0] === transparentIndex;
  const matches = (i: number): boolean => {
    const v = read(i);
    if (mode === 'indexed') return v[0] === start[0];
    // transparent compare: fully transparent equal regardless of RGB
    if (startTransparent && v[3] === 0) return true;
    if (startIsTransparentIndex && v[0] === transparentIndex) return true;
    if (tolerance === 0) {
      for (let c = 0; c < 4; c++) if ((v[c] ?? 0) !== (start[c] ?? 0)) return false;
      return true;
    }
    for (let c = 0; c < 4; c++) {
      if (Math.abs((v[c] ?? 0) - (start[c] ?? 0)) > tolerance) return false;
    }
    return true;
  };
  // Iterative flood fill (explicit queue, never recursion).
  const visited = new Uint8Array(w * h);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    if (!matches(i)) continue;
    mask[i] = 255;
    const cx = i % w;
    const cy = (i / w) | 0;
    const neighbors: Array<[number, number]> = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    if (connectivity === 8) neighbors.push([cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]);
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!visited[ni]) {
        visited[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return mask;
}

/** Grow/shrink by explicit 4-connected Manhattan radius; border = original minus erosion. */
export function growSelection(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return morph(mask, w, h, radius, true);
}

export function shrinkSelection(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return morph(mask, w, h, radius, false);
}

function morph(mask: Uint8Array, w: number, h: number, radius: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 255;
      let hit = !grow;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > radius) continue; // Manhattan radius
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const s = mask[ny * w + nx]! > 0;
          if (grow && s) { v = 255; hit = true; break; }
          if (!grow && !s) { v = 0; hit = true; break; }
        }
        if (hit && grow) break;
      }
      out[y * w + x] = grow ? v : (hit ? v : 255);
    }
  }
  return out;
}

/** Selection of nontransparent content across a whole cel image. */
export function selectContent(p: Project, pixels: Uint8Array, mode: Project['mode'], transparentIndex: number): Uint8Array {
  const mask = new Uint8Array(pixels.length / (mode === 'rgba' ? 4 : mode === 'gray' ? 2 : 1));
  if (mode === 'rgba') {
    for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3]! > 0 ? 255 : 0;
  } else if (mode === 'gray') {
    for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 2 + 1]! > 0 ? 255 : 0;
  } else {
    for (let i = 0; i < mask.length; i++) mask[i] = pixels[i]! !== transparentIndex ? 255 : 0;
  }
  return mask;
}
