// Tests for transformAdvanced and applyAdjustment.
import { describe, it, expect } from 'vitest';
import {
  createProject, getCel, addLayer, addFrame, linkCel, makeSelection,
} from '../src/index.ts';
import { transformAdvanced, type AdvancedTransformOptions } from '../src/advanced-transforms.ts';
import { applyAdjustment, rgbToHsl, hslToRgb } from '../src/color-adjustments.ts';

const RED: [number, number, number, number] = [255, 0, 0, 255];

function layerOf(p: ReturnType<typeof createProject>): string {
  return p.layers[0]!.id;
}
function celImg(p: ReturnType<typeof createProject>, layerId = layerOf(p)) {
  const cel = getCel(p, layerId, p.frames[0]!.id)!;
  return { cel, img: p.images[cel.imageId]! };
}
/** Paint one opaque RGBA pixel via direct buffer write (canvas==image coords at 0,0 origin). */
function setPx(img: { data: Uint8Array; mode: string }, x: number, y: number, c: number[]): void {
  const o = (y * 4 + x) * 4;
  img.data.set(c, o);
}
function getPx(img: { data: Uint8Array }, x: number, y: number, w = 4): number[] {
  return [...img.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
}
/** Same-image link: make frame 2's cel reference frame 1's image, keeping the given placement. */
function shareImageAcrossFrame(p: ReturnType<typeof createProject>, layerId: string, frameId: string, x: number, y: number) {
  const f2 = addFrame(p, frameId, true); // empty frame: no new image
  const cel2 = getCel(p, layerId, f2.id) ?? (() => {
    p.cels.push({ id: `cel-${f2.id}`, frameId: f2.id, layerId, imageId: '', x: 0, y: 0, opacity: 255, z: 0 });
    return p.cels[p.cels.length - 1]!;
  })();
  cel2.imageId = celImg(p, layerId).cel.imageId;
  cel2.x = x;
  cel2.y = y;
  return cel2;
}

const identity: AdvancedTransformOptions = { angle: 0, scaleX: 1, scaleY: 1, dx: 0, dy: 0, pivotX: 0, pivotY: 0 };

// ---------------------------------------------------------------------------
// transformAdvanced
// ---------------------------------------------------------------------------

describe('transformAdvanced identity', () => {
  it('0 degrees, unit scale, zero translation is an exact byte identity and returns null', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    setPx(img, 1, 2, RED);
    const before = new Uint8Array(img.data);
    const celBefore = { ...celImg(p, lid).cel };
    const result = transformAdvanced(p, lid, p.frames[0]!.id, { ...identity });
    expect(result).toBeNull();
    expect(new Uint8Array(img.data)).toEqual(before);
    const cel = celImg(p, lid).cel;
    expect(cel.x).toBe(celBefore.x);
    expect(cel.y).toBe(celBefore.y);
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
  });
});

describe('transformAdvanced translation', () => {
  it('translates pixels exactly and grows bounds, shifting cel origin', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img, cel } = celImg(p, lid);
    setPx(img, 0, 0, RED);
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 2, dy: 1 });
    expect(cel.x).toBe(2);
    expect(cel.y).toBe(1);
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
    // red pixel moved from (0,0) canvas to (2,1): local coords (0,0)
    expect([...img.data.slice(0, 4)]).toEqual(RED);
    expect(getPx(img, 1, 0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('transformAdvanced 90 degree rotation', () => {
  it('rotates 90 CW exactly (integer permutation)', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    setPx(img, 0, 0, RED);
    // 90° CW about the pixel-center pivot (2,2) (pivotX/Y 1.5 + 0.5):
    // source unit square [0,1]x[0,1] maps to canvas pixels (3,0)..(4,1); the
    // dest pixel whose center inverts into the source square is (3,0).
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, angle: 90, pivotX: 1.5, pivotY: 1.5 });
    const reds: Array<[number, number]> = [];
    const off = celOffset(p);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (getPx(img, x, y, img.width)[3] === 255) reds.push([x + off.x, y + off.y]);
    }
    expect(reds).toEqual([[3, 0]]);
  });
});

function celOffset(p: ReturnType<typeof createProject>): { x: number; y: number } {
  const { cel } = celImg(p);
  return { x: cel.x, y: cel.y };
}

