// ByteReader / ByteWriter — original little-endian helpers for PiVo Craft codecs.
// Bounds-checked: every read validates against the buffer length so malformed input
// fails with a thrown error instead of producing garbage.
export class ByteReader {
  readonly bytes: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** True if at least n more bytes are available. */
  remaining(n = 0): boolean {
    return this.pos + n <= this.bytes.length;
  }

  get position(): number {
    return this.pos;
  }

  seek(p: number): void {
    if (p < 0 || p > this.bytes.length) throw new RangeError(`seek out of bounds: ${p}`);
    this.pos = p;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new RangeError(`read past end of buffer at ${this.pos} (+${n} of ${this.bytes.length})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  i8(): number {
    return (this.u8() << 24) >> 24;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** 32-bit fixed point 16.16 */
  fixed(): number {
    return this.i32() / 65536;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  /** 64-bit unsigned as a JS number (safe below 2^53, fine for ASE sizes). */
  u64(): number {
    this.need(8);
    const lo = this.view.getUint32(this.pos, true);
    const hi = this.view.getUint32(this.pos + 4, true);
    this.pos += 8;
    return hi * 4294967296 + lo;
  }

  bytesAt(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  string(): string {
    const len = this.u16();
    this.need(len);
    const s = new TextDecoder('utf-8', { fatal: false }).decode(this.bytesAt(len));
    return s;
  }

  /** Read a validated sub-range view; shared for chunk walking. */
  sliceTo(end: number): Uint8Array {
    if (end < this.pos || end > this.bytes.length) throw new RangeError('bad slice end');
    const out = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return out;
  }
}

export class ByteWriter {
  private chunks: number[][] = [];
  private view: DataView | null = null;
  private len = 0;

  private buf: Uint8Array = new Uint8Array(256);
  private used = 0;

  private ensure(n: number): void {
    if (this.used + n > this.buf.length) {
      let cap = this.buf.length;
      while (cap < this.used + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.used));
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
  }

  private viewOf(): DataView {
    if (this.view?.buffer !== this.buf.buffer) this.view = new DataView(this.buf.buffer);
    return this.view;
  }

  get length(): number {
    return this.used;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.used++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.viewOf().setUint16(this.used, v, true);
    this.used += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(2);
    this.viewOf().setInt16(this.used, v, true);
    this.used += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.viewOf().setUint32(this.used, v, true);
    this.used += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.viewOf().setInt32(this.used, v, true);
    this.used += 4;
    return this;
  }

  fixed(v: number): this {
    return this.i32(Math.round(v * 65536));
  }

  string(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u16(bytes.length);
    this.raw(bytes);
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.used);
    this.used += bytes.length;
    return this;
  }

  /** Patch a u32 at an absolute offset (for back-patching sizes). */
  patchU32(offset: number, v: number): void {
    new DataView(this.buf.buffer).setUint32(offset, v, true);
  }

  patchU16(offset: number, v: number): void {
    new DataView(this.buf.buffer).setUint16(offset, v, true);
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.used);
  }
}

/** CRC32 (IEEE 0xEDB88320) — used by PNG and ZIP. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = seed ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
