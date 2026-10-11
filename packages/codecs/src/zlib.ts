// Original bounded zlib framing adapter over fflate, not raw DEFLATE.
import { zlibSync, unzlibSync } from 'fflate';
export function deflateSync(bytes:Uint8Array):Uint8Array { return zlibSync(bytes,{level:6}); }
export function inflateReusable(data:Uint8Array,expected:number,_ratio=4096):Uint8Array {
 if(!Number.isSafeInteger(expected)||expected<1||expected>256*1024*1024)throw new Error('Invalid decoded size');
 if(data.length<6||(data[0]&15)!==8||(data[0]>>4)>7||((data[0]<<8)+data[1])%31||data[1]&32)throw new Error('Invalid zlib header');
 const out=unzlibSync(data,{out:new Uint8Array(expected+1)});
 if(out.length!==expected)throw new Error('Decoded zlib length mismatch');
 let a=1,b=0;for(const v of out){a=(a+v)%65521;b=(b+a)%65521;}
 const checksum=((b<<16)|a)>>>0,n=data.length;const stored=new DataView(data.buffer,data.byteOffset+n-4,4).getUint32(0);
 if(checksum!==stored)throw new Error('Invalid zlib Adler checksum');
 return out;
}
