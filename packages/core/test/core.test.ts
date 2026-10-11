// Core tests: exact-byte raster goldens, invariants, history rollback, links, palettes.
// Original tests authored for PiVo Craft.
import { describe, it, expect } from 'vitest';
import {
  createProject, uid, cloneProject, validateProject, paletteFor, getCel, ensureCel,
  addLayer, removeLayer, addFrame, removeFrame, linkCel, unlinkCel, moveCel,
  renderFrame, imageRGBA, renderOnion, paint, makeSelection, combineSelection,
  wandSelection, transformCel, resizeProject, convertMode, adjust, animationSequence,
  editTile, History, addTag, effectiveVisible, effectiveLocked,
} from '../src/index.ts';

const RED: [number, number, number, number] = [255, 0, 0, 255];
const GREEN: [number, number, number, number] = [0, 255, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const base = { size: 1, opacity: 255, ink: 'alpha' as const, brush: 'square' as const };

// w = row width in PIXELS (defaults to a 4-wide canvas). Accepts plain number
// arrays too so selection masks can be inspected without wrapping.
function px(buf: Uint8Array | number[], x: number, y: number, w = 4): number[] {
  return [...buf.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
}

// ---------------------------------------------------------------------------
// AT-01: 1px brush stroke paints exactly the diagonal pixels; undo restores bytes
// ---------------------------------------------------------------------------
describe('AT-01 pencil diagonal stroke', () => {
  it('paints exactly four diagonal pixels on 4x4', () => {
    const p = createProject(4, 4);
    const layerId = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 3 }], { ...base, color: RED });
    const buf = renderFrame(p, f);
    const painted: Array<[number, number]> = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (px(buf, x, y)[3] === 255) painted.push([x, y]);
    expect(painted).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(px(buf, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('undo restores original bytes (history rollback)', () => {
    const p = createProject(4, 4);
    const layerId = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    const before = new Uint8Array(p.images[getCel(p, layerId, f)!.imageId]!.data);
    const h = new History(p);
    h.execute('stroke', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 3 }], { ...base, color: RED }));
    expect(h.canUndo).toBe(true);
    const changed = new Uint8Array(h.project.images[getCel(h.project, layerId, f)!.imageId]!.data);
    expect([...changed].some((v, i) => v !== before[i])).toBe(true);
    h.undo();
    const restored = new Uint8Array(h.project.images[getCel(h.project, layerId, f)!.imageId]!.data);
    expect([...restored]).toEqual([...before]);
  });
});

// ---------------------------------------------------------------------------
// AT-02: sample subdivision cannot change constant-opacity stroke output
// ---------------------------------------------------------------------------
describe('AT-02 constant-opacity strokes', () => {
  it('dense sampling yields identical output to sparse sampling', () => {
    const run = (samples: Array<{ x: number; y: number }>) => {
      const p = createProject(8, 8);
      paint(p, p.layers[0]!.id, p.frames[0]!.id, 'pencil', samples, { ...base, color: RED });
      return [...renderFrame(p, p.frames[0]!.id)];
    };
    const sparse = run([{ x: 0, y: 0 }, { x: 7, y: 7 }]);
    const dense = run([{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 5, y: 5 }, { x: 7, y: 7 }]);
    expect(dense).toEqual(sparse);
  });

  it('half-opacity stroke composites once per pixel regardless of repeats', () => {
    const p = createProject(2, 2);
    paint(p, p.layers[0]!.id, p.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], { ...base, color: RED, opacity: 128 });
    expect(px(renderFrame(p, p.frames[0]!.id), 0, 0)[3]).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// AT-03 / compositing math
// ---------------------------------------------------------------------------
describe('AT-03 alpha compositing golden', () => {
  it('50% red over opaque blue gives [128,0,127,255]', () => {
    const p = createProject(1, 1);
    const layerId = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: BLUE });
    const l2 = addLayer(p, 'top');
    paint(p, l2.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [255, 0, 0, 128] });
    const out = [...renderFrame(p, f).slice(0, 4)];
    expect(out).toEqual([128, 0, 127, 255]);
  });

  it('AT-04: alpha-compositing transparent source is a no-op; simple ink erases', () => {
    const p = createProject(1, 1);
    const layerId = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: BLUE });
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [0, 0, 0, 0], ink: 'alpha' });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(255); // no-op
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [0, 0, 0, 0], ink: 'simple' });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(0); // erased
  });
});