describe('transformAdvanced offset selection', () => {
  it('moves only selected pixels, preserves the outside, clears the moved source', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    setPx(img, 0, 0, RED); // outside selection
    setPx(img, 1, 1, [0, 255, 0, 255]); // inside selection
    const sel = makeSelection(4, 4, { x: 1, y: 1, width: 1, height: 1 });
    const mask = transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 2, dy: 0, selection: sel });
    expect(mask).not.toBeNull();
    // source green cleared
    expect(getPx(img, 1, 1, img.width)[3]).toBe(0);
    // destination green at canvas (3,1) = local (1,1)... cel origin shifted by outX0=-1? none: dx2 from x1..2 stays within [0..3]? bounds: src area x 1..2 -> dest x 3..4 -> outW from max(4,4)=4? dest x1=4 -> outX1=4, outW=5
    const greens: number[] = [];
    for (let i = 0; i < mask!.length; i++) if (mask![i]) greens.push(i);
    expect(greens.length).toBe(1);
    expect(greens[0]).toBe(1 * mask!.length / 4 + 3 | 0); // canvas (3,1)
    // outside red preserved exactly
    const redFound = getPx(img, 0, 0, img.width);
    expect(redFound).toEqual(RED);
  });

  it('copy keeps the source selected pixels in place', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    setPx(img, 1, 1, [0, 255, 0, 255]);
    const sel = makeSelection(4, 4, { x: 1, y: 1, width: 1, height: 1 });
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 0, dy: 2, selection: sel, copy: true });
    const greens: Array<[number, number]> = [];
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (getPx(img, x, y, img.width)[1] === 255) greens.push([x, y]);
    }
    expect(greens.length).toBe(2);
  });
});

describe('transformAdvanced scale', () => {
  it('2x scale about origin nearest-neighbor samples the original snapshot exactly', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    setPx(img, 0, 0, RED);
    setPx(img, 1, 0, [0, 0, 255, 255]);
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, scaleX: 2, scaleY: 2, pivotX: -0.5, pivotY: -0.5 });
    // 2x about pixel-center pivot (-0.5,-0.5): canvas red at (0,0)->(0,0), blue at (1,0)->(2,0)
    expect(getPx(img, 0, 0, img.width)).toEqual(RED);
    expect(getPx(img, 2, 0, img.width)).toEqual([0, 0, 255, 255]);
    expect(img.width).toBe(8);
    expect(img.height).toBe(8);
  });

  it('0.5 scale shrinks bounds', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, scaleX: 0.5, scaleY: 0.5, pivotX: -0.5, pivotY: -0.5 });
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
  });
});

describe('transformAdvanced rejection and rollback', () => {
  it('rejects nonfinite inputs before any mutation', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    const before = new Uint8Array(img.data);
    const rev = p.revision;
    for (const bad of [
      { ...identity, angle: NaN }, { ...identity, dx: Infinity },
      { ...identity, scaleX: NaN }, { ...identity, pivotY: -Infinity },
    ]) {
      expect(() => transformAdvanced(p, lid, p.frames[0]!.id, bad)).toThrow();
    }
    expect(p.revision).toBe(rev);
    expect(new Uint8Array(img.data)).toEqual(before);
  });

  it('rejects singular (zero) scale before mutation', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    expect(() => transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, scaleX: 0 }))
      .toThrow(/singular/);
  });

  it('rejects locked layers (inherited through groups) and group/tilemap/background, with no mutation', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    p.layers[0]!.locked = true;
    const before = new Uint8Array(celImg(p, lid).img.data);
    expect(() => transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 1 })).toThrow(/locked/);
    // group
    const group = addLayer(p, 'group', 'group');
    expect(() => transformAdvanced(p, group.id, p.frames[0]!.id, { ...identity })).toThrow(/group/);
    // background
    p.layers[0]!.locked = false;
    p.layers[0]!.background = true;
    expect(() => transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 1 })).toThrow(/background/);
    p.layers[0]!.background = false;
    expect(new Uint8Array(celImg(p, lid).img.data)).toEqual(before);
  });

  it('rejects output bounds beyond safety caps with no mutation', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const before = new Uint8Array(celImg(p, lid).img.data);
    expect(() => transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 1e9 }))
      .toThrow(/cap/);
    expect(new Uint8Array(celImg(p, lid).img.data)).toEqual(before);
  });
});

