export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const ease=x=>1-(1-clamp(x))**3;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const seeded=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};

export function makeAtlas(image,columns,rows){
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1)throw new Error('Invalid atlas grid');
  const width=Math.floor(image.width/columns),height=Math.floor(image.height/rows);
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,frames=[];
  for(let i=0;i<columns*rows;i++){
    const sx=i%columns*width,sy=Math.floor(i/columns)*height;let l=width,r=-1,t=height,b=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[((sy+y)*image.width+sx+x)*4+3]>160){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
    frames.push(r<0?null:{x:sx+l,y:sy+t,w:r-l+1,h:b-t+1});
  }
  return {image,frames,referenceHeight:Math.max(1,...frames.filter(Boolean).map(f=>f.h))};
}
export function drawAtlas(ctx,atlas,frame,{x,y,height,anchor,flip=false,rotation=0,alpha=1}){
  if(!Number.isInteger(frame)||frame<0||frame>=atlas.frames.length)throw new Error(`Unknown atlas frame ${frame}`);
  const box=atlas.frames[frame];if(!box)return null;
  const scale=height/atlas.referenceHeight;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(flip?-1:1,1);ctx.globalAlpha*=alpha;
  ctx.drawImage(atlas.image,box.x,box.y,box.w,box.h,-box.w*scale/2,-box.h*scale,box.w*scale,box.h*scale);ctx.restore();
  if(!anchor)return null;
  const ax=(anchor[0]-box.x-box.w/2)*scale*(flip?-1:1),ay=(anchor[1]-box.y-box.h)*scale;
  return {x:x+Math.cos(rotation)*ax-Math.sin(rotation)*ay,y:y+Math.sin(rotation)*ax+Math.cos(rotation)*ay};
}
