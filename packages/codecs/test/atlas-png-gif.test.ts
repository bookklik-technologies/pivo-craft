// Atlas builder tests: trim, dedup, padding, layouts; PNG CRC; GIF validity; metadata export.
import { describe, it, expect } from 'vitest';
import { createProject, uid } from '@pivo-craft/core';
import { createAtlas, exportMetadata } from '../src/atlas.ts';
import { encodePNG, verifyPNG, decodePNG } from '../src/png.ts';
import { encodeGIF } from '../src/gif.ts';

describe('createAtlas', () => {
  it('horizontal layout with padding, no trim', () => {
    const p = createProject(4, 4, 'atlas', 'rgba');
    const f2 = { id: uid(), duration: 120 };
    p.frames.push(f2);
    const img2 = { id: uid(), width: 4, height: 4, mode: 'rgba' as const, data: new Uint8Array(4 * 4 * 4).fill(1) };
    p.images[img2.id] = img2;
    p.cels.push({ id: uid(), frameId: f2.id, layerId: p.layers[0]!.id, imageId: img2.id, x: 0, y: 0, opacity: 255, z: 0 });
    const a = createAtlas(p, { layout: 'horizontal', columns: 2, padding: 2, trim: false, deduplicate: false });
    expect(a.frames.length).toBe(2);
    expect(a.frames[0]!.frame.x).toBe(2);
    expect(a.frames[1]!.frame.x).toBe(8); // padding + w + padding
    expect(a.width).toBe(14); // padding + w + padding + w + padding
    expect(a.height).toBe(4 + 2 * 2);
  });

  it('trims transparent margins and records spriteSourceSize', () => {
    const p = createProject(8, 8, 'atlas-trim', 'rgba');
    const img = Object.values(p.images)[0]!;
    img.data.fill(0);
    // paint a 2x2 block at (5,5)
    for (let y = 5; y < 7; y++) {
      for (let x = 5; x < 7; x++) {
        const i = (y * 8 + x) * 4;
        img.data[i] = 200; img.data[i + 1] = 200; img.data[i + 2] = 200; img.data[i + 3] = 255;
      }
    }
    const a = createAtlas(p, { layout: 'horizontal', columns: 1, padding: 0, trim: true, deduplicate: false });
    expect(a.frames[0]!.trimmed).toBe(true);
    expect(a.frames[0]!.frame.w).toBe(2);
    expect(a.frames[0]!.frame.h).toBe(2);
    expect(a.frames[0]!.spriteSourceSize).toEqual({ x: 5, y: 5, w: 2, h: 2 });
    expect(a.frames[0]!.sourceSize).toEqual({ w: 8, h: 8 });
  });

  it('deduplicates identical frames', () => {
    const p = createProject(4, 4, 'atlas-dedup', 'rgba');
    const f2 = { id: uid(), duration: 100 };
    p.frames.push(f2);
    const img2 = { id: uid(), width: 4, height: 4, mode: 'rgba' as const, data: new Uint8Array(4 * 4 * 4) };
    p.images[img2.id] = img2;
    p.cels.push({ id: uid(), frameId: f2.id, layerId: p.layers[0]!.id, imageId: img2.id, x: 0, y: 0, opacity: 255, z: 0 });
    // both frames are blank → dedup should yield 1 unique pixel block
    const a = createAtlas(p, { layout: 'horizontal', columns: 2, padding: 1, trim: true, deduplicate: true });
    expect(a.frames.length).toBe(2); // records kept for both
    // both point at the same packed cell
    expect(a.frames[0]!.frame).toEqual(a.frames[1]!.frame);
  });

  it('distinct frames stay distinct under dedup', () => {
    const p = createProject(4, 4, 'atlas-distinct', 'rgba');
    const f2 = { id: uid(), duration: 100 };
    p.frames.push(f2);
    const img2 = { id: uid(), width: 4, height: 4, mode: 'rgba' as const, data: new Uint8Array(4 * 4 * 4).fill(255) };
    p.images[img2.id] = img2;
    p.cels.push({ id: uid(), frameId: f2.id, layerId: p.layers[0]!.id, imageId: img2.id, x: 0, y: 0, opacity: 255, z: 0 });
    const a = createAtlas(p, { layout: 'horizontal', columns: 2, padding: 1, trim: true, deduplicate: true });
    expect(a.frames[0]!.frame).not.toEqual(a.frames[1]!.frame);
  });

  it('grid layout honors columns', () => {
    const p = createProject(2, 2, 'atlas-grid', 'rgba');
    for (let i = 0; i < 4; i++) {
      const fi = i === 0 ? p.frames[0]! : { id: uid(), duration: 100 };
      if (i > 0) p.frames.push(fi);
      const img = { id: uid(), width: 2, height: 2, mode: 'rgba' as const, data: new Uint8Array(2 * 2 * 4).fill(i + 1) };
      p.images[img.id] = img;
      p.cels.push({ id: uid(), frameId: fi.id, layerId: p.layers[0]!.id, imageId: img.id, x: 0, y: 0, opacity: 255, z: 0 });
    }
    const a = createAtlas(p, { layout: 'grid', columns: 2, padding: 1, trim: false, deduplicate: false });
    expect(a.frames.length).toBe(4);
    expect(a.frames[0]!.frame.x).toBe(1);
    expect(a.frames[1]!.frame.x).toBe(1 + 2 + 1);
    expect(a.frames[2]!.frame.x).toBe(1); // wraps to next row
    expect(a.frames[2]!.frame.y).toBe(4); // 1 + 2 + 1
  });

  it('exportMetadata formats', () => {
    const p = createProject(2, 2, 'meta', 'rgba');
    const a = createAtlas(p, { layout: 'horizontal', columns: 1, padding: 1, trim: false, deduplicate: false });
    const asArray = JSON.parse(exportMetadata(a, 'array'));
    expect(Array.isArray(asArray.frames)).toBe(true);
    const asHash = JSON.parse(exportMetadata(a, 'hash'));
    expect(asHash.frames[p.frames[0]!.id]).toBeDefined();
  });
});

