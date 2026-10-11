// Original CPU reference compositor for PiVo Craft core.
// Renders to a row-major RGBA Uint8Array of canvas width*height*4.
import type { Cel, ImageDataModel, Project, Rect, RGBA } from './types.ts';
import { assert, findFrameIndex } from './util.ts';
import { blendPixel, compositePixel } from './color.ts';
import { paletteFor } from './document.ts';
import { effectiveVisible } from './document.ts';

/** Decode any-mode image pixels to a straight RGBA tuple array. */
export function imagePixelsRGBA(p: Project, img: ImageDataModel, frameId: string, indexedBackground=false): RGBA[] {
  const n = img.width * img.height;
  const out: RGBA[] = new Array(n);
  if (img.mode === 'rgba') {
    for (let i = 0; i < n; i++) {
      out[i] = [img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!, img.data[i * 4 + 3]!];
    }
  } else if (img.mode === 'gray') {
    for (let i = 0; i < n; i++) {
      const v = img.data[i * 2]!;
      out[i] = [v, v, v, img.data[i * 2 + 1]!];
    }
  } else {
    const pal = paletteFor(p, frameId);
    for (let i = 0; i < n; i++) {
      const idx = img.data[i]!;
      out[i] = !indexedBackground&&idx === p.transparentIndex ? [0, 0, 0, 0] : [...(pal[idx] ?? [0, 0, 0, 255])] as RGBA;if(indexedBackground)out[i][3]=255;
    }
  }
  return out;
}

/** Flatten an image's tilemap cell content into RGBA at a grid position. */
function tileCellPixels(p: Project, layerId: string, frameId: string): { w: number; h: number; px: RGBA[] } | null {
  const layer = p.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== 'tilemap') return null;
  const tm = p.tilemaps.find((t) => t.layerId === layerId && t.frameId === frameId);
  if (!tm) return null;
  const ts = p.tilesets.find((t) => t.id === layer.tilesetId);
  if (!ts) return null;
  const w = ts.width * tm.width;
  const h = ts.height * tm.height;
  const px: RGBA[] = new Array(w * h).fill([0, 0, 0, 0]);
  for (let cy = 0; cy < tm.height; cy++) {
    for (let cx = 0; cx < tm.width; cx++) {
      const cell = tm.cells[cy * tm.width + cx]!;
      if (cell.tile === 0) continue; // empty sentinel
      const tile = ts.tiles[cell.tile];
      if (!tile) continue;
      if(cell.diagonal&&ts.width!==ts.height)throw new Error('Non-square diagonal tile transforms are unsupported; explicit rasterization is required');
      const tilePx = imagePixelsRGBA(p, tile, frameId);
      for (let ty = 0; ty < ts.height; ty++) {
        for (let tx = 0; tx < ts.width; tx++) {
          let sx = tx, sy = ty;
          if (cell.diagonal) { const t = sx; sx = sy; sy = t; }
          if (cell.flipX) sx = ts.width - 1 - sx;
          if (cell.flipY) sy = ts.height - 1 - sy;
          if (cell.diagonal && (cell.flipX !== cell.flipY)) {
            // diagonal flip composition: transpose then mirror per flags already applied
          }
          const gx = cx * ts.width + tx;
          const gy = cy * ts.height + ty;
          if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
          px[gy * w + gx] = tilePx[sy * ts.width + sx] ?? [0, 0, 0, 0];
        }
      }
    }
  }
  return { w, h, px };
}

interface RenderItem {
  cel: Cel;
  layerIndex: number;
  z: number;
  groupPath: string[]; // ancestor group ids, outermost first
  isolatedAncestor: string | null; // nearest isolated group id (render boundary)
  pixels: RGBA[];
  cw: number;
  ch: number;
}

