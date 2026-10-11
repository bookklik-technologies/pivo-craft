import {describe,it,expect} from 'vitest';
import {deflateSync as nodeZlib,inflateSync as nodeInflate} from 'node:zlib';
import {createProject,addFrame,linkCel,paint,History,cloneProject,renderFrame,uid} from '../../core/src/index.ts';
import {saveNative,loadNative,createAtlas,encodePNG,decodePNG,deflateSync,inflateReusable} from '../src/index.ts';
const options={color:[80,140,240,255] as [number,number,number,number],size:1,opacity:255,ink:'copy' as const,brush:'square' as const};
describe('independent interoperability and regression contracts',()=>{
 it('writes actual zlib readable by the independent Node inflater',()=>{const b=new Uint8Array([1,2,3,4,5]);expect([...nodeInflate(deflateSync(b))]).toEqual([...b]);});
 it('reads independent zlib and rejects excess output before allocating unrestricted buffers',()=>{const raw=new Uint8Array(128).fill(20),packed=new Uint8Array(nodeZlib(raw));expect(inflateReusable(packed,128)).toEqual(raw);expect(()=>inflateReusable(packed,16)).toThrow();});
 it('rejects invalid zlib Adler checksum',()=>{const b=deflateSync(new Uint8Array([1,2,3]));b[b.length-1]^=1;expect(()=>inflateReusable(b,3)).toThrow(/checksum/);});
 it('PNG output IDAT contains standard zlib framing',()=>{const png=encodePNG(1,1,new Uint8Array([10,20,30,255]));const v=new DataView(png.buffer);const idatOffset=33;const len=v.getUint32(idatOffset);expect([...nodeInflate(png.subarray(idatOffset+8,idatOffset+8+len))]).toEqual([0,10,20,30,255]);expect([...decodePNG(png).pixels]).toEqual([10,20,30,255]);});
 it('atlas includes linked cels instead of silently dropping them',()=>{const p=createProject(2,2),l=p.layers[0].id,f=p.frames[0].id;paint(p,l,f,'pencil',[{x:0,y:0}],options);const f2=addFrame(p,f).id;linkCel(p,l,f2,f);const atlas=createAtlas(p,{layout:'horizontal',columns:2,padding:0,trim:false,deduplicate:false});expect(atlas.frames.length).toBe(2);const x=atlas.frames[1].frame.x;expect([...atlas.pixels.subarray(x*4,x*4+4)]).toEqual(options.color);});
 it('history snapshots preserve object IDs and metadata across undo',()=>{const p=createProject(2,2),before=cloneProject(p,{preserveImageIds:true}),h=new History(p);h.execute('stroke',q=>paint(q,q.layers[0].id,q.frames[0].id,'pencil',[{x:0,y:0}],options));h.undo();expect(h.project).toEqual(before);});
 it('native roundtrip includes tileset pixel buffers',()=>{const p=createProject(2,2);p.tilesets.push({id:uid(),name:'test',width:2,height:2,baseIndex:1,tiles:[{id:uid(),width:2,height:2,mode:'rgba',data:new Uint8Array(16).fill(150)}]});const q=loadNative(saveNative(p));expect(q.tilesets[0].tiles[0].data).toEqual(p.tilesets[0].tiles[0].data);});
 it('native path traversal rejected before inflate',()=>{const p=createProject(2,2),bytes=saveNative(p);let text=new TextDecoder('latin1').decode(bytes); // mutate equal-length central file name without changing ZIP layout
 const enc=new TextEncoder().encode('pvc.json');const evil=new TextEncoder().encode('../bad.json');const copy=new Uint8Array(bytes);for(let i=0;i<copy.length-enc.length;i++){if(enc.every((b,j)=>copy[i+j]===b))copy.set(evil,i);}expect(()=>loadNative(copy)).toThrow(/Unsafe/);});
});
