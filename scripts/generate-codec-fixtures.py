from pathlib import Path
import struct,zlib,json
from PIL import Image
root=Path(__file__).resolve().parent/'packages'/'codecs'/'test'/'fixtures'
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
def png(name,w,h,depth,kind,raw,extra=[],interlace=0):
 blob=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,depth,kind,0,0,interlace))+b''.join(chunk(k,v) for k,v in extra)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'');(root/name).write_bytes(blob)
 im=Image.open(root/name).convert('RGBA');(root/(name+'.expected.json')).write_text(json.dumps({'width':w,'height':h,'pixels':list(im.tobytes())}))
png('gray-fourbit.png',3,1,4,0,bytes([0,0x08,0xf0]))
png('rgb16-transparent.png',2,1,16,2,b'\0'+struct.pack('>HHHHHH',65535,0,32768,0,65535,0),[(b'tRNS',struct.pack('>HHH',65535,0,32768))])
# PNG tRNS compares full 16-bit samples before reduction. Pillow's RGB16->RGBA
# conversion drops that comparison; this specific fixture uses the declared-word golden.
(root/'rgb16-transparent.png.expected.json').write_text(json.dumps({'width':2,'height':1,'pixels':[255,0,128,0,0,255,0,255]}))
w,h=9,7;raw=b''
for x,y,dx,dy in [(0,0,8,8),(4,0,8,8),(0,4,4,8),(2,0,4,4),(0,2,2,4),(1,0,2,2),(0,1,1,2)]:
 for row in range(y,h,dy):
  pixels=b''.join(bytes([col*20,row*30,(col+row)*10,255]) for col in range(x,w,dx))
  if pixels:raw+=b'\0'+pixels
png('adam7-rgba.png',w,h,8,6,raw,interlace=1)
for name in ['indexed-transparent.png','gray-onebit.png']:
 im=Image.open(root/name).convert('RGBA');(root/(name+'.expected.json')).write_text(json.dumps({'width':im.width,'height':im.height,'pixels':list(im.tobytes())}))
print('PNG fixtures generated and decoded with Python/Pillow')
