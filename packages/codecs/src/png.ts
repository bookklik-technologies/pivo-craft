// Original PNG encoder: hand-built chunk stream, fflate zlib for IDAT, CRC32 per spec.
// No browser Image APIs involved; works in Node and worker contexts.
import { deflateSync, inflateReusable } from './zlib.ts';
import {decodePNGStrict,scanPNG} from './png-decode.ts';
import { crc32 } from './bytes.ts';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Encode 32-bit RGBA pixels (row-major, top-left origin) as a PNG.
 * `pixels.length` must equal width*height*4.
 */
export function encodePNG(width: number, height: number, pixels: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 1 << 16 || height > 1 << 16) {
    throw new Error(`encodePNG: bad dimensions ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(`encodePNG: pixel buffer ${pixels.length} != width*height*4 (${expected})`);
  }
  // IHDR: width, height, bit depth 8, color type 6 (RGBA), compression 0, filter 0, interlace 0
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT: each scanline prefixed with filter byte 0 (None)
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);

  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  return concat(parts);
}

export function verifyPNG(bytes:Uint8Array):{ok:boolean;reason?:string;crcFailures:number}{try{scanPNG(bytes);return {ok:true,crcFailures:0};}catch(e){const reason=(e as Error).message;return {ok:false,reason,crcFailures:reason.includes('CRC')?1:0};}}
export const decodePNG=decodePNGStrict;
