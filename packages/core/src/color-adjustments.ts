// Original color adjustment math for PiVo Craft core.
//
// Every adjustment below names its color space
// and rounding policy:
// - brightness/contrast: straight sRGB byte space. Brightness adds
//   brightness * 2.55 per channel; contrast applies the factor
//   k = (259 * (C + 255)) / (255 * (259 - C)) with C = contrast * 2.55 about the
//   midpoint 127.5. Order: brightness first, then contrast. Round half-up once.
// - hue/saturation/lightness: HSL (hexagonal) color space. Hue shifts cyclically
//   in degrees; saturation and lightness scale by (100 + v) / 100, clamped to
//   [0, 1]. Round half-up once on storage.
// - gamma: straight sRGB byte space, v' = round255(255 * (v / 255)^(1 / gamma))
//   (gamma > 1 brightens).
// - invert: channel complement 255 - v in sRGB byte space.
// - grayscale: the versioned Rec.709 sRGB decode/encode policy from color.ts.
// - replace: exact straight-RGBA comparison with a maximum absolute channel
//   tolerance over R,G,B,A; matched pixels copy the replacement color AND alpha.
// Transparent pixels (alpha 0) are never touched except by replace.
import type { Cel, ImageDataModel, Project, RGBA } from './types.ts';
import { round255 } from './util.ts';
import { effectiveLocked, findLayer } from './document.ts';
import { rgbaToGray } from './color.ts';

export type AdjustmentKind =
  | 'brightness-contrast' | 'hue-saturation' | 'gamma' | 'invert' | 'grayscale' | 'replace' | 'curve';

export interface AdjustmentOptions {
  kind: AdjustmentKind;
  curve?: Array<[number,number]>;
  channel?: 'rgb'|'red'|'green'|'blue';
  brightness?: number;
  contrast?: number;
  hue?: number;
  saturation?: number;
  lightness?: number;
  gamma?: number;
  from?: RGBA;
  to?: RGBA;
  tolerance?: number;
  scope?: 'active' | 'layer' | 'all';
  selection?: Uint8Array | null;
}

// --- HSL helpers (hexagonal HSL, h in degrees [0,360), s/l in [0,1]) ---------

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rn = 0, gn = 0, bn = 0;
  if (hh < 60) { rn = c; gn = x; }
  else if (hh < 120) { rn = x; gn = c; }
  else if (hh < 180) { gn = c; bn = x; }
  else if (hh < 240) { gn = x; bn = c; }
  else if (hh < 300) { rn = x; bn = c; }
  else { rn = c; bn = x; }
  return [round255((rn + m) * 255), round255((gn + m) * 255), round255((bn + m) * 255)];
}

function clampRange(v: number | undefined, lo: number, hi: number, name: string): number {
  if (v === undefined) return 0;
  if (!Number.isFinite(v)) throw new Error(`applyAdjustment: ${name} must be finite`);
  return v < lo ? lo : v > hi ? hi : v;
}

