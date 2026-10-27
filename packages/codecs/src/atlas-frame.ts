// Shared frame compositor used by atlas + gif encoders (single source of truth).
import type { Project, RGBA } from '../../core/src/index.ts';
import { renderFrame } from '../../core/src/index.ts';

export function imageToRGBA(img: { width: number; height: number; mode: Project['mode']; data: Uint8Array }, palette: RGBA[], transparentIndex: number): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 4);
  if (img.mode === 'rgba') {
    out.set(img.data);
    return out;
  }
  if (img.mode === 'gray') {
    for (let i = 0; i < n; i++) {
      const v = img.data[i * 2];
      const a = img.data[i * 2 + 1];
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = a;
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const idx = img.data[i];
    if (idx === transparentIndex) continue;
    const c = palette[idx] ?? [0, 0, 0, 0];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3];
  }
  return out;
}

/** Use the canonical core compositor for every export, including linked cels, groups and tilemaps. */
export function frameToRGBA(p: Project, frameId: string): Uint8Array { return renderFrame(p,frameId); }
