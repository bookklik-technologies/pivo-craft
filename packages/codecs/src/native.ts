// Native project codec: ZIP-based .pvc envelope via fflate.
// Format: "pvc.json" (UTF-8) + "images/<imageId>.bin" raw pixel payloads.
// Typed-array data never enters JSON: it is referenced by id and stored as raw binary members,
// so a native roundtrip preserves Uint8Array data exactly.
import { zipSync, unzipSync, strFromU8, type Unzipped } from 'fflate';
import type { Project } from '../../core/src/index.ts';
import {crc32} from './bytes.ts';
import { validateProjectShape, diag } from './project.ts';

const JSON_MEMBER = 'pvc.json';
const IMAGES_PREFIX = 'images/';
const MAX_UNCOMPRESSED = 256 * 1024 * 1024; // Aggregate decoded cap
const MAX_MEMBERS = 32768;

interface ProjectEnvelope {
  format: 'pivo-craft/pvc';
  formatVersion: 1;
  project: Omit<Project, 'images' | 'tilesets'>;
  tileSetRefs?: Project['tilesets'];
  imageRefs: Array<{ id: string; member: string; width: number; height: number; mode: Project['mode'] }>;
}

export function saveNative(p: Project): Uint8Array {
  const imageRefs: ProjectEnvelope['imageRefs'] = [];
  const images: Record<string, Uint8Array> = {};
  for (const [id, img] of Object.entries(p.images)) {
    const member = `${IMAGES_PREFIX}${id}.bin`;
    images[member] = img.data;
    imageRefs.push({ id, member, width: img.width, height: img.height, mode: img.mode });
  }
  const tileSetRefs=p.tilesets.map(ts=>({...ts,tiles:ts.tiles.map((tile,n)=>{const member=`tiles/${ts.id}/${n}.bin`;images[member]=tile.data;return {...tile,data: new Uint8Array(0),member};})}));
  const { images: _omit, tilesets: _omit2, ...rest } = p;
  const envelope: ProjectEnvelope = { format: 'pivo-craft/pvc', formatVersion: 1, project: rest, imageRefs, tileSetRefs };
  const members: Unzipped = {
    [JSON_MEMBER]: new TextEncoder().encode(JSON.stringify(envelope)),
    ...images,
  };
  return zipSync(members, { level: 6 });
}

/** Structural pre-checks on the raw ZIP before any inflation: bounds every field we rely on. */
function preflightZip(bytes: Uint8Array): Map<string,{size:number;crc:number}> {
  // End of central directory: signature 0x06054b50
  if (bytes.length < 22) throw new Error('file too small for ZIP');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('missing ZIP end-of-central-directory');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = view.getUint16(eocd + 10, true);
  if (entries > MAX_MEMBERS) throw new Error(`too many ZIP members: ${entries}`);
  if(bytes.length>128*1024*1024)throw new Error('Input ZIP exceeds 128MiB');
  const centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
  if(centralOffset+centralSize>eocd)throw new Error('ZIP central directory out of bounds');
  let pos=centralOffset,total=0;const names=new Set<string>(),directory=new Map<string,{size:number;crc:number}>();
  for(let n=0;n<entries;n++){
    if(pos+46>eocd||view.getUint32(pos,true)!==0x02014b50)throw new Error('Invalid ZIP central entry');
    const packed=view.getUint32(pos+20,true),size=view.getUint32(pos+24,true),nl=view.getUint16(pos+28,true),el=view.getUint16(pos+30,true),cl=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true);
    if(pos+46+nl+el+cl>eocd||local+30>centralOffset)throw new Error('ZIP entry out of bounds');
    const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nl));
    if(name.startsWith('/')||name.includes('\\')||name.split('/').some(c=>c==='..'||c==='__proto__'||c==='constructor'||c==='prototype')||names.has(name))throw new Error('Unsafe or duplicate ZIP path');
    names.add(name);directory.set(name,{size,crc:view.getUint32(pos+16,true)});total+=size;if(total>MAX_UNCOMPRESSED||size>MAX_UNCOMPRESSED)throw new Error('ZIP decoded size exceeds cap');
    if(view.getUint32(local,true)!==0x04034b50)throw new Error('ZIP local header missing');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);if(start+packed>centralOffset)throw new Error('ZIP payload out of bounds');
    if(name===JSON_MEMBER&&size>16*1024*1024)throw new Error('Manifest exceeds metadata cap');
    pos+=46+nl+el+cl;
  }
  if(pos!==centralOffset+centralSize)throw new Error('ZIP central size/count mismatch');return directory;
}