// ---------------------------------------------------------------------------
// AT-05/06 fill semantics
// ---------------------------------------------------------------------------
describe('fill', () => {
  it('AT-05: 4-connectivity leaves diagonal-cut regions; 8-connectivity reaches them', () => {
    const mk = (conn: 4 | 8) => {
      const p = createProject(3, 3);
      const f = p.frames[0]!.id;
      // diagonal wall from (1,0) to (0,1): separates (2,0) from (0,0) under 4-conn
      paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 1, y: 0 }, { x: 0, y: 1 }], { ...base, color: RED });
      paint(p, p.layers[0]!.id, f, 'fill', [{ x: 2, y: 0 }], { ...base, color: GREEN, connectivity: conn });
      return [...renderFrame(p, f)];
    };
    const four = mk(4);
    expect(px(four, 2, 0)).toEqual([0, 255, 0, 255]); // seed region itself
    expect(px(four, 0, 0)).toEqual([0, 0, 0, 0]); // diagonal-cut: not reached with 4-conn
    const eight = mk(8);
    expect(px(eight, 0, 0)).toEqual([0, 255, 0, 255]); // 8-conn reaches diagonally
  });

  it('AT-06: fill via visible composite changes only the active cel', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const bottom = p.layers[0]!.id;
    paint(p, bottom, f, 'pencil', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { ...base, color: RED });
    const top = addLayer(p, 'top');
    paint(p, top.id, f, 'fill', [{ x: 0, y: 0 }], { ...base, color: GREEN, reference: 'composite' as unknown as Uint8Array });
    // top cel painted where composite showed red; bottom cel bytes untouched
    const bottomImg = p.images[getCel(p, bottom, f)!.imageId]!.data;
    expect([...bottomImg.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...bottomImg.slice(4, 8)]).toEqual([0, 0, 0, 0]); // fill wrote nowhere else on bottom
    // composite shows green over the previously-red pixel (top painted on top)
    expect(px(renderFrame(p, f), 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('fill respects selection masks', () => {
    const p = createProject(4, 4);
    const f = p.frames[0]!.id;
    const sel = makeSelection(4, 4, { x: 1, y: 1, width: 2, height: 2 });
    paint(p, p.layers[0]!.id, f, 'fill', [{ x: 0, y: 0 }], { ...base, color: GREEN, selection: sel });
    const buf = renderFrame(p, f);
    expect(px(buf, 0, 0)[3]).toBe(0);
    expect(px(buf, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(buf, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(px(buf, 3, 3)[3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AT-07 selections
// ---------------------------------------------------------------------------
describe('selection masks', () => {
  it('add/subtract/intersect match explicit bit masks', () => {
    const a = makeSelection(4, 4, { x: 0, y: 0, width: 2, height: 4 });
    const b = makeSelection(4, 4, { x: 1, y: 0, width: 2, height: 4 });
    const add = combineSelection(a, b, 'add');
    expect([...add].filter((v) => v).length).toBe(12);
    const sub = combineSelection(a, b, 'subtract');
    expect([...sub].filter((v) => v).length).toBe(4);
    const inter = combineSelection(a, b, 'intersect');
    expect([...inter].filter((v) => v).length).toBe(4);
    // CORRECTED: a selection mask is 1 byte per pixel (255 = selected), not
    // RGBA; read mask[0*4+1] directly instead of through the RGBA px helper.
    expect(inter[0 * 4 + 1]).toBe(255);
  });

  it('paint outside mask changes no bytes', () => {
    const p = createProject(4, 4);
    const f = p.frames[0]!.id;
    const sel = makeSelection(4, 4, { x: 0, y: 0, width: 1, height: 1 });
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 3, y: 3 }], { ...base, color: RED, selection: sel });
    expect(px(renderFrame(p, f), 3, 3)[3]).toBe(0);
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED, selection: sel });
    expect(px(renderFrame(p, f), 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('wand selection flood in rgba with tolerance', () => {
    const buf = new Uint8Array(4 * 4 * 4);
    // fill all red, one pixel slightly-darker red at (2,2)
    for (let i = 0; i < 16; i++) buf.set(RED, i * 4);
    buf.set([250, 0, 0, 255], (2 * 4 + 2) * 4);
    const exact = wandSelection(buf, 4, 4, 0, 0, 0);
    expect([...exact].filter((v) => v).length).toBe(15);
    const tol = wandSelection(buf, 4, 4, 0, 0, 10);
    expect([...tol].filter((v) => v).length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// AT-09 transforms
// ---------------------------------------------------------------------------
describe('transformCel', () => {
  it('four 90-degree rotations restore the buffer', () => {
    const p = createProject(3, 2);
    const f = p.frames[0]!.id;
    const layerId = p.layers[0]!.id;
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }, { x: 2, y: 1 }], { ...base, color: RED });
    const before = [...p.images[getCel(p, layerId, f)!.imageId]!.data];
    for (let i = 0; i < 4; i++) transformCel(p, layerId, f, 'rotate-90');
    const after = [...p.images[getCel(p, layerId, f)!.imageId]!.data];
    expect(after).toEqual(before);
    expect(p.width).toBe(3);
  });

  it('flip-x mirrors exactly', () => {
    const p = createProject(3, 1);
    const f = p.frames[0]!.id;
    const layerId = p.layers[0]!.id;
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    transformCel(p, layerId, f, 'flip-x');
    const img = p.images[getCel(p, layerId, f)!.imageId]!.data;
    expect([...img.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...img.slice(8, 12)]).toEqual([255, 0, 0, 255]);
  });

  it('AT-10: two linked cels share pixel edits and origin; unlink isolates; undo restores linkage', () => {
    const p = createProject(4, 4);
    const layerId = p.layers[0]!.id;
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    linkCel(p, layerId, f2, f1);
    const c1 = getCel(p, layerId, f1)!;
    const c2 = getCel(p, layerId, f2)!;
    expect(c1.imageId).toBe(c2.imageId);
    expect(c1.linkId).toBe(c2.linkId);
    moveCel(p, c2, 2, 1);
    expect(getCel(p, layerId, f1)!.x).toBe(2);
    expect(getCel(p, layerId, f2)!.y).toBe(1);
    // shared edit applied once shows in both
    // CORRECTED: canvas point (3,2) maps into the moved cel's buffer at (1,1)
    // — the original canvas point (1,1) falls OUTSIDE the cel after its
    // (2,1) move, which is exactly the cel-offset mapping this test guards.
    paint(p, layerId, f2, 'pencil', [{ x: 3, y: 2 }], { ...base, color: BLUE });
    expect(px(renderFrame(p, f1), 3, 2)).toEqual([0, 0, 255, 255]);
    // unlink isolates
    unlinkCel(p, layerId, f2);
    const c2u = getCel(p, layerId, f2)!;
    expect(c2u.imageId).not.toBe(c1.imageId);
    paint(p, layerId, f2, 'pencil', [{ x: 0, y: 0 }], { ...base, color: GREEN });
    expect(px(renderFrame(p, f1), 0, 0)[3]).toBe(0); // f1 unaffected
  });

  it('AT-12: continuous toggle affects new copies but never rewrites existing links', () => {
    const p = createProject(4, 4);
    const layerId = p.layers[0]!.id;
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id; // non-continuous: deep copy
    const c1 = getCel(p, layerId, f1)!;
    const c2 = getCel(p, layerId, f2)!;
    expect(c1.imageId).not.toBe(c2.imageId);
    expect(c2.linkId).toBeUndefined();
    // existing links survive
    const f3 = addFrame(p, f2).id;
    linkCel(p, layerId, f3, f2);
    const c3 = getCel(p, layerId, f3)!;
    expect(c3.linkId).toBe(getCel(p, layerId, f2)!.linkId);
    p.layers[0]!.continuous = true;
    const f4 = addFrame(p, f3).id;
    expect(getCel(p, layerId, f4)!.linkId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Frames, tags, playback
// ---------------------------------------------------------------------------
describe('animation', () => {
  it('AT-16: pingpong three frames yields A,B,C,B', () => {
    const p = createProject(2, 2);
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    const f3 = addFrame(p, f2).id;
    const tag = addTag(p, 'walk', f1, f3, 'pingpong', 0);
    const seq = animationSequence(p, tag, false);
    expect(seq).toEqual([f1, f2, f3, f2]);
  });

  it('AT-17: forward repeat=2 gives A,B,C,A,B,C; pingpong repeat=2 gives A,B,C,B,A', () => {
    const p = createProject(2, 2);
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    const f3 = addFrame(p, f2).id;
    const tf = addTag(p, 'f', f1, f3, 'forward', 2);
    expect(animationSequence(p, tf, true)).toEqual([f1, f2, f3, f1, f2, f3]);
    const tp = addTag(p, 'p', f1, f3, 'pingpong', 2);
    expect(animationSequence(p, tp, true)).toEqual([f1, f2, f3, f2, f1]);
  });

  it('AT-19: tags stay valid after frame delete; removed when empty', () => {
    const p = createProject(2, 2);
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    const f3 = addFrame(p, f2).id;
    addTag(p, 'keep', f1, f3, 'forward', 0);
    removeFrame(p, f3);
    expect(p.tags.length).toBe(1);
    removeFrame(p, f2);
    expect(p.tags.length).toBe(0);
    expect(p.frames.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Palette modes
// ---------------------------------------------------------------------------
describe('palette and modes', () => {
  it('AT-15: palette update recolors indexed frame, not RGBA pixel data', () => {
    const p = createProject(2, 2, 't', 'indexed');
    const f = p.frames[0]!.id;
    const layerId = p.layers[0]!.id;
    // paint index 1
    paint(p, layerId, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [1, 0, 0, 0] });
    const img = p.images[getCel(p, layerId, f)!.imageId]!.data;
    expect(img[0]).toBe(1);
    p.palette[1] = [10, 20, 30, 255];
    expect(img[0]).toBe(1); // index data unchanged
    const rendered = renderFrame(p, f);
    expect(px(rendered, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('palette keys: per-frame palette with last-known continuing forward', () => {
    const p = createProject(1, 1, 't', 'indexed');
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    const f3 = addFrame(p, f2).id;
    p.paletteKeys.push({ frameId: f2, colors: [[1, 2, 3, 255]] });
    expect(paletteFor(p, f1)[0]).not.toEqual([1, 2, 3, 255]);
    expect(paletteFor(p, f2)[0]).toEqual([1, 2, 3, 255]);
    expect(paletteFor(p, f3)[0]).toEqual([1, 2, 3, 255]);
  });

  it('convertMode rgba→indexed maps to nearest palette entries', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    p.palette = [[250, 0, 0, 255], [0, 255, 0, 255]];
    convertMode(p, 'indexed');
    expect(p.mode).toBe('indexed');
    const img = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!.data;
    expect(img[0]).toBe(0);
    expect(img[1]).toBe(0);
    expect(renderFrame(p, f).length).toBe(2 * 2 * 4);
  });

  it('convertMode rgba→gray preserves alpha via Rec.709', () => {
    const p = createProject(1, 1);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [255, 0, 0, 128] });
    convertMode(p, 'gray');
    const img = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!.data;
    expect(img.length).toBe(2);
    expect(img[1]).toBe(128);
    expect(img[0]).toBeGreaterThan(0); // red luminance > 0
  });
});

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------
describe('adjust', () => {
  it('invert restricted to selection', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { ...base, color: RED });
    const sel = makeSelection(2, 2, { x: 0, y: 0, width: 1, height: 1 });
    adjust(p, p.layers[0]!.id, f, 'invert', sel);
    const img = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!.data;
    expect([...img.slice(0, 4)]).toEqual([0, 255, 255, 255]); // inverted
    expect([...img.slice(4, 8)]).toEqual([0, 0, 0, 0]); // untouched empty
  });

  it('grayscale converts luminance', () => {
    const p = createProject(1, 1);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    adjust(p, p.layers[0]!.id, f, 'grayscale');
    const img = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!.data;
    expect(img[0]).toBe(img[1]);
    expect(img[1]).toBe(img[2]);
  });
});

// ---------------------------------------------------------------------------
// Groups / locks / visibility (AT-13)
// ---------------------------------------------------------------------------
describe('groups, locks, visibility', () => {
  it('hidden parent group suppresses child composite', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const g = addLayer(p, 'group', 'group');
    const child = addLayer(p, 'child', 'image', g.id);
    paint(p, child.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(255);
    g.visible = false;
    expect(effectiveVisible(p, child.id)).toBe(false);
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(0);
    g.visible = true;
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(255);
  });

  it('lock blocks child editing but not export', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const g = addLayer(p, 'group', 'group');
    const child = addLayer(p, 'child', 'image', g.id);
    g.locked = true;
    expect(effectiveLocked(p, child.id)).toBe(true);
    expect(() => paint(p, child.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED })).toThrow(/locked/);
    g.locked = false;
    paint(p, child.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(255); // export/view unaffected by lock state
  });

  it('removeLayer deletes group with children and their cels', () => {
    const p = createProject(2, 2);
    const g = addLayer(p, 'group', 'group');
    const child = addLayer(p, 'child', 'image', g.id);
    const beforeCels = p.cels.length;
    removeLayer(p, g.id);
    expect(p.layers.some((l) => l.id === child.id)).toBe(false);
    expect(p.cels.length).toBe(beforeCels - 1);
  });
});

// ---------------------------------------------------------------------------
// Background semantics (AT-14)
// ---------------------------------------------------------------------------
describe('background layer', () => {
  it('background erasure fills opaque BG color on empty frame', () => {
    const p = createProject(2, 2);
    p.layers[0]!.background = true; // Explicit opaque background; projects default to transparent.
    // paint bg white
    const f1 = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f1, 'fill', [{ x: 0, y: 0 }], { ...base, color: [255, 255, 255, 255] });
    const f2 = addFrame(p, f1, true).id;
    const buf = renderFrame(p, f2);
    expect(px(buf, 0, 0, 2)).toEqual([255, 255, 255, 255]);
    expect(px(buf, 1, 1, 2)).toEqual([255, 255, 255, 255]);
  });

  it('transparent-layer erasure clears alpha', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const top = addLayer(p, 'free');
    paint(p, top.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    paint(p, top.id, f, 'eraser', [{ x: 0, y: 0 }], { ...base, color: [0, 0, 0, 0] });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------
describe('blend modes', () => {
  it('multiply black over white gives black', () => {
    const p = createProject(1, 1);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [255, 255, 255, 255] });
    const top = addLayer(p, 'top');
    top.blend = 'multiply';
    paint(p, top.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [0, 0, 0, 255] });
    expect(px(renderFrame(p, f), 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('difference and screen compute expected values', () => {
    const p = createProject(1, 1);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [100, 100, 100, 255] });
    const top = addLayer(p, 'top');
    top.blend = 'difference';
    paint(p, top.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [200, 50, 50, 255] });
    const out = px(renderFrame(p, f), 0, 0);
    expect(out[0]).toBe(100); // |200-100|
    expect(out[1]).toBe(50); // |50-100|
    const p2 = createProject(1, 1);
    // CORRECTED: original passed `f` (the FIRST project's frame id) to paint
    // on p2 — a cross-project frame reference that threw "Unknown frame id".
    paint(p2, p2.layers[0]!.id, p2.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [128, 128, 128, 255] });
    const t2 = addLayer(p2, 'top');
    t2.blend = 'screen';
    paint(p2, t2.id, p2.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: [128, 128, 128, 255] });
    const out2 = px(renderFrame(p2, p2.frames[0]!.id), 0, 0);
    // CORRECTED: screen(128/255, 128/255) = 1-(127/255)^2 = 191.75 → round-half-up 192,
    // not 191 (the original comment's "≈0.753" arithmetic was off by one ulp).
    expect(out2[0]).toBe(192);
  });
});

// ---------------------------------------------------------------------------
// resize / clone / validate
// ---------------------------------------------------------------------------
describe('resize, clone, validate', () => {
  it('resize crop keeps top-left content', () => {
    const p = createProject(4, 4);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 3, y: 3 }], { ...base, color: RED });
    resizeProject(p, 2, 2, false);
    expect(p.width).toBe(2);
    const img = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!;
    expect(img.width).toBe(2);
    expect(img.data.length).toBe(16);
    expect(px(renderFrame(p, f), 0, 0, 2)[3]).toBe(0);
  });

  it('resize scale duplicates content nearest-neighbor', () => {
    // CORRECTED: 2x2→4x4 nearest-neighbor replicates each source pixel to a
    // 2x2 block: source (0,0) lands at destinations (0..1, 0..1). The original
    // assertion expected content at (3,3), which maps to source (1,1) — an
    // unpainted pixel. Correct expectations are the (0,0)/(1,1) block corners.
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    resizeProject(p, 4, 4, true);
    const buf = renderFrame(p, f);
    expect(px(buf, 0, 0, 4)).toEqual([255, 0, 0, 255]);
    expect(px(buf, 1, 1, 4)).toEqual([255, 0, 0, 255]);
    expect(px(buf, 3, 3, 4)).toEqual([0, 0, 0, 0]); // source (1,1) was never painted
  });

  it('cloneProject is deep: mutating the clone leaves the original bytes intact', () => {
    // A clone IS the same document, so the project
    // id is preserved by default (pass {newId:true} for a distinct identity).
    // Image ids ARE re-keyed: a clone must not alias its source via images map.
    const p = createProject(4, 4);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    const c = cloneProject(p);
    const cImg = c.images[getCel(c, c.layers[0]!.id, c.frames[0]!.id)!.imageId]!;
    cImg.data[0] = 9;
    const oImg = p.images[getCel(p, p.layers[0]!.id, f)!.imageId]!;
    expect(oImg.data[0]).toBe(255);
    expect(c.id).toBe(p.id); // clone preserves document identity
  });

  it('validateProject catches dangling cel references', () => {
    const p = createProject(4, 4);
    validateProject(p);
    p.cels.push({ ...p.cels[0]!, id: uid(), layerId: 'nope' });
    expect(() => validateProject(p)).toThrow(/missing layer/);
  });

  it('validateProject enforces single bottom-most background', () => {
    const p = createProject(4, 4);
    const l2 = addLayer(p, 'bg2');
    l2.background = true;
    // CORRECTED: two background layers trips the count guard first; the
    // message is case-normalized to match either guard ("background"/"Background").
    expect(() => validateProject(p)).toThrow(/[Bb]ackground/);
  });
});

// ---------------------------------------------------------------------------
// History: bounded, honest, rollback
// ---------------------------------------------------------------------------
describe('History', () => {
  it('undo/redo round-trips bytes exactly', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    const f = h.project.frames[0]!.id;
    const before = [...h.project.images[getCel(h.project, h.project.layers[0]!.id, f)!.imageId]!.data];
    h.execute('paint', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED }));
    expect(h.canUndo).toBe(true);
    h.undo();
    const after = [...h.project.images[getCel(h.project, h.project.layers[0]!.id, f)!.imageId]!.data];
    expect(after).toEqual(before);
    expect(h.canRedo).toBe(true);
    h.redo();
    const redone = [...h.project.images[getCel(h.project, h.project.layers[0]!.id, f)!.imageId]!.data];
    expect(redone).not.toEqual(before);
  });

  it('new edit clears redo stack', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    h.execute('a', () => { /* no-op */ });
    h.undo();
    h.execute('b', () => { /* no-op */ });
    expect(h.canRedo).toBe(false);
  });

  it('evicts oldest entries beyond the byte budget without breaking undo', () => {
    const p = createProject(64, 64);
    const h = new History(p, 4096);
    for (let i = 0; i < 10; i++) {
      h.execute('stroke ' + i, (q) => {
        paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: i % 64, y: 0 }], { ...base, color: RED });
      });
    }
    expect(h.canUndo).toBe(true);
    let guard = 0;
    while (h.canUndo && guard++ < 100) h.undo();
    expect(guard).toBeLessThan(100);
  });

  it('branches: fork, edit, checkout restores states', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    h.execute('base', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED }));
    h.createBranch('experiment');
    h.execute('exp', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 1, y: 1 }], { ...base, color: BLUE }));
    h.checkout('main');
    expect(h.canUndo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Onion skin / export invariance (AT-18)
// ---------------------------------------------------------------------------
describe('AT-18 onion skin', () => {
  it('onion toggle leaves rendered frame buffers byte-identical', () => {
    const p = createProject(4, 4);
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    paint(p, p.layers[0]!.id, f2, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    const plain = renderFrame(p, f2);
    void renderOnion(p, f1, 1, 1, true);
    void renderOnion(p, f1, 1, 1, false);
    const plain2 = renderFrame(p, f2);
    expect([...plain2]).toEqual([...plain]);
  });

  it('onion buffer includes ghosts under current artwork', () => {
    const p = createProject(4, 4);
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    paint(p, p.layers[0]!.id, f1, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    const onion = renderOnion(p, f2, 1, 0, false);
    expect(px(onion, 0, 0)[3]).toBeGreaterThan(0); // ghost visible
    expect(px(onion, 0, 0)[3]).toBeLessThan(255); // falloff
  });
});

// ---------------------------------------------------------------------------
// Linked vs non-continuous copies
// ---------------------------------------------------------------------------
describe('linked and non-contiguous copies', () => {
  it('linked cel paint applies content once; both views update', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    linkCel(p, l, f2, f1);
    // Count how many image buffers get touched by painting once.
    const sharedImg = getCel(p, l, f1)!.imageId;
    paint(p, l, f1, 'pencil', [{ x: 2, y: 2 }], { ...base, color: GREEN });
    expect([...p.images[sharedImg]!.data.slice((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 4)]).toEqual([0, 255, 0, 255]);
    expect(renderFrame(p, f2).slice((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 4)[3]).toBe(255);
  });

  it('non-continuous addFrame deep-copies content', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f1 = p.frames[0]!.id;
    paint(p, l, f1, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    const f2 = addFrame(p, f1).id;
    paint(p, l, f2, 'pencil', [{ x: 1, y: 1 }], { ...base, color: BLUE });
    expect(px(renderFrame(p, f1), 1, 1)[3]).toBe(0);
    expect(px(renderFrame(p, f2), 0, 0)).toEqual([255, 0, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// Tilemaps
// ---------------------------------------------------------------------------
describe('tilemaps', () => {
  function makeTilemapProject(): { p: ReturnType<typeof createProject>; layerId: string; frameId: string } {
    const p = createProject(32, 32);
    const layer = addLayer(p, 'tiles', 'tilemap');
    p.tilesets.push({
      id: 'ts1', name: 'set', width: 16, height: 16,
      tiles: [
        { id: 't0', width: 16, height: 16, mode: p.mode, data: new Uint8Array(16 * 16 * 4) },
        { id: 't1', width: 16, height: 16, mode: p.mode, data: new Uint8Array(16 * 16 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 200)) },
      ],
      baseIndex: 1,
    });
    layer.tilesetId = 'ts1';
    const frameId = p.frames[0]!.id;
    ensureCel(p, layer.id, frameId);
    return { p, layerId: layer.id, frameId };
  }

  it('tiles mode changes cell reference only', () => {
    const { p, layerId, frameId } = makeTilemapProject();
    editTile(p, layerId, frameId, 0, 0, 1, 'tiles');
    const tm = p.tilemaps.find((t) => t.layerId === layerId)!;
    expect(tm.cells[0]!.tile).toBe(1);
    const buf = renderFrame(p, frameId);
    expect(px(buf, 0, 0, 32)[3]).toBe(255);
  });

  it('AT-20 manual edit updates all users of the tile', () => {
    const { p, layerId, frameId } = makeTilemapProject();
    editTile(p, layerId, frameId, 0, 0, 1, 'tiles');
    editTile(p, layerId, frameId, 1, 1, 1, 'tiles');
    editTile(p, layerId, frameId, 1, 1, -1, 'manual', (data) => { data[0] = 255; });
    const t1 = p.tilesets.find((t) => t.id === 'ts1')!.tiles[1]!;
    expect(t1.data[0]).toBe(255);
    // both users render the change
    const buf = renderFrame(p, frameId);
    expect(px(buf, 0, 0, 32)[0]).toBe(255);
    expect(px(buf, 16, 16, 32)[0]).toBe(255);
  });

  it('AT-20 auto dedupes and isolates cells; GC considers all tilemaps', () => {
    // CORRECTED: after appending the modified tile (index 2) GC removes the
    // now-unreferenced source tile (index 1) and compacts — the modified tile
    // is REMAPPED to index 1, not left at a stale index 2. The original test
    // expected stale indices that GC is supposed to eliminate.
    const { p, layerId, frameId } = makeTilemapProject();
    editTile(p, layerId, frameId, 0, 0, 1, 'auto', (data) => { data[0] = 77; data[1] = 77; });
    const ts = p.tilesets.find((t) => t.id === 'ts1')!;
    const modifiedCellTile = p.tilemaps.find((t) => t.layerId === layerId)!.cells[0]!.tile;
    expect(modifiedCellTile).toBe(1); // appended at 2, then GC compacted to 1
    // same edit again dedupes to same (compacted) tile
    editTile(p, layerId, frameId, 1, 0, 1, 'auto', (data) => { data[0] = 77; data[1] = 77; });
    expect(p.tilemaps.find((t) => t.layerId === layerId)!.cells[1]!.tile).toBe(1);
    expect(ts.tiles.length).toBe(2); // empty sentinel + deduped modified tile
  });

  it('AT-21 stack keeps old tile bytes and undo restores cell references', () => {
    const { p, layerId, frameId } = makeTilemapProject();
    const h = new History(p);
    h.execute('stack edit', (q) => {
      editTile(q, q.layers[1]!.id, q.frames[0]!.id, 0, 0, 1, 'stack', (data) => { data[4] = 123; });
    });
    const ts = h.project.tilesets.find((t) => t.id === 'ts1')!;
    expect(ts.tiles.length).toBe(3);
    expect(ts.tiles[1]!.data[4]).toBe(200); // old tile untouched
    expect(ts.tiles[2]!.data[4]).toBe(123);
    h.undo();
    const ts2 = h.project.tilesets.find((t) => t.id === 'ts1')!;
    expect(ts2.tiles.length).toBe(2);
    expect(h.project.tilemaps.find((t) => t.layerId === h.project.layers[1]!.id)!.cells[0]!.tile).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// invariants across operations
// ---------------------------------------------------------------------------
describe('invariants', () => {
  it('addFrame/removeFrame keeps validateProject clean', () => {
    const p = createProject(4, 4);
    addLayer(p, 'a');
    const f2 = addFrame(p, p.frames[0]!.id).id;
    addFrame(p, f2).id;
    validateProject(p);
    removeFrame(p, f2);
    validateProject(p);
  });

  it('linked cel deletion does not delete shared data still in use', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f1 = p.frames[0]!.id;
    const f2 = addFrame(p, f1).id;
    linkCel(p, l, f2, f1);
    const shared = getCel(p, l, f1)!.imageId;
    removeFrame(p, f2);
    expect(p.images[shared]).toBeDefined();
  });

  it('arbitrary layer reorder preserves valid references', () => {
    const p = createProject(4, 4);
    const a = addLayer(p, 'a');
    const b = addLayer(p, 'b');
    // CORRECTED: the background layer must stay bottom-most; reorder the two
    // non-background layers instead of swapping across the background.
    const tmp = p.layers[1]!;
    p.layers[1] = p.layers[2]!;
    p.layers[2] = tmp;
    validateProject(p);
    void a; void b;
  });

  it('revision increments on mutation', () => {
    const p = createProject(4, 4);
    const r0 = p.revision;
    paint(p, p.layers[0]!.id, p.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
    expect(p.revision).toBeGreaterThan(r0);
  });

  it('cel opacity and z-order are per-cel', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const a = addLayer(p, 'a');
    const b = addLayer(p, 'b');
    const ca = getCel(p, a.id, f)!;
    ca.opacity = 128;
    ca.z = 5;
    const cb = getCel(p, b.id, f)!;
    cb.opacity = 200;
    cb.z = 7;
    expect(getCel(p, a.id, f)!.opacity).toBe(128);
    expect(getCel(p, b.id, f)!.z).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// misc API
// ---------------------------------------------------------------------------
describe('misc', () => {
  it('uid uniqueness', () => {
    const s = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(s.size).toBe(1000);
  });

  it('createProject defaults and shapes', () => {
    const p = createProject();
    expect(p.width).toBe(32);
    expect(p.height).toBe(32);
    expect(p.name).toBe('Untitled');
    expect(p.mode).toBe('rgba');
    expect(p.version).toBe(1);
    expect(p.frames.length).toBe(1);
    expect(p.layers[0]!.background).toBe(false); // Transparent default required by spec.
    expect(px(renderFrame(p, p.frames[0]!.id), 0, 0, 32)).toEqual([0, 0, 0, 0]);
  });

  it('ensureCel is idempotent', () => {
    const p = createProject(4, 4);
    const f = p.frames[0]!.id;
    const c1 = ensureCel(p, p.layers[0]!.id, f);
    const c2 = ensureCel(p, p.layers[0]!.id, f);
    expect(c1.id).toBe(c2.id);
  });

  it('imageRGBA returns a copy', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    const cel = getCel(p, p.layers[0]!.id, f)!;
    const a = imageRGBA(p, cel.imageId, f);
    a[0] = 42;
    expect(p.images[cel.imageId]!.data[0]).not.toBe(42);
  });

  it('eyedropper-like sampling does not mutate artwork', () => {
    const p = createProject(2, 2);
    const f = p.frames[0]!.id;
    paint(p, p.layers[0]!.id, f, 'eyedropper', [{ x: 0, y: 0 }], { ...base, color: RED });
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage added with the patchlet: atomic history rollback,
// clone ID stability, painting on moved/cropped cels, budget & branch sanity.
// ---------------------------------------------------------------------------
describe('history atomicity (execute rollback)', () => {
  it('a throwing fn rolls the project back and leaves no entry', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    const before = [...h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data];
    expect(() => h.execute('boom', (q) => {
      paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED });
      throw new Error('mid-command failure');
    })).toThrow('mid-command failure');
    // live state byte-identical to pre-command
    const after = [...h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data];
    expect(after).toEqual(before);
    // no history entry pushed: cannot undo the failed transaction
    expect(h.canUndo).toBe(false);
    // and subsequent good commands still work on the restored state
    h.execute('ok', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 1, y: 1 }], { ...base, color: GREEN }));
    expect(h.canUndo).toBe(true);
    h.undo();
    expect([...h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data]).toEqual(before);
  });

  it('cancel never aliases history snapshots or the caller project', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    h.execute('stroke', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED }));
    h.cancel();
    // mutate the restored live state; undo must still restore independently
    h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data[0] = 42;
    h.undo();
    const restored = h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data;
    expect(restored[0]).not.toBe(42);
  });
});

describe('clone ID stability', () => {
  it('cloneImage gives a fresh id; cloneImageWithId preserves it', async () => {
    const { cloneImage, cloneImageWithId } = await import('../src/index.ts');
    const img = { id: 'src', width: 1, height: 1, mode: 'rgba' as const, data: new Uint8Array([1, 2, 3, 4]) };
    const fresh = cloneImage(img);
    expect(fresh.id).not.toBe('src');
    expect([...fresh.data]).toEqual([1, 2, 3, 4]);
    const same = cloneImageWithId(img);
    expect(same.id).toBe('src');
    same.data[0] = 9;
    expect(img.data[0]).toBe(1); // independent buffer
  });

  it('cloneProject re-keys images and rewrites cel references; project id stable', () => {
    const p = createProject(4, 4);
    const f2 = addFrame(p, p.frames[0]!.id).id;
    linkCel(p, p.layers[0]!.id, f2, p.frames[0]!.id);
    const c = cloneProject(p);
    // every image key maps to a DIFFERENT id than the original keys
    const origKeys = new Set(Object.keys(p.images));
    for (const k of Object.keys(c.images)) expect(origKeys.has(k)).toBe(false);
    // cels point at re-keyed images that exist in the clone's map
    for (const cel of c.cels) {
      if (cel.imageId) expect(c.images[cel.imageId]).toBeDefined();
    }
    // link group identity preserved through the clone
    expect(getCel(c, c.layers[0]!.id, f2)!.linkId).toBeDefined();
    expect(c.id).toBe(p.id);
    // mutation isolation
    const cImg = Object.values(c.images)[0]!;
    cImg.data[0] = 77;
    const oImg = p.images[Object.keys(p.images)[0]!]!;
    expect(oImg.data[0]).not.toBe(77);
  });
});

describe('painting on moved and cropped cels', () => {
  it('stroke honors cel x/y offset (canvas → cel-buffer mapping)', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    moveCel(p, getCel(p, l, f)!, 2, 1);
    paint(p, l, f, 'pencil', [{ x: 2, y: 1 }], { ...base, color: RED }); // buffer (0,0)
    expect(px(renderFrame(p, f), 2, 1)).toEqual([255, 0, 0, 255]);
    expect(px(renderFrame(p, f), 0, 0)[3]).toBe(0); // nothing at un-offset origin
  });

  it('canvas-space selection is remapped onto the moved cel buffer', () => {
    const p = createProject(4, 4);
    const l = p.layers[0]!.id;
    const f = p.frames[0]!.id;
    moveCel(p, getCel(p, l, f)!, 2, 1);
    // canvas-space 1x1 selection over the cel's buffer pixel (0,0)
    const sel = makeSelection(4, 4, { x: 2, y: 1, width: 1, height: 1 });
    paint(p, l, f, 'fill', [{ x: 2, y: 1 }], { ...base, color: GREEN, selection: sel });
    expect(px(renderFrame(p, f), 2, 1)).toEqual([0, 255, 0, 255]);
    expect(px(renderFrame(p, f), 3, 2)[3]).toBe(0); // outside the 1px mask
  });
});

describe('history budget & branch sanity', () => {
  it('budget branch: eviction stops with >=1 entry and never goes negative', () => {
    const p = createProject(64, 64);
    // budget smaller than ONE entry (64*64*4 ≈ 16 KiB + baseline ×2 per entry):
    // eviction cannot free below one entry, must terminate with canUndo true.
    const h = new History(p, 1024);
    for (let i = 0; i < 5; i++) {
      h.execute('stroke ' + i, (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: i % 64, y: 0 }], { ...base, color: RED }));
    }
    expect(h.canUndo).toBe(true);
    let guard = 0;
    while (h.canUndo && guard++ < 10) h.undo();
    expect(guard).toBeLessThanOrEqual(5);
  });

  it('branch entries accumulate and checkout restores each tip', () => {
    const p = createProject(4, 4);
    const h = new History(p);
    h.execute('main edit', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 0, y: 0 }], { ...base, color: RED }));
    h.createBranch('exp');
    h.execute('exp edit 1', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 1, y: 1 }], { ...base, color: BLUE }));
    h.execute('exp edit 2', (q) => paint(q, q.layers[0]!.id, q.frames[0]!.id, 'pencil', [{ x: 2, y: 2 }], { ...base, color: GREEN }));
    h.checkout('exp');
    const tip = h.project.images[getCel(h.project, h.project.layers[0]!.id, h.project.frames[0]!.id)!.imageId]!.data;
    expect(px(new Uint8Array(tip), 2, 2)).toEqual([0, 255, 0, 255]); // branch tip state
    h.checkout('main');
    expect(h.canUndo).toBe(true); // main undo stack intact
  });
});
