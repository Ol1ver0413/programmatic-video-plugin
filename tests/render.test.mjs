import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {cp,mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {probe,run} from '../cli/runtime/project.mjs';

const available=['ffmpeg','ffprobe'].every(exe=>spawnSync(exe,['-version'],{windowsHide:true}).status===0);
const starter=fileURLToPath(new URL('../templates/video',import.meta.url));
const cli=fileURLToPath(new URL('../cli/programmatic-video.mjs',import.meta.url));

// Real encoding and media checks, with a browser stub only to inject deterministic failures.
test('failed exports preserve the previous delivery and successful exports publish a verified video', {skip:!available}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'programmatic-video-render-'));
  t.after(async()=>{
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('programmatic-video-render-'));
    await rm(root,{recursive:true,force:true});
  });
  await cp(starter,root,{recursive:true});
  await cp(fileURLToPath(new URL('../cli/runtime',import.meta.url)),path.join(root,'tools'),{recursive:true});
  const project=JSON.parse(await readFile(path.join(root,'project.json'),'utf8'));
  Object.assign(project,{duration:1,fps:4,width:32,height:32,logicalWidth:32,logicalHeight:32,audio:null,captions:null,font:null});
  project.scenes=[{id:'fixture',start:0,end:1}];
  await writeFile(path.join(root,'project.json'),JSON.stringify(project));
  const dependency=path.join(root,'node_modules/playwright');await mkdir(dependency,{recursive:true});
  await writeFile(path.join(dependency,'package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));
  await writeFile(path.join(dependency,'index.mjs'),`
    import {readFile} from 'node:fs/promises';
    const png=(await readFile(new URL('../../frame.png',import.meta.url))).toString('base64');
    export const chromium={launch:async()=>({close:async()=>{},newPage:async()=>{
      let errors,frames=0;
      return {on:(name,callback)=>{if(name==='pageerror')errors=callback},goto:async()=>{},waitForFunction:async()=>{},
        evaluate:async(fn,time)=>{
          if(typeof time!=='number')return undefined;
          frames++;
          if(frames===5&&process.env.RENDER_FAILURE==='frame')throw new Error('Injected frame failure');
          if(frames===5&&process.env.RENDER_FAILURE==='browser')errors(new Error('Injected browser failure'));
          return process.env.RENDER_FAILURE==='encoder'?'not a PNG':png;
        }};
    }})};
  `);
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',path.join(root,'frame.png')]);
  const out=path.join(root,'output');await mkdir(out);
  const video=path.join(out,'video.mp4'),report=path.join(out,'render-report.json');
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32:r=4:d=1','-c:v','libx264','-pix_fmt','yuv420p',video]);
  const previousVideo=await readFile(video),previousReport='{"full_decode":"passed","delivery":"previous"}';
  await writeFile(report,previousReport);
  const render=(failure,entry=path.join(root,'tools/render.mjs'))=>spawnSync(process.execPath,
    entry===cli?[cli,'render','--project',root]:[entry],
    {cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,RENDER_FAILURE:failure},timeout:30000});
  for(const failure of ['frame','browser','encoder','media']) {
    await t.test(failure,async()=>{
      project.width=failure==='media'?64:32;project.height=project.width;
      await writeFile(path.join(root,'project.json'),JSON.stringify(project));
      const result=render(failure);
      assert.equal(result.status,1,result.stderr);
      assert.match(result.stderr,failure==='media'?/does not match/:failure==='encoder'?/FFmpeg|PNG|png|Invalid/:/Injected/);
      assert.deepEqual(await readFile(video),previousVideo);
      assert.equal(await readFile(report,'utf8'),previousReport);
      assert.ok(!(await readdir(out)).some(name=>name.includes('.tmp')));
    });
  }
  project.width=32;project.height=32;await writeFile(path.join(root,'project.json'),JSON.stringify(project));
  const result=render('',cli);assert.equal(result.status,0,result.stderr);
  assert.notDeepEqual(await readFile(video),previousVideo);
  const saved=JSON.parse(await readFile(report,'utf8'));
  assert.equal(saved.full_decode,'passed');assert.equal(saved.frames,4);assert.equal(saved.has_audio,false);
  assert.deepEqual(saved.browser_errors,[]);assert.equal(probe(video).streams[0].width,32);
  assert.ok(!(await readdir(out)).some(name=>name.includes('.tmp')));
});