export function loadNative(bytes: Uint8Array): Project {
  const directory=preflightZip(bytes);

  // unzipSync gives us per-member inflated data; fflate enforces member sizes against the
  // central directory, and we re-check every member against our own caps before use.
  let files: Unzipped;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new Error(`corrupt pvc ZIP: ${(e as Error).message}`);
  }
  const names = Object.keys(files);
  if(names.length!==directory.size)throw new Error('ZIP member inventory mismatch');
  for(const n of names){const expected=directory.get(n);if(!expected||files[n].length!==expected.size||crc32(files[n])!==expected.crc)throw new Error('ZIP member size/CRC mismatch');}
  if (names.length > 32768) throw new Error('too many members');
  for (const n of names) {
    if (n === '__proto__' || n === 'constructor' || n === 'prototype') throw new Error(`illegal member name: ${n}`);
    const total = files[n].length;
    if (total > MAX_UNCOMPRESSED) throw new Error(`member ${n} exceeds size cap`);
  }
  const jsonMember = files[JSON_MEMBER];
  if (!jsonMember) throw new Error(`missing ${JSON_MEMBER}`);

  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(jsonMember));
  } catch (e) {
    throw new Error(`corrupt pvc JSON: ${(e as Error).message}`);
  }
  if (typeof envelope !== 'object' || envelope === null) throw new Error('pvc envelope must be an object');
  const env = envelope as Record<string, unknown>;
  if (env.format !== 'pivo-craft/pvc' || env.formatVersion !== 1) {
    throw new Error('not a pvc v1 envelope');
  }
  if (!Array.isArray(env.imageRefs)) throw new Error('pvc envelope missing imageRefs');

  const projectRaw = env.project as Record<string, unknown>;
  if (typeof projectRaw !== 'object' || projectRaw === null) throw new Error('pvc envelope missing project');

  // Splice image binary payloads into a Project-shaped object, then run the shared
  // bounded validator before anything trusts the data.
  const images: Record<string, unknown> = {};
  for (const ref of env.imageRefs as Array<Record<string, unknown>>) {
    const id = typeof ref.id === 'string' ? ref.id : '';
    if (!id || id === '__proto__') throw new Error('bad imageRef id');
    const member = typeof ref.member === 'string' ? ref.member : '';
    const data = files[member];
    if (!data) throw new Error(`missing image member ${member}`);
    images[id] = {
      id,
      width: ref.width,
      height: ref.height,
      mode: ref.mode,
      data,
    };
  }
  const tileSetRefs=Array.isArray(env.tileSetRefs)?env.tileSetRefs:[];
  if(tileSetRefs.length>1024)throw new Error('Too many tilesets');
  const tilesets=tileSetRefs.map((raw:any)=>{if(!Array.isArray(raw.tiles)||raw.tiles.length>65536)throw new Error('Invalid tileset');return {...raw,tiles:raw.tiles.map((t:any)=>{const data=files[t.member];if(!data)throw new Error('Missing tile member');return {...t,data};})};});
  const candidate = { ...(projectRaw as object), images, tilesets } as unknown;
  return validateProjectShape(candidate);
}

/** Re-encode a Project to a normal envelope (useful for normalization/migration). */
export function roundtripNative(bytes: Uint8Array): Project {
  return loadNative(bytes);
}

export function nativeDiagnostics(p: Project) {
  // Hook point for envelope-level warnings; none today.
  return diag('NATIVE_OK', 'info', 'pvc envelope validated');
}
