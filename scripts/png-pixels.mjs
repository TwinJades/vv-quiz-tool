import { inflateSync } from 'node:zlib';
// Chrome's RGB/RGBA PNG screenshots only; no page or game state is decoded.
export function screenshotPixels(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid screenshot PNG');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),bpp=png[25]===6?4:png[25]===2?3:0;
  if(!width||!height||width*height>25000000||!bpp||png[24]!==8||png[28]!==0)throw new Error('Unsupported screenshot PNG');
  const chunks=[];
  for(let offset=8;offset+12<=png.length;){const length=png.readUInt32BE(offset);if(offset+length+12>png.length)throw new Error('Truncated screenshot PNG');if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));offset+=length+12;}
  const stride=width*bpp,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height)throw new Error('Invalid screenshot rows');
  const pixels=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let i=0;i<stride;i++){const at=y*stride+i,left=i<bpp?0:pixels[at-bpp],up=y?pixels[at-stride]:0,corner=y&&i>=bpp?pixels[at-stride-bpp]:0;const adjustment=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,corner):NaN;if(!Number.isFinite(adjustment))throw new Error('Unsupported screenshot filter');pixels[at]=(raw[y*(stride+1)+1+i]+adjustment)&255;}}
  return {width,height,rgb(x,y){x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)throw new Error('Screenshot sample out of bounds');const at=(y*width+x)*bpp;return [...pixels.subarray(at,at+3)];}};
}

export function wordwallStartPoint(image,rect) {
  if(rect.width<400||rect.height<250||rect.x<0||rect.y<0||rect.x+rect.width>image.width||rect.y+rect.height>image.height)return null;
  const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  const blue=([r,g,b])=>r<90&&g>140&&g<225&&b>230;
  const white=([r,g,b])=>r>235&&g>235&&b>235;
  const corners=[[-40,-40],[40,-40],[-40,40],[40,40]].map(([x,y])=>image.rgb(point.x+x,point.y+y));
  if(corners.filter(blue).length<3||!white(image.rgb(point.x-5,point.y-10)))return null;
  return point;
}
