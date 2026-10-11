// Golden tests for the optional 'pixel-vote' resampling mode of transformAdvanced.
// No blanket superiority is claimed for the vote method.
import { describe, expect, it } from 'vitest';
import {
  createProject, getCel, paint, transformAdvanced, renderFrame,
} from '../src/index.ts';
import type { Project, Rect } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSelection(width: number, height: number, rects: Rect[]): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) m[y * width + x] = 255;
    }
  }
  return m;
}

/** Draw a plus at (cx, cy) with arm length 1 on the layer's image. */
function drawPlus(p: Project, layerId: string, frameId: string, cx: number, cy: number): void {
  paint(p, layerId, frameId, 'pencil',
    [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx + 1, y: cy },
      { x: cx, y: cy - 1 }, { x: cx, y: cy + 1 }],
    { color: [255, 0, 0, 255], size: 1, opacity: 255, ink: 'alpha', brush: 'square' });
}

/** All distinct raw tuples present in an RGBA image buffer. */
function distinctTuples(data: Uint8Array): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < data.length; i += 4) s.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  return s;
}

const O = (rgb: [number, number, number]): number[] => [rgb[0], rgb[1], rgb[2], 255]; // opaque
const T = [0, 0, 0, 0]; // transparent

// ---------------------------------------------------------------------------
// Identity and quarter turns (lattice shortcut)
// ---------------------------------------------------------------------------