/** Single-pixel adjustment on an RGBA tuple (already mode-decoded). */
function adjustPixel(kind: AdjustmentKind, o: AdjustmentOptions, px: RGBA): RGBA {
  const [r, g, b, a] = px;
  switch (kind) {
    case 'brightness-contrast': {
      const add = clampRange(o.brightness, -100, 100, 'brightness') * 2.55;
      const C = clampRange(o.contrast, -100, 100, 'contrast') * 2.55;
      const k = (259 * (C + 255)) / (255 * (259 - C));
      const f = (v: number): number => round255((v + add - 127.5) * k + 127.5);
      return [f(r), f(g), f(b), a];
    }
    case 'hue-saturation': {
      const hue = clampRange(o.hue, -180, 180, 'hue');
      const satF = (100 + clampRange(o.saturation, -100, 100, 'saturation')) / 100;
      const litF = (100 + clampRange(o.lightness, -100, 100, 'lightness')) / 100;
      const [h, s, l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb(h + hue, Math.min(1, Math.max(0, s * satF)), Math.min(1, Math.max(0, l * litF)));
      return [nr, ng, nb, a];
    }
    case 'curve': {
      const points=o.curve!;const f=(v:number)=>{let n=1;while(n<points.length-1&&v>points[n][0])n++;const [x0,y0]=points[n-1],[x1,y1]=points[n];return round255(y0+(y1-y0)*(v-x0)/(x1-x0));};
      return [!o.channel||o.channel==='rgb'||o.channel==='red'?f(r):r,!o.channel||o.channel==='rgb'||o.channel==='green'?f(g):g,!o.channel||o.channel==='rgb'||o.channel==='blue'?f(b):b,a];
    }
    case 'gamma': {
      const gm = clampRange(o.gamma ?? 1, 0.1, 5, 'gamma');
      const f = (v: number): number => round255(255 * Math.pow(v / 255, 1 / gm));
      return [f(r), f(g), f(b), a];
    }
    case 'invert':
      return [255 - r, 255 - g, 255 - b, a];
    case 'grayscale': {
      const gy = rgbaToGray([r, g, b, a]);
      return [gy[0]!, gy[1]!, gy[2]!, a];
    }
    case 'replace': {
      const from = o.from!;
      const to = o.to!;
      const tol = clampRange(o.tolerance, 0, 255, 'tolerance');
      const d = Math.max(Math.abs(r - from[0]!), Math.abs(g - from[1]!), Math.abs(b - from[2]!), Math.abs(a-from[3]!));
      if (d <= tol) return [to[0]!, to[1]!, to[2]!, to[3]!];
      return px;
    }
  }
}

/**
 * Apply a color adjustment. Scope:
 * - 'active': the cel at (layerId, frameId) only.
 * - 'layer': every image cel of that layer across all frames.
 * - 'all': every image cel of every unlocked image layer in the project.
 * Shared images are modified exactly once (deduplicated by image id, first cel
 * in document order acts as the deterministic representative). A canvas-space
 * selection mask is mapped into each representative cel's buffer space via its
 * x/y origin; same-image cels at different origins use the first (active)
 * representative's mapping, which is documented deterministic behavior.
 * Indexed mode throws: adjustments require an explicit mode conversion, never a
 * hidden palette mutation that would leak across frames sharing the palette.
 * Prevalidation is atomic: any invalid layer/cel/mask aborts before mutation.
 */
export function applyAdjustment(p: Project, layerId: string, frameId: string, options: AdjustmentOptions): void {
  const kind = options.kind;
  const scope = options.scope ?? 'active';
  if(!['brightness-contrast','hue-saturation','gamma','invert','grayscale','replace','curve'].includes(kind)||!['active','layer','all'].includes(scope))throw new Error('Invalid adjustment kind or scope');
  for(const key of ['brightness','contrast','hue','saturation','lightness','gamma','tolerance'] as const)if(options[key]!==undefined&&!Number.isFinite(options[key]))throw new Error('Adjustment parameters must be finite');
  if(kind==='replace')for(const c of [options.from,options.to])if(!c||c.length!==4||!c.every(v=>Number.isFinite(v)&&v>=0&&v<=255))throw new Error('Replace requires valid RGBA colors');
  if(kind==='curve'){const pts=options.curve;if(!pts||pts.length<2||pts.length>16||pts[0][0]!==0||pts.at(-1)![0]!==255||pts.some((pt,n)=>pt.length!==2||pt.some(v=>!Number.isFinite(v)||v<0||v>255)||n>0&&pt[0]<=pts[n-1][0]))throw new Error('Curve needs 2–16 ascending points from input 0 to 255');}

  if (p.mode === 'indexed') {
    throw new Error('applyAdjustment: indexed mode requires an explicit mode conversion before adjustments');
  }

  // --- prevalidation (no mutation yet) ---
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') throw new Error('applyAdjustment: cannot adjust a group layer');
  if (layer.kind === 'tilemap') throw new Error('applyAdjustment: tilemap layers do not support color adjustments');
  const canvasMask = options.selection ?? null;
  if (canvasMask && canvasMask.length !== p.width * p.height) {
    throw new Error('applyAdjustment: selection mask must be canvas-sized');
  }
  if (kind === 'replace' && (!options.from || !options.to)) {
    throw new Error('applyAdjustment: replace requires from and to colors');
  }

  const affected: Array<{ cel: Cel }> = [];
  const layerIds = scope === 'all'
    ? p.layers.filter((l) => l.kind === 'image').map((l) => l.id)
    : [layerId];
  for (const lid of layerIds) {
    if (effectiveLocked(p, lid)) throw new Error(`applyAdjustment: layer ${findLayer(p, lid).name} is locked`);
    for (const cel of p.cels) {
      if (cel.layerId !== lid) continue;
      if (scope === 'active' && !(cel.layerId === layerId && cel.frameId === frameId)) continue;
      affected.push({ cel });
    }
  }

  // Deduplicate shared images: one representative (first cel in document order).
  const seen = new Set<string>();
  const targets: Array<{ img: ImageDataModel; cel: Cel }> = [];
  for (const { cel } of affected) {
    if (seen.has(cel.imageId)) continue;
    const img = p.images[cel.imageId];
    if (!img) throw new Error('applyAdjustment: cel missing image');
    seen.add(cel.imageId);
    targets.push({ img, cel });
  }

  // --- commit ---
  const isGray = p.mode === 'gray';
  for (const { img, cel } of targets) {
    // Map the canvas-space mask into this representative cel's buffer window.
    let local: Uint8Array | null = null;
    if (canvasMask) {
      local = new Uint8Array(img.width * img.height);
      for (let ly = 0; ly < img.height; ly++) {
        for (let lx = 0; lx < img.width; lx++) {
          const cx = lx + cel.x;
          const cy = ly + cel.y;
          if (cx < 0 || cy < 0 || cx >= p.width || cy >= p.height) continue;
          local[ly * img.width + lx] = canvasMask[cy * p.width + cx]!;
        }
      }
    }
    const data = img.data;
    if (isGray) {
      for (let i = 0; i < img.width * img.height; i++) {
        if (local && !local[i]) continue;
        const o = i * 2;
        if (data[o + 1] === 0 && kind !== 'replace') continue; // transparent gray value untouched
        const px = adjustPixel(kind, options, [data[o]!, data[o]!, data[o]!, data[o + 1]!]);
        data[o] = px[0]!;
        data[o + 1] = px[3]!;
      }
    } else {
      for (let i = 0; i < img.width * img.height; i++) {
        if (local && !local[i]) continue;
        const o = i * 4;
        if (data[o + 3] === 0 && kind !== 'replace') continue; // transparent RGB untouched
        const px = adjustPixel(kind, options, [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!]);
        data[o] = px[0]!;
        data[o + 1] = px[1]!;
        data[o + 2] = px[2]!;
        if (kind === 'replace') data[o + 3] = px[3]!; // replace may change alpha
      }
    }
  }
  p.revision++;
}
