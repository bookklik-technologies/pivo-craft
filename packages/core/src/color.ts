// Original color and blend-mode math for PiVo Craft core.
// All blending is straight (unpremultiplied) source-over in encoded sRGB, rounded once on
// storage with round-half-up semantics (golden convention: alpha byte 128 = 128/255 exactly).
import type { Blend, RGBA } from './types.ts';
import { round255 } from './util.ts';

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export function makeRGBA(r: number, g: number, b: number, a = 255): RGBA {
  return [r & 255, g & 255, b & 255, a & 255];
}

/** sRGB decode/encode + Rec.709 luminance (versioned conversion policy). */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return round255(c * 255);
}

export function luminance709(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function rgbaToGray(px: RGBA): RGBA {
  const y = linearToSrgb(luminance709(px[0], px[1], px[2]));
  return [y, y, y, px[3]];
}

// ---------------------------------------------------------------------------
// Separable blend channel functions. All inputs/outputs normalized [0,1].
// ---------------------------------------------------------------------------
type ChannelFn = (s: number, b: number) => number;

const separable: Record<string, ChannelFn> = {
  normal: (s) => s,
  multiply: (s, b) => s * b,
  screen: (s, b) => s + b - s * b,
  overlay: (s, b) => (b <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  darken: (s, b) => Math.min(s, b),
  lighten: (s, b) => Math.max(s, b),
  'color-dodge': (s, b) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (s, b) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (s, b) => (s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  'soft-light': softLight,
  difference: (s, b) => Math.abs(b - s),
  exclusion: (s, b) => s + b - 2 * s * b,
  addition: (s, b) => Math.min(1, s + b),
  subtract: (s, b) => Math.max(0, b - s),
  divide: (s, b) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
};

function softLight(s: number, b: number): number {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

// --- Nonseparable HSL-based modes (hue/saturation/color/luminosity) ---------
function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clipColor(c: [number, number, number]): [number, number, number] {
  const l = lum(c[0], c[1], c[2]);
  let [r, g, b] = c;
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    r = l + (((r - l) * l) / (l - n) || 0);
    g = l + (((g - l) * l) / (l - n) || 0);
    b = l + (((b - l) * l) / (l - n) || 0);
  }
  if (x > 1) {
    const d = 1 - n || 1;
    r = l + ((r - l) * (1 - n)) / d;
    g = l + ((g - l) * (1 - n)) / d;
    b = l + ((b - l) * (1 - n)) / d;
  }
  return [r, g, b];
}

function setLum(c: [number, number, number], l: number): [number, number, number] {
  const d = l - lum(c[0], c[1], c[2]);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function setSat(c: [number, number, number], s: number): [number, number, number] {
  const order = [c[0], c[1], c[2]].sort((a, b) => a - b); // [min, mid, max]
  if (order[2]! > order[0]!) {
    const midNew = ((order[1]! - order[0]!) * s) / (order[2]! - order[0]!);
    const maxNew = s;
    const out = [order[0]!];
    for (const v of c) {
      if (v === order[2]!) out.push(maxNew);
      else if (v === order[1]!) out.push(midNew);
      else out.push(order[0]!);
    }
    // out[0] holds min twice possibly; rebuild explicitly:
    const min = order[0]!;
    return [min, min, min].map((_, i) => {
      const v = c[i]!;
      return v === order[2]! ? maxNew : v === order[1]! ? midNew : min;
    }) as [number, number, number];
  }
  return [0, 0, 0];
}

const nonseparable: Record<string, (s: [number, number, number], b: [number, number, number]) => [number, number, number]> = {
  hue: (s, b) => setLum(setSat(s, sat(b[0], b[1], b[2])), lum(b[0], b[1], b[2])),
  saturation: (s, b) => setLum(setSat(b, sat(s[0], s[1], s[2])), lum(b[0], b[1], b[2])),
  color: (s, b) => setLum(s, lum(b[0], b[1], b[2])),
  luminosity: (s, b) => setLum(b, lum(s[0], s[1], s[2])),
};

export const SUPPORTED_BLENDS: Blend[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity', 'addition', 'subtract', 'divide',
];

export function isSupportedBlend(b: Blend): boolean {
  return SUPPORTED_BLENDS.includes(b);
}

/**
 * Composite one straight-alpha source pixel over a backdrop pixel with the
 * given blend mode. Result is a fresh RGBA rounded once. Zero-alpha output RGB
 * is canonicalized to zero.
 */
export function blendPixel(mode: Blend, src: RGBA, dst: RGBA): RGBA {
  const As = src[3] / 255;
  const Ab = dst[3] / 255;
  const Ao = As + Ab * (1 - As);
  if (Ao <= 0) return [0, 0, 0, 0];
  const fn = separable[mode];
  const cs: [number,number,number]=[src[0]/255,src[1]/255,src[2]/255];
  const cb: [number,number,number]=[dst[0]/255,dst[1]/255,dst[2]/255];
  const mixed=fn?cs.map((v,i)=>fn(v,cb[i])):nonseparable[mode]?nonseparable[mode]!(cs,cb):cs;
  const out=cs.map((v,i)=>(As*(1-Ab)*v + As*Ab*mixed[i] + (1-As)*Ab*cb[i])/Ao);
  const C0 = round255((out[0]! * 255));
  const C1 = round255((out[1]! * 255));
  const C2 = round255((out[2]! * 255));
  const a = round255(Ao * 255);
  return a === 0 ? [0, 0, 0, 0] : [C0, C1, C2, a];
}

/** Plain source-over composite (Normal). */
export function compositePixel(src: RGBA, dst: RGBA): RGBA {
  return blendPixel('normal', src, dst);
}

export function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    round255(a[0]! + (b[0]! - a[0]!) * t),
    round255(a[1]! + (b[1]! - a[1]!) * t),
    round255(a[2]! + (b[2]! - a[2]!) * t),
    round255(a[3]! + (b[3]! - a[3]!) * t),
  ];
}

/** Ordered 4x4 Bayer threshold matrix (canvas-anchored dithering). */
export const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => (v + 0.5) / 16);