describe('pixel-vote identity and quarter turns', () => {
  it('identity with pixel-vote is byte-exact with identity nearest', () => {
    const a = createProject(6, 6);
    const b = createProject(6, 6);
    const la = a.layers[0]!.id;
    const lb = b.layers[0]!.id;
    const f = a.frames[0]!.id;
    drawPlus(a, la, f, 3, 3);
    drawPlus(b, lb, b.frames[0].id, 3, 3);
    const opts = { angle: 0, scaleX: 1, scaleY: 1, dx: 0, dy: 0, pivotX: 0, pivotY: 0 };
    transformAdvanced(a, la, f, { ...opts });
    transformAdvanced(b, lb, b.frames[0].id, { ...opts, resampling: 'pixel-vote' });
    const ia = a.images[getCel(a, la, f)!.imageId]!;
    const ib = b.images[getCel(b, lb, b.frames[0].id)!.imageId]!;
    expect([...ib.data]).toEqual([...ia.data]);
  });

  it('four pixel-vote quarter turns roundtrip byte-exactly', () => {
    const p = createProject(6, 6);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 3, 3);
    const before = [...p.images[getCel(p, l, f)!.imageId]!.data];
    for (let i = 0; i < 4; i++) {
      transformAdvanced(p, l, f, {
        angle: 90, scaleX: 1, scaleY: 1, dx: 0, dy: 0,
        pivotX: 2.5, pivotY: 2.5, resampling: 'pixel-vote',
      });
    }
    const after = [...p.images[getCel(p, l, f)!.imageId]!.data];
    expect(after).toEqual(before);
  });

  it('single 90-degree pixel-vote turn matches nearest byte-for-byte', () => {
    const a = createProject(6, 6);
    const b = createProject(6, 6);
    const la = a.layers[0]!.id;
    const lb = b.layers[0]!.id;
    const f = a.frames[0]!.id;
    drawPlus(a, la, f, 3, 3);
    drawPlus(b, lb, b.frames[0].id, 3, 3);
    const opts = { angle: 90, scaleX: 1, scaleY: 1, dx: 0, dy: 0, pivotX: 2.5, pivotY: 2.5 };
    transformAdvanced(a, la, f, { ...opts });
    transformAdvanced(b, lb, b.frames[0].id, { ...opts, resampling: 'pixel-vote' });
    const ia = a.images[getCel(a, la, f)!.imageId]!;
    const ib = b.images[getCel(b, lb, b.frames[0].id)!.imageId]!;
    expect([...ib.data]).toEqual([...ia.data]);
  });

  it('pixel-vote is deterministic across repeated runs', () => {
    const run = (): number[] => {
      const p = createProject(6, 6);
      const l = p.layers[0]!.id;
      const f = p.frames[0]!.id;
      drawPlus(p, l, f, 3, 3);
      transformAdvanced(p, l, f, {
        angle: 33, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
        pivotX: 3, pivotY: 3, resampling: 'pixel-vote',
      });
      return [...p.images[getCel(p, l, f)!.imageId]!.data];
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
// Palette-only output
// ---------------------------------------------------------------------------

describe('pixel-vote palette preservation', () => {
  it('output tuples are all drawn from the source (including alpha tuples)', () => {
    const p = createProject(8, 8);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 4, 4);
    paint(p, l, f, 'pencil', [{ x: 1, y: 6 }],
      { color: [0, 255, 0, 128], size: 1, opacity: 255, ink: 'copy', brush: 'square' });
    const srcTuples = distinctTuples(p.images[getCel(p, l, f)!.imageId]!.data);
    transformAdvanced(p, l, f, {
      angle: 27, scaleX: 1, scaleY: 1, dx: 2, dy: -1,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    const outTuples = distinctTuples(p.images[getCel(p, l, f)!.imageId]!.data);
    for (const t of outTuples) expect(srcTuples.has(t), `new color ${t} introduced`).toBe(true);
  });

  it('indexed mode never emits a palette index absent from the source', () => {
    const p = createProject(8, 8, 'proj', 'indexed');
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil', [{ x: 4, y: 4 }],
      { color: [200, 0, 0, 255], size: 3, opacity: 255, ink: 'copy', brush: 'square' });
    const srcIdx = new Set([...p.images[getCel(p, l, f)!.imageId]!.data]);
    transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    for (const idx of p.images[getCel(p, l, f)!.imageId]!.data) {
      expect(srcIdx.has(idx), `new index ${idx} introduced`).toBe(true);
    }
  });

  it('gray mode never emits a byte pair absent from the source', () => {
    const p = createProject(8, 8, 'proj', 'gray');
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil', [{ x: 4, y: 4 }],
      { color: [180, 180, 180, 255], size: 3, opacity: 255, ink: 'copy', brush: 'square' });
    const src = [...p.images[getCel(p, l, f)!.imageId]!.data];
    const pairs = new Set<string>();
    for (let i = 0; i < src.length; i += 2) pairs.add(`${src[i]},${src[i + 1]}`);
    transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    const out = p.images[getCel(p, l, f)!.imageId]!.data;
    for (let i = 0; i < out.length; i += 2) {
      expect(pairs.has(`${out[i]},${out[i + 1]}`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Thin feature preservation (foreground-retention bias)
// ---------------------------------------------------------------------------

describe('pixel-vote thin feature retention', () => {
  // Hand-derived: a single isolated pixel at the pivot's neighborhood center
  // after a 45-degree turn — nearest keeps it when the inverse center lands on
  // it; the vote would erase it without the bias when only sparse neighborhood
  // samples hit it. The bias guarantees an opaque center tuple with >= 3 of 11
  // weighted votes survives.
  it('retains a thin 1px diagonal stroke through a 45-degree turn', () => {
    const p = createProject(9, 9);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil',
      [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }],
      { color: [255, 0, 0, 255], size: 1, opacity: 255, ink: 'alpha', brush: 'square' });
    transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 0, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    const out = p.images[getCel(p, l, f)!.imageId]!.data;
    let opaque = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i]! > 0) opaque++;
    // The bias must keep at least one fully opaque stroke pixel visible.
    expect(opaque).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Selection clipping and preservation
// ---------------------------------------------------------------------------

describe('pixel-vote selection handling', () => {
  it('unselected pixels are preserved in place; output mask covers destination only', () => {
    const p = createProject(8, 8);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 2, 2); // inside selection
    paint(p, l, f, 'pencil', [{ x: 7, y: 7 }],
      { color: [0, 0, 255, 255], size: 1, opacity: 255, ink: 'alpha', brush: 'square' }); // outside
    const sel = makeSelection(8, 8, [{ x: 0, y: 0, width: 4, height: 4 }]);
    const mask = transformAdvanced(p, l, f, {
      angle: 90, scaleX: 1, scaleY: 1, dx: 4, dy: 0,
      pivotX: 2, pivotY: 2, selection: sel, resampling: 'pixel-vote',
    });
    expect(mask).not.toBeNull();
    // Destination region (x 4..7, y 0..3) masked; preserved corner (7,7) NOT masked
    // as part of the destination (it is preserved content, not a vote output).
    for (let y = 0; y < 4; y++) {
      for (let x = 5; x < 8; x++) expect(mask![y * 8 + x]).toBe(255);
    }
    expect(mask![7 * 8 + 7]).toBe(0);
    // Preserved unselected pixel is untouched in the rendered canvas.
    const px = renderFrame(p, f);
    const i7 = (7 * 8 + 7) * 4;
    expect([...px.slice(i7, i7 + 4)]).toEqual([0, 0, 255, 255]);
  });

  it('votes outside the selection act as transparent, never sample unselected content', () => {
    const p = createProject(8, 8);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 4, 4);
    const sel = makeSelection(8, 8, [{ x: 3, y: 3, width: 3, height: 3 }]);
    transformAdvanced(p, l, f, {
      angle: 0, scaleX: 1, scaleY: 1, dx: 0, dy: 0,
      pivotX: 0, pivotY: 0, selection: sel, resampling: 'pixel-vote',
    });
    const out = p.images[getCel(p, l, f)!.imageId]!.data;
    for (const t of distinctTuples(out)) {
      expect(t === '0,0,0,0' || t === '255,0,0,255').toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Linked cel origin offsets
// ---------------------------------------------------------------------------

describe('pixel-vote shared-image cels', () => {
  it('shifts linked same-image cel origins by the output delta', () => {
    const p = createProject(8, 8);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 4, 4);
    const imgId = getCel(p, l, f)!.imageId;
    const link = { id: 'link-1', frameId: f, layerId: l, imageId: imgId, x: 20, y: 20, opacity: 255, z: 1, linkId: 'grp' };
    getCel(p, l, f)!.linkId = 'grp';
    p.cels.push(link);
    transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 2, dy: 1,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    const cel = getCel(p, l, f)!;
    expect(link.x - cel.x).toBe(20);
    expect(link.y - cel.y).toBe(20);
    expect(link.imageId).toBe(imgId);
  });
});

// ---------------------------------------------------------------------------
// Mode coverage
// ---------------------------------------------------------------------------

describe('pixel-vote across color modes', () => {
  it('works on RGBA with partial alpha tuples preserved exactly', () => {
    const p = createProject(8, 8);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil', [{ x: 4, y: 4 }],
      { color: [10, 20, 30, 90], size: 2, opacity: 255, ink: 'copy', brush: 'square' });
    transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    });
    const tuples = [...distinctTuples(p.images[getCel(p, l, f)!.imageId]!.data)];
    for (const t of tuples) expect(t === '0,0,0,0' || t === '10,20,30,90').toBe(true);
  });

  it('works on indexed mode', () => {
    const p = createProject(8, 8, 'proj', 'indexed');
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil', [{ x: 4, y: 4 }],
      { color: [200, 0, 0, 255], size: 2, opacity: 255, ink: 'copy', brush: 'square' });
    expect(() => transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    })).not.toThrow();
  });

  it('works on gray mode', () => {
    const p = createProject(8, 8, 'proj', 'gray');
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, l, f, 'pencil', [{ x: 4, y: 4 }],
      { color: [180, 180, 180, 255], size: 2, opacity: 255, ink: 'copy', brush: 'square' });
    expect(() => transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 0,
      pivotX: 4, pivotY: 4, resampling: 'pixel-vote',
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

describe('pixel-vote option validation', () => {
  it('rejects unsupported resampling strings before any mutation', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    drawPlus(p, l, f, 2, 2);
    const img = p.images[getCel(p, l, f)!.imageId]!;
    const before = [...img.data];
    const w = img.width;
    const rev = p.revision;
    const bad = 'bilinear' as unknown as 'pixel-vote';
    expect(() => transformAdvanced(p, l, f, {
      angle: 45, scaleX: 1, scaleY: 1, dx: 0, dy: 0,
      pivotX: 2, pivotY: 2, resampling: bad,
    })).toThrow(/resampling/);
    expect([...img.data]).toEqual(before);
    expect(img.width).toBe(w);
    expect(p.revision).toBe(rev);
  });

  it('omitting resampling keeps nearest behavior (backward compatible)', () => {
    const a = createProject(6, 6);
    const b = createProject(6, 6);
    const la = a.layers[0]!.id;
    const lb = b.layers[0]!.id;
    const f = a.frames[0]!.id;
    drawPlus(a, la, f, 3, 3);
    drawPlus(b, lb, b.frames[0].id, 3, 3);
    const opts = { angle: 45, scaleX: 1, scaleY: 1, dx: 1, dy: 1, pivotX: 3, pivotY: 3 };
    transformAdvanced(a, la, f, { ...opts });
    transformAdvanced(b, lb, b.frames[0].id, { ...opts, resampling: 'nearest' });
    const ia = a.images[getCel(a, la, f)!.imageId]!;
    const ib = b.images[getCel(b, lb, b.frames[0].id)!.imageId]!;
    expect([...ib.data]).toEqual([...ia.data]);
  });
});

// ---------------------------------------------------------------------------
// Hand-authored 45-degree fixture (outputs differ from nearest)
// ---------------------------------------------------------------------------