describe('encodePNG', () => {
  it('produces valid CRC-checked PNG', () => {
    const w = 4;
    const h = 4;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = i; px[i * 4 + 1] = i * 2; px[i * 4 + 2] = i * 3; px[i * 4 + 3] = 255;
    }
    const png = encodePNG(w, h, px);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // 'P'
    const v = verifyPNG(png);
    expect(v.ok).toBe(true);
    expect(v.crcFailures).toBe(0);
  });

  it('roundtrips through decodePNG', () => {
    const w = 5;
    const h = 3;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = (i * 37) % 256;
      px[i * 4 + 3] = 255;
    }
    const png = encodePNG(w, h, px);
    const decoded = decodePNG(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    for (let i = 0; i < px.length; i++) expect(decoded.pixels[i]).toBe(px[i]);
  });

  it('rejects mismatched pixel buffer', () => {
    expect(() => encodePNG(4, 4, new Uint8Array(10))).toThrow(/pixel buffer/);
  });

  it('detects corrupted CRC', () => {
    const px = new Uint8Array(4 * 4 * 4).fill(1);
    const png = encodePNG(4, 4, px);
    png[30] ^= 0xff; // flip a bit in IHDR data region
    const v = verifyPNG(png);
    expect(v.ok).toBe(false);
    expect(v.crcFailures).toBeGreaterThan(0);
  });
});

describe('encodeGIF', () => {
  it('produces a valid GIF89a header and trailer', () => {
    const p = createProject(4, 4, 'gif', 'rgba');
    const img = Object.values(p.images)[0]!;
    img.data[0] = 255; img.data[3] = 255; // paint first pixel red opaque
    const gif = encodeGIF(p);
    const sig = String.fromCharCode(gif[0]!, gif[1]!, gif[2]!, gif[3]!, gif[4]!, gif[5]!);
    expect(sig).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b); // trailer
    expect(gif.length).toBeGreaterThan(24);
  });

  it('encodes subset of frames when frameIds given', () => {
    const p = createProject(4, 4, 'gif-sub', 'rgba');
    const f2 = { id: uid(), duration: 90 };
    p.frames.push(f2);
    const img2 = { id: uid(), width: 4, height: 4, mode: 'rgba' as const, data: new Uint8Array(4 * 4 * 4).fill(9) };
    p.images[img2.id] = img2;
    p.cels.push({ id: uid(), frameId: f2.id, layerId: p.layers[0]!.id, imageId: img2.id, x: 0, y: 0, opacity: 255, z: 0 });
    const gif = encodeGIF(p, [f2.id]);
    expect(String.fromCharCode(gif[0]!, gif[1]!, gif[2]!)).toBe('GIF');
    // one image descriptor present
    let images = 0;
    for (let i = 0; i < gif.length - 1; i++) {
      if (gif[i] === 0x2c) images++;
    }
    expect(images).toBeGreaterThanOrEqual(1);
  });

  it('throws when no frames available', () => {
    const p = createProject(2, 2, 'gif-empty', 'rgba');
    p.frames = [];
    expect(() => encodeGIF(p)).toThrow(/no frames/);
  });
});