function collectItems(p: Project, frameId: string, includeHidden: boolean, scopeLayerIds: Set<string> | null): RenderItem[] {
  findFrameIndex(p, frameId);
  const items: RenderItem[] = [];
  const layerPos = new Map<string, number>();
  p.layers.forEach((l, i) => layerPos.set(l.id, i));

  const cels = p.cels.filter((c) => c.frameId === frameId);
  for (const cel of cels) {
    const layer = p.layers.find((l) => l.id === cel.layerId);
    if (!layer) continue;
    if (scopeLayerIds && !scopeLayerIds.has(layer.id)) continue;
    if (!includeHidden && !effectiveVisible(p, layer.id)) continue;
    // Ancestor chain
    const chain: string[] = [];
    let ancestorId = layer.parent;
    let hiddenByParent = false;
    let isolatedAncestor: string | null = null;
    const seen = new Set<string>();
    while (ancestorId) {
      assert(!seen.has(ancestorId), 'Layer cycle');
      seen.add(ancestorId);
      const anc = p.layers.find((l) => l.id === ancestorId);
      if (!anc) break;
      chain.unshift(anc.id);
      if (!includeHidden && !anc.visible) hiddenByParent = true;
      if (anc.isolated) isolatedAncestor = anc.id;
      ancestorId = anc.parent;
    }
    if (hiddenByParent) continue;

    if (layer.kind === 'tilemap') {
      const t = tileCellPixels(p, layer.id, frameId);
      if (!t) continue;
      items.push({
        cel, layerIndex: layerPos.get(layer.id)!, z: cel.z, groupPath: chain,
        isolatedAncestor, pixels: t.px, cw: t.w, ch: t.h,
      });
    } else {
      const img = p.images[cel.imageId];
      if (!img) continue;
      items.push({
        cel, layerIndex: layerPos.get(layer.id)!, z: cel.z, groupPath: chain,
        isolatedAncestor, pixels: imagePixelsRGBA(p, img, frameId,layer.background&&p.mode==='indexed'), cw: img.width, ch: img.height,
      });
    }
  }
  return items;
}

/**
 * Composite the visible state of one frame into an RGBA buffer.
 * Bottom layers render first. zIndex scopes to each compositing context:
 * within a group path, items sort by layerIndex, then z. Isolated groups are
 * atomic units; passthrough children join the parent context.
 */
export function renderFrame(p: Project, frameId: string, includeHidden = false): Uint8Array {
  const items = collectItems(p, frameId, includeHidden, null);
  const out = new Uint8Array(p.width * p.height * 4);
  compositeItems(p, items, frameId, out, p.width, p.height, 0, 0);
  return out;
}

function groupKey(item: RenderItem): string {
  return item.isolatedAncestor ?? 'root';
}

function compositeItems(p:Project,items:RenderItem[],frameId:string,out:Uint8Array,w:number,h:number,ox:number,oy:number):void {
 const layers=new Map(p.layers.map((l,i)=>[l.id,{layer:l,index:i}]));
 function context(scope:string|null,list:RenderItem[],dst:Uint8Array,depth:number){
  if((depth+2)*w*h*4>268435456)throw new Error('Nested group rendering exceeds memory budget');
  const direct:RenderItem[]=[],groups=new Map<string,RenderItem[]>();
  for(const item of list){const ancestors=item.groupPath.filter(id=>layers.get(id)?.layer.isolated),start=scope?ancestors.indexOf(scope)+1:0,next=ancestors[start];if(next){const group=groups.get(next)??[];group.push(item);groups.set(next,group);}else direct.push(item);}
  const units:Array<{index:number;z:number;item?:RenderItem;group?:string}>=direct.map(item=>({index:item.layerIndex,z:item.z,item}));
  for(const id of groups.keys())units.push({index:layers.get(id)!.index,z:0,group:id});
  units.sort((a,b)=>(a.index+a.z)-(b.index+b.z)||a.z-b.z);
  for(const unit of units){if(unit.item){drawItem(p,unit.item,dst,w,h,ox,oy);continue;}const group=layers.get(unit.group!)!.layer,buffer=new Uint8Array(w*h*4);context(unit.group!,groups.get(unit.group!)!,buffer,depth+1);for(let n=0;n<w*h;n++){const at=n*4,alpha=Math.round(buffer[at+3]*group.opacity/255);if(!alpha)continue;const result=blendPixel(group.blend,[buffer[at],buffer[at+1],buffer[at+2],alpha],[dst[at],dst[at+1],dst[at+2],dst[at+3]]);dst.set(result,at);}}
 }
 context(null,items,out,0);
}

