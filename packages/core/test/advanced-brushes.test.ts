import {describe,it,expect} from 'vitest';
import {createProject,paint,renderFrame,History,getCel,linkCel,addFrame} from '../src/index.ts';
import {captureBrush,brushFromJSON,brushToJSON,validateBrush,paintDynamic,strokeStamps,DEFAULT_DYNAMICS,rasterOverlay} from '../src/advanced-brushes.ts';
import type {CustomBrush,StrokeSample,Dynamics} from '../src/advanced-brushes.ts';
import {applyAdjustment} from '../src/color-adjustments.ts';
const red:[number,number,number,number]=[255,0,0,255];const options={color:red,size:1,opacity:255,ink:'alpha' as const,brush:'square' as const};
const sample=(x:number,y:number,pressure=1,time=0,pointerType:'pen'|'mouse'|'touch'='pen'):StrokeSample=>({x,y,pressure,time,pointerType});
const brush:CustomBrush={id:'test',name:'two dots',width:2,height:1,anchorX:0,anchorY:0,data:new Uint8Array([255,0,0,255,0,0,0,0]),colored:true};
function setup(){const p=createProject(8,8);return {p,l:p.layers[0].id,f:p.frames[0].id};}
const px=(p:ReturnType<typeof createProject>,x:number,y:number)=>Array.from(renderFrame(p,p.frames[0].id).slice((y*p.width+x)*4,(y*p.width+x)*4+4));
describe('custom brushes',()=>{
 it('captures cropped RGBA with selection and explicit anchor',()=>{const {p,l,f}=setup();paint(p,l,f,'pencil',[{x:2,y:2}],options);const b=captureBrush(p,l,f,{x:2,y:2,width:2,height:1});expect([...b.data]).toEqual([255,0,0,255,0,0,0,0]);expect(b.anchorX).toBe(1);});
 it('capture maps moved cel origins',()=>{const {p,l,f}=setup();paint(p,l,f,'pencil',[{x:0,y:0}],options);getCel(p,l,f)!.x=2;const b=captureBrush(p,l,f,{x:2,y:0,width:1,height:1});expect([...b.data]).toEqual(red);});
 it('roundtrips portable brush JSON with fresh identity',()=>{const b=brushFromJSON(brushToJSON(brush));expect([...b.data]).toEqual([...brush.data]);expect(b.id).not.toBe(brush.id);});
 it('rejects oversized, invalid anchor and unbounded JSON brushes',()=>{expect(()=>validateBrush({...brush,anchorX:4})).toThrow();expect(()=>validateBrush({...brush,width:129})).toThrow();expect(()=>brushFromJSON('x'.repeat(400001))).toThrow();});
 it('colored stamp skips transparent source rather than erasing destination',()=>{const {p,l,f}=setup();paint(p,l,f,'pencil',[{x:3,y:1}],{...options,color:[0,0,255,255]});paintDynamic(p,l,f,[sample(2,1)],options,brush,{...DEFAULT_DYNAMICS,minSize:2,maxSize:2});expect(px(p,2,1)).toEqual(red);expect(px(p,3,1)).toEqual([0,0,255,255]);});
 it('mask brush uses foreground instead of captured RGB',()=>{const {p,l,f}=setup();paintDynamic(p,l,f,[sample(2,2)],{...options,color:[0,255,0,255]},{...brush,colored:false},{...DEFAULT_DYNAMICS,minSize:2,maxSize:2});expect(px(p,2,2)).toEqual([0,255,0,255]);});
 it('custom anchor changes stamp placement',()=>{const {p,l,f}=setup();paintDynamic(p,l,f,[sample(2,2)],options,{...brush,anchorX:1},{...DEFAULT_DYNAMICS,minSize:2,maxSize:2});expect(px(p,1,2)).toEqual(red);});
 it('stamps rotate using inverse nearest sampling',()=>{const {p,l,f}=setup();paintDynamic(p,l,f,[sample(2,2)],options,brush,{...DEFAULT_DYNAMICS,minSize:2,maxSize:2,minAngle:90,maxAngle:90});expect(px(p,2,2)).toEqual(red);});
 it('canvas-space selection clips the brush',()=>{const {p,l,f}=setup(),selection=new Uint8Array(64);selection[2*8+2]=255;paintDynamic(p,l,f,[sample(2,2)],{...options,selection},null,{...DEFAULT_DYNAMICS,minSize:3,maxSize:3});expect(renderFrame(p,f).filter((_,i)=>i%4===3&&renderFrame(p,f)[i]>0).length).toBe(1);});
 it('linked brush edits update shared content and undo restores exactly',()=>{const {p,l,f}=setup(),f2=addFrame(p,f).id;linkCel(p,l,f2,f);const h=new History(p);h.execute('stamp',q=>paintDynamic(q,l,f,[sample(1,1)],options,null,DEFAULT_DYNAMICS));expect(renderFrame(h.project,f2)).toEqual(renderFrame(h.project,f));h.undo();expect(renderFrame(h.project,f).every(n=>n===0)).toBe(true);});
 it('locked layer rejection has no mutation',()=>{const {p,l,f}=setup();p.layers[0].locked=true;expect(()=>paintDynamic(p,l,f,[sample(1,1)],options,null,DEFAULT_DYNAMICS)).toThrow(/locked/);expect(px(p,1,1)[3]).toBe(0);});
});
describe('pressure velocity and stabilization',()=>{
 it('pen pressure maps size opacity and angle',()=>{const d:Dynamics={...DEFAULT_DYNAMICS,sensor:'pressure',minSize:1,maxSize:9,minOpacity:0,maxOpacity:200,minAngle:0,maxAngle:90};const stamps=strokeStamps([sample(1,1,.5)],d);expect(stamps[0].size).toBe(5);expect(stamps[0].opacity).toBe(100);expect(stamps[0].angle).toBe(45);});
 it('mouse input uses constant pressure rather than fake hardware pressure',()=>{const d={...DEFAULT_DYNAMICS,sensor:'pressure' as const,minSize:1,maxSize:9};expect(strokeStamps([sample(1,1,0,0,'mouse')],d)[0].size).toBe(9);});
 it('velocity depends on timestamps',()=>{const d={...DEFAULT_DYNAMICS,sensor:'velocity' as const,maxSize:9,velocityMax:1};const fast=strokeStamps([sample(0,0,1,0),sample(10,0,1,10)],d),slow=strokeStamps([sample(0,0,1,0),sample(10,0,1,100)],d);expect(fast.at(-1)!.size).toBeLessThan(slow.at(-1)!.size);});
 it('distance stabilization lags preview and flushes the endpoint',()=>{const d={...DEFAULT_DYNAMICS,stabilizer:3};const input=[sample(0,0,1,0),sample(10,0,1,100)];expect(strokeStamps(input,d,false).at(-1)!.x).toBe(7);expect(strokeStamps(input,d,true).at(-1)!.x).toBe(10);});
 it('spacing is arc-length deterministic for equivalent timestamped paths',()=>{const d={...DEFAULT_DYNAMICS,spacing:2};const a=strokeStamps([sample(0,0,1,0),sample(6,0,1,60)],d);const b=strokeStamps([sample(0,0,1,0),sample(3,0,1,30),sample(6,0,1,60)],d);expect(a.map(s=>s.x)).toEqual(b.map(s=>s.x));});
 it('constant opacity does not accumulate from repeated pointer events',()=>{const {p,l,f}=setup();paintDynamic(p,l,f,[sample(1,1),sample(1,1,1,10),sample(1,1,1,20)],{...options,opacity:128},null,DEFAULT_DYNAMICS);expect(px(p,1,1)[3]).toBe(128);});
 it('invalid dynamics rejected before mutation',()=>{const {p,l,f}=setup();expect(()=>paintDynamic(p,l,f,[sample(1,1)],options,null,{...DEFAULT_DYNAMICS,spacing:0})).toThrow();expect(px(p,1,1)[3]).toBe(0);});
});
describe('text/raster overlay and curves',()=>{
 it('overlay expands a cropped cel and preserves original pixels',()=>{const {p,l,f}=setup(),im=p.images[p.cels[0].imageId];im.width=im.height=1;im.data=new Uint8Array(red);rasterOverlay(p,l,f,new Uint8Array([0,255,0,255]),1,1,3,2);expect(px(p,0,0)).toEqual(red);expect(px(p,3,2)).toEqual([0,255,0,255]);});
 it('overlay handles indexed and grayscale target modes',()=>{for(const mode of ['indexed','gray'] as const){const p=createProject(2,2,'test',mode);rasterOverlay(p,p.layers[0].id,p.frames[0].id,new Uint8Array([255,255,255,255]),1,1,0,0);expect(renderFrame(p,p.frames[0].id)[3]).toBe(255);}});
 it('overlay respects selection and preserves alpha compositing',()=>{const {p,l,f}=setup(),sel=new Uint8Array(64);sel[1]=255;rasterOverlay(p,l,f,new Uint8Array([255,0,0,128,255,0,0,128]),2,1,0,0,255,sel);expect(px(p,0,0)[3]).toBe(0);expect(px(p,1,0)[3]).toBe(128);});
 it('identity and inverted linear curves use exact channel maps',()=>{const {p,l,f}=setup();paint(p,l,f,'pencil',[{x:0,y:0}],{...options,color:[60,100,200,128]});applyAdjustment(p,l,f,{kind:'curve',curve:[[0,255],[255,0]],channel:'red'});expect(px(p,0,0)).toEqual([195,100,200,128]);});
 it('curve and NaN adjustment validation is atomic',()=>{const {p,l,f}=setup();paint(p,l,f,'pencil',[{x:0,y:0}],options);const before=renderFrame(p,f);expect(()=>applyAdjustment(p,l,f,{kind:'curve',curve:[[0,0],[0,200],[255,255]]})).toThrow();expect(()=>applyAdjustment(p,l,f,{kind:'gamma',gamma:NaN})).toThrow();expect(renderFrame(p,f)).toEqual(before);});
});
