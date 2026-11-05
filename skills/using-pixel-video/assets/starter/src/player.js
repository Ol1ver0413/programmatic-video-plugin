import {drawScene} from './scenes.js';
import {clamp} from './drawing.js';

const canvas=document.querySelector('#film'),screen=canvas.getContext('2d',{alpha:false});
const audio=document.querySelector('audio'),play=document.querySelector('#play'),scrub=document.querySelector('#scrub'),status=document.querySelector('#status');
const renderMode=new URLSearchParams(location.search).has('render');
try{
  const project=await fetch('project.json').then(r=>r.json());
  const captions=project.captions?await fetch(project.captions).then(r=>r.json()):[];
  const hasAudio=Boolean(project.audio);
  canvas.width=project.width;canvas.height=project.height;scrub.max=project.duration;
  if(hasAudio)audio.src=project.audio;
  document.querySelector('#title').textContent=project.title;
  if(project.font){const font=new FontFace('Pixel',`url(${project.font})`);document.fonts.add(await font.load());await document.fonts.ready;}
  const assets=Object.fromEntries(await Promise.all(Object.entries(project.assets||{}).map(async([key,url])=>[key,await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error(`Cannot load ${url}`));im.src=url})])));
  const world=document.createElement('canvas');world.width=project.logicalWidth;world.height=project.logicalHeight;
  const ctx=world.getContext('2d',{alpha:false}),w=world.width,h=world.height,band=Math.round(h*.14);
  function wrap(text,max){
    const lines=[];let row='';
    for(const paragraph of text.split('\n')){
      for(const token of paragraph.split(/(\s+)/).filter(Boolean)){
        if(ctx.measureText(row+token).width<=max){row+=token;continue}
        if(row.trim()){lines.push(row.trim());row=''}
        for(const char of token){if(ctx.measureText(row+char).width>max&&row){lines.push(row);row=''}row+=char}
      }
      if(row.trim())lines.push(row.trim());row='';
    }
    return lines;
  }
  function render(seconds){
    const t=clamp(seconds,0,Math.max(0,project.duration-1e-7));
    const scene=project.scenes.find(s=>t>=s.start&&t<s.end);if(!scene)throw new Error(`No scene at ${t}`);
    ctx.save();ctx.imageSmoothingEnabled=false;ctx.fillStyle='#101b2c';ctx.fillRect(0,0,w,h);
    drawScene({ctx,scene,time:t,local:t-scene.start,progress:(t-scene.start)/(scene.end-scene.start),width:w,height:h,assets});ctx.restore();
    const cue=project.burnCaptions===false?undefined:captions.find(c=>t>=c.start&&t<c.end);
    if(cue){
      ctx.fillStyle='#080e19';ctx.fillRect(0,h-band,w,band);ctx.fillStyle='#796b50';ctx.fillRect(0,h-band,w,1);
      ctx.save();let lines,size=Math.max(8,Math.round(h/15));
      do{ctx.font=`${size}px Pixel,monospace`;lines=wrap(cue.text,w-16);if(lines.length<=2)break;size--}while(size>=8);
      if(lines.length>2){ctx.restore();throw new Error(`Caption too long to fit: ${cue.text}`)}
      ctx.fillStyle='#eee1bd';ctx.textAlign='center';ctx.textBaseline='top';
      const yy=h-band+(band-lines.length*size)/2;
      lines.forEach((text,i)=>ctx.fillText(text,w/2,yy+i*size));ctx.restore();
    }
    screen.imageSmoothingEnabled=false;screen.drawImage(world,0,0,canvas.width,canvas.height);
    if(!renderMode){scrub.value=t;document.querySelector('#time').textContent=`${t.toFixed(1)} / ${project.duration.toFixed(1)}s`;}
    return{time:t,scene:scene.id,caption:cue?.text||''};
  }
  let position=0,playing=false,lastTick=performance.now();
  play.onclick=async()=>{
    if(hasAudio){if(audio.paused){if(audio.currentTime>=project.duration-.01)audio.currentTime=0;await audio.play()}else audio.pause()}
    else{if(position>=project.duration-.01)position=0;playing=!playing;lastTick=performance.now();play.textContent=playing?'暂停':'播放'}
  };
  audio.onplay=()=>play.textContent='暂停';audio.onpause=()=>play.textContent='播放';
  scrub.oninput=()=>{position=Number(scrub.value);lastTick=performance.now();if(hasAudio)audio.currentTime=position;render(position)};
  function tick(){
    const now=performance.now();
    if(hasAudio&&!audio.paused){if(audio.currentTime>=project.duration)audio.pause();render(audio.currentTime)}
    else if(!hasAudio&&playing){position=Math.min(project.duration,position+(now-lastTick)/1000);if(position>=project.duration){playing=false;play.textContent='播放'}render(position)}
    lastTick=now;requestAnimationFrame(tick);
  }
  window.__render=render;window.__project=project;window.__captions=captions;
  window.__playback={get playing(){return hasAudio?!audio.paused:playing},get time(){return hasAudio?audio.currentTime:position}};
  render(0);window.__ready=true;status.textContent='';if(!renderMode)tick();
}catch(error){window.__error=error.message;status.textContent=error.message;console.error(error)}
