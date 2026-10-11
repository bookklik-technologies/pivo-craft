// Contracts for PiVo Craft.
export type Mode = 'rgba'|'gray'|'indexed';
export type RGBA = [number,number,number,number];
export type Direction = 'forward'|'reverse'|'pingpong'|'pingpong-reverse';
export type Blend = 'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity'|'addition'|'subtract'|'divide';
export interface ImageDataModel { id:string;width:number;height:number;mode:Mode;data:Uint8Array }
export interface Frame { id:string;duration:number }
export interface Layer { id:string;name:string;kind:'image'|'group'|'tilemap';visible:boolean;locked:boolean;opacity:number;blend:Blend;continuous:boolean;background:boolean;parent:string|null;isolated:boolean;tilesetId?:string }
export interface Cel { id:string;frameId:string;layerId:string;imageId:string;x:number;y:number;opacity:number;z:number;linkId?:string }
export interface Tag { id:string;name:string;from:string;to:string;direction:Direction;repeat:number;color:RGBA }
export interface SliceKey { frameId:string;x:number;y:number;width:number;height:number;center?:{x:number;y:number;width:number;height:number};pivot?:{x:number;y:number} }
export interface Slice { id:string;name:string;keys:SliceKey[] }
export interface PaletteKey { frameId:string;colors:RGBA[] }
export interface TileSet { id:string;name:string;width:number;height:number;tiles:ImageDataModel[];baseIndex:number }
export interface TileCell { tile:number;flipX:boolean;flipY:boolean;diagonal:boolean }
export interface TileMap { id:string;frameId:string;layerId:string;width:number;height:number;x:number;y:number;cells:TileCell[] }
export interface Diagnostic { code:string;severity:'warning'|'error'|'info';message:string }
export interface Project { version:1;id:string;name:string;width:number;height:number;mode:Mode;transparentIndex:number;pixelRatio:[number,number];frames:Frame[];layers:Layer[];images:Record<string,ImageDataModel>;cels:Cel[];palette:RGBA[];paletteKeys:PaletteKey[];tags:Tag[];slices:Slice[];tilesets:TileSet[];tilemaps:TileMap[];revision:number;diagnostics:Diagnostic[] }
export type Tool = 'pencil'|'eraser'|'line'|'rectangle'|'ellipse'|'fill'|'gradient'|'select'|'wand'|'move'|'eyedropper'|'polygon';
export type Ink = 'simple'|'alpha'|'copy'|'lock'|'shade';
export interface PaintOptions { color:RGBA;size:number;opacity:number;ink:Ink;selection?:Uint8Array|null;brush:'square'|'round';tolerance?:number;contiguous?:boolean;connectivity?:4|8;reference?:Uint8Array;symmetryX?:number;symmetryY?:number;wrap?:boolean;pixelPerfect?:boolean;ramp?:RGBA[];shadeStep?:number }
export interface Point { x:number;y:number }
export interface Rect { x:number;y:number;width:number;height:number }
export interface AtlasOptions { layout:'horizontal'|'vertical'|'grid'|'packed';columns:number;padding:number;trim:boolean;deduplicate:boolean;frameIds?:string[] }
export interface AtlasRecord { filename:string;frame:{x:number;y:number;w:number;h:number};rotated:false;trimmed:boolean;spriteSourceSize:{x:number;y:number;w:number;h:number};sourceSize:{w:number;h:number};duration:number }
export interface AtlasResult { width:number;height:number;pixels:Uint8Array;frames:AtlasRecord[];meta:Record<string,unknown> }
