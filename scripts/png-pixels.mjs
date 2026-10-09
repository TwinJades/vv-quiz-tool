import {PNG} from 'pngjs';
export function screenshotPixels(png) {
  if(!Buffer.isBuffer(png)||png.length>100000000)throw new Error('Invalid screenshot PNG');
  const {width,height,data}=PNG.sync.read(png,{checkCRC:true});
  if(!width||!height||width*height>25000000)throw new Error('Screenshot dimensions exceed the limit');
  return {width,height,rgb(x,y){x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)throw new Error('Screenshot sample out of bounds');return [...data.subarray((y*width+x)*4,(y*width+x)*4+3)];}};
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
