import { inflateSync } from "node:zlib";

// Read-only QA for this project's 300x180 Canvas fixture, not OCR or a
// product completion detector. Exclude its one-pixel protocol marker.
export function canvasScoreInk(png, region = {x:20,y:48,width:170,height:28}) {
  const width=png.readUInt32BE(16), height=png.readUInt32BE(20);
  const bpp=png[25]===6?4:png[25]===2?3:0;
  if(!bpp||png[24]!==8||png[28]!==0)throw new Error("Unsupported fixture PNG");
  const chunks=[];
  for(let p=8;p<png.length;){
    const n=png.readUInt32BE(p);
    if(png.toString("ascii",p+4,p+8)==="IDAT")chunks.push(png.subarray(p+8,p+8+n));
    p+=n+12;
  }
  const decoded=inflateSync(Buffer.concat(chunks)),stride=width*bpp;
  let previous=new Uint8Array(stride),ink=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const f=decoded[y*(stride+1)],row=Uint8Array.from(decoded.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let x=0;x<stride;x++){
      const left=x<bpp?0:row[x-bpp],up=previous[x],corner=x<bpp?0:previous[x-bpp];
      const add=f===0?0:f===1?left:f===2?up:f===3?Math.floor((left+up)/2):f===4?paeth(left,up,corner):NaN;
      if(Number.isNaN(add))throw new Error("Unsupported PNG filter");
      row[x]=(row[x]+add)&255;
    }
    if(y>=region.y&&y<region.y+region.height)for(let x=region.x;x<Math.min(width,region.x+region.width);x++){
      const p=x*bpp;if(row[p]<180&&row[p+1]<180&&row[p+2]<180&&(bpp!==4||row[p+3]>200))ink++;
    }
    previous=row;
  }
  return ink;
}
