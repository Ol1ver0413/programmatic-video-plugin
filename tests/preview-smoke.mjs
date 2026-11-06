// Real browser/FFmpeg integration. Pass a local Playwright entry; all artifacts are owned fixtures.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openBrowser,loadProjectPage} from '../skills/using-programmatic-video/assets/starter/tools/browser.mjs';
import {startServer} from '../skills/using-programmatic-video/assets/starter/tools/server.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const dependency=path.resolve(process.argv[2]||path.join(repo,'.work/smoke/node_modules/playwright/index.mjs'));
const parent=await mkdtemp(path.join(os.tmpdir(),'programmatic-video-preview-'));
const project=path.join(parent,'project'),cli=path.join(repo,'scripts/programmatic-video.mjs');
function command(executable,args){
  const result=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;
}
const invoke=(...args)=>command(process.execPath,[cli,...args]);
const json=async file=>JSON.parse(await readFile(file,'utf8'));
function pixels(file){
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-vf','crop=2:2:250:50','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
  assert.equal(result.status,0,result.stderr?.toString());return [...result.stdout.subarray(0,3)];
}
try{
  invoke('init','--out',project,'--duration','3');
  await symlink(path.dirname(path.dirname(dependency)),path.join(project,'node_modules'),process.platform==='win32'?'junction':'dir');
  const file=path.join(project,'project.json'),config=await json(file);
  Object.assign(config,{width:320,height:180,logicalWidth:160,logicalHeight:90,fps:10,font:null,pixelArt:false,audio:'tone.wav'});
  config.scenes=[{id:'intro',start:0,end:1},{id:'action',start:1,end:2},{id:'ending',start:2,end:3}];
  await writeFile(file,JSON.stringify(config));
  await writeFile(path.join(project,'captions.json'),JSON.stringify([{start:0,end:1,text:'FIRST'},{start:1,end:2,text:'SECOND'},{start:2,end:3,text:'THIRD'}]));
  await writeFile(path.join(project,'src/scenes.js'),`export function drawScene({ctx,time,width,height}){ctx.fillStyle=['#ee0000','#00dd00','#0000ee'][Math.min(2,Math.floor(time))];ctx.fillRect(0,0,width,height);}`);
  command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=220:duration=1','-f','lavfi','-i','sine=frequency=660:duration=2','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1[a]','-map','[a]',path.join(project,'tone.wav')]);
  const preview=await startServer(0,project);let browser;
  try{
    browser=await openBrowser(project);const {page}=await loadProjectPage(browser,preview.url,config);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#film')).imageRendering),'auto');
  }finally{if(browser)await browser.close();await new Promise(resolve=>preview.server.close(resolve));}
  invoke('render','--project',project);
  const original=await readFile(path.join(project,'output/video.mp4'));
  invoke('render','--project',project,'--scene','action','--out','output/previews/action.mp4');
  const report=await json(path.join(project,'output/previews/action.mp4.report.json'));
  assert.equal(report.frames,10);assert.equal(report.source_start_seconds,1);assert.equal(report.kind,'preview');assert.equal(report.has_audio,true);
  assert.deepEqual(await readFile(path.join(project,'output/video.mp4')),original);
  assert.equal((await json(file)).duration,3);
  await symlink(path.join(project,'output'),path.join(project,'alias-output'),process.platform==='win32'?'junction':'dir');
  const protectedPaths=['output/video.mp4','alias-output/video.mp4',...(process.platform==='win32'?['OUTPUT/VIDEO.MP4']:[])];
  for(const output of protectedPaths){
    const rejected=spawnSync(process.execPath,[cli,'render','--project',project,'--scene','action','--out',output],{encoding:'utf8',windowsHide:true});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/cannot replace/);
  }
  const runtime=JSON.parse(invoke('frames','--project',project,'--times','0.2,1.2,2.2','--out','output/review/runtime'));
  const encoded=JSON.parse(invoke('frames','--project',project,'--input','output/video.mp4','--times','0.2,1.2,2.2','--out','output/review/final'));
  const partial=JSON.parse(invoke('frames','--project',project,'--input','output/previews/action.mp4','--times','0.2,0.5','--out','output/review/partial'));
  for(const [index,fileName]of ['001.png','002.png','003.png'].entries()){
    for(const directory of [runtime.directory,encoded.directory]){
      const rgb=pixels(path.join(directory,fileName));assert.ok(rgb[index]>190);assert.ok(rgb[(index+1)%3]<40);
    }
  }
  assert.ok(pixels(path.join(partial.directory,'001.png'))[1]>190);
  assert.equal((await json(runtime.report)).kind,'canvas-runtime-samples');
  assert.equal((await json(encoded.report)).kind,'encoded-video-samples');
  assert.equal((await json(partial.report)).time_basis,'input-video-seconds');
  await writeFile(file,JSON.stringify({...config,duration:2,scenes:config.scenes.slice(0,2),assets:{retired:'missing-old-asset.png'}}));
  const oldDelivery=JSON.parse(invoke('frames','--project',project,'--input','output/video.mp4','--times','2.2','--out','output/review/old-delivery'));
  assert.ok(pixels(path.join(oldDelivery.directory,'001.png'))[2]>190);
  const pcm=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(project,'output/previews/action.mp4'),'-vn','-ac','1','-ar','44100','-f','f32le','pipe:1'],{windowsHide:true});
  assert.equal(pcm.status,0,pcm.stderr?.toString());
  const energy=frequency=>{
    let real=0,imaginary=0;
    for(let i=4410;i<Math.min(35000,pcm.stdout.length/4);i++){
      const sample=pcm.stdout.readFloatLE(i*4),phase=2*Math.PI*frequency*i/44100;
      real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);
    }
    return real*real+imaginary*imaginary;
  };
  assert.ok(energy(660)>energy(220)*100,'Range audio must seek to the second source segment');
  console.log(JSON.stringify({passed:true,frames:report.frames,globalClock:true,audioOffset:true,canonicalDeliveryPreserved:true,runtimeAndEncodedSampling:true,contactSheet:runtime.contactSheet}));
  if(process.env.KEEP_PREVIEW_FIXTURE==='1')console.log('Retained fixture: '+parent);
}finally{
  assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith('programmatic-video-preview-'));
  if(process.env.KEEP_PREVIEW_FIXTURE!=='1')await rm(parent,{recursive:true,force:true});
}