function drawItem(p: Project, it: RenderItem, out: Uint8Array, w: number, h: number, ox: number, oy: number): void {
  const layer = p.layers.find((l) => l.id === it.cel.layerId)!;
  const celAlpha = (it.cel.opacity / 255) * (layer.opacity / 255);
  const x0 = it.cel.x + ox;
  const y0 = it.cel.y + oy;
  for (let y = 0; y < it.ch; y++) {
    for (let x = 0; x < it.cw; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const src = it.pixels[y * it.cw + x]!;
      if (src[3] === 0 && celAlpha === 0) continue;
      const eff: RGBA = [src[0], src[1], src[2], Math.round(src[3] * celAlpha)];
      if (eff[3] === 0) continue;
      const o = (gy * w + gx) * 4;
      const dst: RGBA = [out[o]!, out[o + 1]!, out[o + 2]!, out[o + 3]!];
      const r = blendPixel(layer.blend, eff, dst);
      out[o] = r[0]; out[o + 1] = r[1]; out[o + 2] = r[2]; out[o + 3] = r[3];
    }
  }
}

/**
 * Render the pixels of one image-like cel (per spec, for direct buffer access).
 * For tilemap layers this composites the tile grid.
 */
export function imageRGBA(p: Project, imageId: string, frameId: string): Uint8Array {
  const img = p.images[imageId];
  assert(img, `Unknown image ${imageId}`);
  findFrameIndex(p, frameId);
  return new Uint8Array(img!.data); // copy
}

// ---------------------------------------------------------------------------
// Onion skin
// ---------------------------------------------------------------------------

/**
 * Onion-skin preview buffer: previous/next ghosts composited under current
 * artwork with opacity falloff and optional tint. Editor-only; never exported.
 * Untinted default; red tint for previous, blue for next when tinted.
 */
export function renderOnion(p: Project, frameId: string, prev = 1, next = 1, tint = false): Uint8Array {
  const out = new Uint8Array(p.width * p.height * 4);
  const idx = findFrameIndex(p, frameId);
  const current = renderFrame(p, frameId);

  const ghost = (otherIdx: number, falloff: number, tintRGB: RGBA): Uint8Array | null => {
    if (otherIdx < 0 || otherIdx >= p.frames.length) return null;
    const buf = renderFrame(p, p.frames[otherIdx]!.id);
    const res = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3]!;
      if (a === 0) continue;
      const m = falloff;
      if (tint) {
        res[i] = tintRGB[0];
        res[i + 1] = tintRGB[1];
        res[i + 2] = tintRGB[2];
        res[i + 3] = Math.round(a * m);
      } else {
        res[i] = buf[i]!;
        res[i + 1] = buf[i + 1]!;
        res[i + 2] = buf[i + 2]!;
        res[i + 3] = Math.round(a * m);
      }
    }
    return res;
  };

  // previous ghosts first, then next ghosts, then current artwork
  for (let d = prev; d >= 1; d--) {
    const g = ghost(idx - d, 1 / (d + 1), [255, 0, 0, 255]);
    if (g) over(out, g);
  }
  for (let d = next; d >= 1; d--) {
    const g = ghost(idx + d, 1 / (d + 1), [0, 0, 255, 255]);
    if (g) over(out, g);
  }
  over(out, current);
  return out;
}

function over(dst: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < dst.length; i += 4) {
    const srcPx: RGBA = [src[i]!, src[i + 1]!, src[i + 2]!, src[i + 3]!];
    if (srcPx[3] === 0) continue;
    const dstPx: RGBA = [dst[i]!, dst[i + 1]!, dst[i + 2]!, dst[i + 3]!];
    const r = compositePixel(srcPx, dstPx);
    dst[i] = r[0]; dst[i + 1] = r[1]; dst[i + 2] = r[2]; dst[i + 3] = r[3];
  }
}

/** Crop a rendered buffer to a rect (used by floating/clipboard flows). */
export function cropBuffer(buf: Uint8Array, w: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const sx = rect.x + x, sy = rect.y + y;
      if (sx < 0 || sy < 0 || sx >= w || sy * w + sx >= buf.length / 4) continue;
      const d = (y * rect.width + x) * 4;
      const s = (sy * w + sx) * 4;
      out[d] = buf[s]!; out[d + 1] = buf[s + 1]!; out[d + 2] = buf[s + 2]!; out[d + 3] = buf[s + 3]!;
    }
  }
  return out;
}