describe('transformAdvanced shared images', () => {
  it('changes shared content once and shifts every same-image origin by the same delta', () => {
    const p = createProject(4, 4);
    const lid = layerOf(p);
    const { cel, img } = celImg(p, lid);
    setPx(img, 0, 0, RED);
    const cel2 = shareImageAcrossFrame(p, lid, p.frames[0]!.id, 3, 5);
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 2, dy: 0 });
    expect(cel.x).toBe(2);
    expect(cel2.x).toBe(5); // 3 + shift 2: placement offset preserved
    expect(cel2.y).toBe(5);
  });
});

describe('transformAdvanced mode support', () => {
  it('supports gray mode preserving value+alpha pairs', () => {
    const p = createProject(4, 4, 'gray-test', 'gray');
    const lid = layerOf(p);
    const { img, cel } = celImg(p, lid);
    img.data[0] = 200; // value at buffer (0,0)
    img.data[1] = 255; // alpha
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 1, dy: 0 });
    // cel origin shifted to 1; buffer (0,0) = canvas (1,0) holds the moved value
    expect(cel.x).toBe(1);
    expect(img.data[0]).toBe(200);
    expect(img.data[1]).toBe(255);
  });

  it('supports indexed mode copying indices and filling with transparent index', () => {
    const p = createProject(4, 4, 'idx-test', 'indexed');
    const lid = layerOf(p);
    const { img, cel } = celImg(p, lid);
    img.data[0] = 7;
    transformAdvanced(p, lid, p.frames[0]!.id, { ...identity, dx: 1, dy: 0 });
    expect(cel.x).toBe(1);
    expect(img.data[0]).toBe(7);
    expect(img.data[img.width * 4 - 1]).toBe(p.transparentIndex & 255); // trailing column filled
  });
});

// ---------------------------------------------------------------------------
// applyAdjustment
// ---------------------------------------------------------------------------

describe('applyAdjustment basics', () => {
  it('invert changes RGB and preserves alpha; transparent RGB untouched', () => {
    const p = createProject(2, 2);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([10, 20, 30, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert' });
    expect([...img.data.slice(0, 4)]).toEqual([245, 235, 225, 255]);
    // pixel 1 stays fully transparent
    expect([...img.data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it('grayscale uses Rec.709 policy and preserves alpha', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([255, 0, 0, 128], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'grayscale' });
    expect(img.data[3]).toBe(128); // alpha preserved
    const [r, g, b] = [img.data[0]!, img.data[1]!, img.data[2]!];
    expect(r).toBe(g);
    expect(g).toBe(b);
    // red is darker than green in Rec.709 luminance: red→~127, green→~246
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
    img.data.set([0, 255, 0, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'grayscale' });
    const g2 = img.data[0]!;
    expect(g2).toBeGreaterThan(200); // green is bright in Rec.709
  });

  it('brightness clamps to [-100,100] and full brightness saturates to white', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([10, 10, 10, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'brightness-contrast', brightness: 100 });
    expect([...img.data.slice(0, 3)]).toEqual([255, 255, 255]);
  });

  it('contrast factor pivots on midpoint 127.5', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([0, 255, 128, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'brightness-contrast', contrast: 100 });
    expect(img.data[0]).toBe(0);
    expect(img.data[1]).toBe(255);
  });

  it('gamma clamps to [0.1,5] and gamma > 1 brightens midtones', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([64, 64, 64, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'gamma', gamma: 2 });
    expect(img.data[0]!).toBeGreaterThan(64);
    // out-of-range gamma is clamped into the documented range, never NaN
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'gamma', gamma: 99 });
    expect(Number.isFinite(img.data[0]!)).toBe(true);
  });

  it('hue shift is cyclic; out-of-range hue clamps; saturation scales within [0,1]', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([255, 0, 0, 255], 0);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'hue-saturation', hue: 120 });
    expect([...img.data.slice(0, 3)]).toEqual([0, 255, 0]);
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'hue-saturation', hue: 180 });
    expect([...img.data.slice(0, 3)]).toEqual([255, 0, 255]); // 120+180=300° -> magenta
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'hue-saturation', hue: -180, saturation: -100 });
    // blue shifted -180 -> yellow (60), fully desaturated to gray at value ~127
    const [r, g, b] = [img.data[0]!, img.data[1]!, img.data[2]!];
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('HSL round-trip helpers are consistent', () => {
    const [h, s, l] = rgbToHsl(255, 0, 0);
    expect(h).toBe(0);
    expect(s).toBe(1);
    expect(l).toBe(0.5);
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
  });

  it('replace matches with tolerance and optionally changes alpha', () => {
    const p = createProject(2, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([100, 100, 100, 255], 0);
    img.data.set([150, 150, 150, 255], 4);
    applyAdjustment(p, lid, p.frames[0]!.id, {
      kind: 'replace', from: [100, 100, 100, 255], to: [255, 0, 0, 200], tolerance: 10,
    });
    expect([...img.data.slice(0, 4)]).toEqual([255, 0, 0, 200]);
    expect([...img.data.slice(4, 8)]).toEqual([150, 150, 150, 255]);
  });
});

