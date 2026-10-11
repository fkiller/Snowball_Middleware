// Deterministic platform encodings of the existing Snowball artwork, no new artwork.
import {app,nativeImage} from 'electron';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const assets=fileURLToPath(new URL('../assets/',import.meta.url));
void app.whenReady().then(()=>{
try{
  const source=nativeImage.createFromPath(assets+'icon.png');
  if(source.isEmpty())throw Error('Snowball icon is missing');
  const png=size=>source.resize({width:size,height:size,quality:'best'}).toPNG();
  for(const size of [32,256])fs.writeFileSync(assets+`icon-${size}.png`,png(size));
  const sizes=[16,20,24,32,48,64,128,256],images=sizes.map(png);
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  sizes.forEach((size,i)=>{const at=6+16*i;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;});
  fs.writeFileSync(assets+'icon.ico',Buffer.concat([header,...images]));
  const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]].map(([kind,size])=>{const data=png(size),h=Buffer.alloc(8);h.write(kind,0,'ascii');h.writeUInt32BE(data.length+8,4);return Buffer.concat([h,data]);});
  const h=Buffer.alloc(8);h.write('icns',0,'ascii');h.writeUInt32BE(8+chunks.reduce((n,c)=>n+c.length,0),4);
  fs.writeFileSync(assets+'icon.icns',Buffer.concat([h,...chunks]));
  // Inno Setup's BMP support also covers older supported compiler versions.
  const bitmap=(width,height,size)=>{
    const pixels=source.resize({width:size,height:size,quality:'best'}).toBitmap(),stride=(width*3+3)&~3,bytes=Buffer.alloc(54+stride*height,255);
    bytes.fill(0,0,54);bytes.write('BM',0);bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(width,18);bytes.writeInt32LE(height,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);bytes.writeUInt32LE(stride*height,34);
    const left=Math.floor((width-size)/2),top=Math.floor((height-size)/2);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const from=(y*size+x)*4,to=54+(height-1-top-y)*stride+(left+x)*3,alpha=pixels[from+3];for(let c=0;c<3;c++)bytes[to+c]=Math.min(255,pixels[from+c]+255-alpha);}
    return bytes;
  };
  fs.writeFileSync(assets+'installer-small.bmp',bitmap(128,128,128));
  fs.writeFileSync(assets+'installer-welcome.bmp',bitmap(328,628,256));
  console.log(JSON.stringify({source:'assets/icon.png',sizes,formats:['png','ico','icns']}));
  app.exit(0);
}catch(error){console.error(error.message);app.exit(1);}
});
