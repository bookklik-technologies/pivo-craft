// Malformed ASE handling: bad counts, truncated chunks, decompression bombs must fail atomically.
import { describe, it, expect } from 'vitest';
import { createProject } from '@pivo-craft/core';
import { encodeASE, decodeASE } from '../src/ase.ts';
import { deflateSync } from '../src/zlib.ts';

function header(numFrames = 1, width = 4, height = 4, depth = 32, fileSize?: number): Uint8Array {
  const w = new Uint8Array(128);
  const dv = new DataView(w.buffer);
  dv.setUint32(0, fileSize ?? 128 + 16 + 64, true);
  dv.setUint16(4, 0xa5e0, true);
  dv.setUint16(6, numFrames, true);
  dv.setUint16(8, width, true);
  dv.setUint16(10, height, true);
  dv.setUint16(12, depth, true);
  dv.setUint32(16, 1, true); // flags
  dv.setUint16(20, 100, true); // speed
  return w;
}

function frame(chunks: Uint8Array[], duration = 100): Uint8Array {
  let size = 16;
  for (const c of chunks) size += c.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size, true);
  dv.setUint16(4, 0xf1fa, true);
  dv.setUint16(6, chunks.length > 0xffff ? 0xffff : chunks.length, true);
  dv.setUint16(8, duration, true);
  dv.setUint32(12, chunks.length, true);
  let off = 16;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function chunk(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(6 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length, true);
  dv.setUint16(4, type, true);
  out.set(payload, 6);
  return out;
}

describe('decodeASE malformed input', () => {
  it('rejects bad magic', () => {
    const bad = header();
    bad[4] = 0x00; // little-endian low byte of 0xa5e0
    expect(() => decodeASE(bad)).toThrow(/bad magic/);
  });

  it('rejects truncated header', () => {
    expect(() => decodeASE(new Uint8Array(64))).toThrow(/truncated/);
  });

  it('rejects bad frame magic', () => {
    const f = new Uint8Array(16);
    const dv = new DataView(f.buffer);
    dv.setUint32(0, 16, true);
    dv.setUint16(4, 0x1234, true); // wrong frame magic
    const bytes = new Uint8Array([...header(1, 4, 4, 32, 128 + 16), ...f]);
    expect(() => decodeASE(bytes)).toThrow(/bad frame magic|frame 0: bad magic/);
  });

  it('rejects oversized chunk size in frame', () => {
    // layer chunk with bogus size
    const layerPayload = new Uint8Array(24);
    const lv = new DataView(layerPayload.buffer);
    lv.setUint16(0, 1, true); // visible
    lv.setUint16(2, 0, true); // type normal
    lv.setUint16(10, 0, true); // blend normal
    layerPayload[16] = 255; // opacity
    const bogus = new Uint8Array(6 + 24);
    const bv = new DataView(bogus.buffer);
    bv.setUint32(0, 9999, true); // way bigger than frame
    bv.setUint16(4, 0x2004, true);
    bogus.set(layerPayload, 6);
    const f = frame([bogus]);
    const bytes = new Uint8Array([...header(), ...f]);
    expect(() => decodeASE(bytes)).toThrow();
  });

  it('rejects insane layer count claims', () => {
    // chunk count huge but no data
    const f = new Uint8Array(16);
    const dv = new DataView(f.buffer);
    dv.setUint32(0, 16, true);
    dv.setUint16(4, 0xf1fa, true);
    dv.setUint32(12, 0xffffff, true); // insane chunk count
    const bytes = new Uint8Array([...header(1, 4, 4, 32, 128 + 16), ...f]);
    expect(() => decodeASE(bytes)).toThrow(/too many chunks/);
  });

  it('rejects decompression bombs in cel data', () => {
    // craft a compressed cel whose declared expected size is huge
    const layerPayload = new Uint8Array(22 + 2); // name len + tileset if type 2
    const lv = new DataView(layerPayload.buffer);
    lv.setUint16(0, 1, true);
    lv.setUint16(2, 0, true);
    lv.setUint16(10, 0, true);
    layerPayload[16] = 255;
    layerPayload[18] = 0; layerPayload[19] = 0; // empty name
    const layer = chunk(0x2004, layerPayload);

    // compressed image cel claiming 65535 x 65535 (would be 17 GB if naive)
    const celPayload = new Uint8Array(22 + deflateSync(new Uint8Array(16)).length);
    const cv = new DataView(celPayload.buffer);
    cv.setUint16(0, 0, true); // layer 0
    cv.setInt16(2, 0, true);
    cv.setInt16(4, 0, true);
    celPayload[6] = 255;
    cv.setUint16(8, 2, true); // compressed image
    cv.setInt16(10, 0, true);
    cv.setUint16(16, 0xffff, true); // w
    cv.setUint16(18, 0xffff, true); // h
    // tiny zlib stream (mostly harmless)
    celPayload.set(deflateSync(new Uint8Array(16)), 22);
    const cel = chunk(0x2005, celPayload);

    const f = frame([layer, cel]);
    const bytes = new Uint8Array([...header(), ...f]);
    expect(() => decodeASE(bytes)).toThrow();
  });

  it('fails atomically: truncated palette range', () => {
    // palette chunk with from/to inconsistent
    const palPayload = new Uint8Array(4 + 4 + 4 + 8);
    const pv = new DataView(palPayload.buffer);
    pv.setUint32(0, 256, true); // new size
    pv.setUint32(4, 0, true); // from
    pv.setUint32(8, 999999, true); // to (out of range)
    const pal = chunk(0x2019, palPayload);
    const f = frame([pal]);
    const bytes = new Uint8Array([...header(1, 4, 4, 32, 128 + f.length), ...f]);
    expect(() => decodeASE(bytes)).toThrow(/palette/);
  });

  it('handles tags chunk with count exceeding data gracefully (atomic failure)', () => {
    const tagsPayload = new Uint8Array(2 + 8);
    const tv = new DataView(tagsPayload.buffer);
    tv.setUint16(0, 5000, true); // claims 5000 tags but no data follows
    const tags = chunk(0x2018, tagsPayload);
    const f = frame([tags]);
    const bytes = new Uint8Array([...header(), ...f]);
    expect(() => decodeASE(bytes)).toThrow();
  });

  it('roundtrips a valid minimal file end-to-end', () => {
    const p = createProject(4, 4, 'valid', 'rgba');
    const { bytes } = encodeASE(p);
    const loaded = decodeASE(bytes);
    expect(loaded.width).toBe(4);
    expect(loaded.frames.length).toBe(1);
  });
});