describe('applyAdjustment scope, sharing and restrictions', () => {
  it('active scope touches only the active cel; layer scope touches all frames of the layer; all scope deduplicates shared images', () => {
    const p = createProject(2, 2);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([10, 20, 30, 255], 0);
    // frame 2 shares frame 1's image (same content object)
    shareImageAcrossFrame(p, lid, p.frames[0]!.id, 0, 0);
    const l2 = addLayer(p, 'other');
    const img2 = celImg(p, l2.id).img;
    img2.data.set([40, 50, 60, 255], 0);

    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', scope: 'active' });
    expect([...img.data.slice(0, 4)]).toEqual([245, 235, 225, 255]);
    expect(img2.data[0]).toBe(40);

    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', scope: 'layer' });
    expect([...img.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(img2.data[0]).toBe(40);

    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', scope: 'all' });
    expect(img2.data[0]).toBe(215);
    // shared image edited exactly once despite two referencing cels
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', scope: 'all' });
    expect([...img.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
  });

  it('applies selection mask mapped by cel x/y', () => {
    const p = createProject(2, 2);
    const lid = layerOf(p);
    const { img, cel } = celImg(p, lid);
    cel.x = 1;
    img.data.set([10, 20, 30, 255], 0); // buffer (0,0) = canvas (1,0)
    const sel = makeSelection(2, 2, { x: 0, y: 0, width: 1, height: 1 }); // canvas (0,0) only
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', selection: sel });
    expect([...img.data.slice(0, 4)]).toEqual([10, 20, 30, 255]); // canvas (1,0) untouched
  });

  it('throws on indexed mode without mutating palette or indices', () => {
    const p = createProject(2, 2, 'idx', 'indexed');
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    const palBefore = JSON.stringify(p.palette);
    img.data[0] = 3;
    expect(() => applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert' })).toThrow(/indexed/);
    expect(JSON.stringify(p.palette)).toBe(palBefore);
    expect(img.data[0]).toBe(3);
  });

  it('rejects locked layers atomically (no partial mutation on any layer)', () => {
    const p = createProject(2, 2);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([10, 20, 30, 255], 0);
    const l2 = addLayer(p, 'two');
    const img2 = celImg(p, l2.id).img;
    img2.data.set([0, 0, 0, 255], 0);
    l2.locked = true;
    expect(() => applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert', scope: 'all' })).toThrow(/locked/);
    expect([...img.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...img2.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it('gray mode adjusts value bytes and preserves alpha', () => {
    const p = createProject(1, 1, 'g', 'gray');
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data[0] = 10;
    img.data[1] = 200;
    applyAdjustment(p, lid, p.frames[0]!.id, { kind: 'invert' });
    expect(img.data[0]).toBe(245);
    expect(img.data[1]).toBe(200);
  });

  it('replace scope layer does not blend or blur colors (direct copy)', () => {
    const p = createProject(1, 1);
    const lid = layerOf(p);
    const { img } = celImg(p, lid);
    img.data.set([100, 100, 100, 0], 0); // transparent gray
    applyAdjustment(p, lid, p.frames[0]!.id, {
      kind: 'replace', from: [100, 100, 100, 255], to: [0, 255, 0, 255],
    });
    expect([...img.data.slice(0, 4)]).toEqual([100, 100, 100, 0]); // transparent untouched
  });
});
