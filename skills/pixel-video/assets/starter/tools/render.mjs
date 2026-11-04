import {chromium} from 'playwright';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startServer,root} from './server.mjs';
import {checkAndWrite,run,probe,localFile} from './project.mjs';

let browser,server,encoder;
try{
  const {project}=await checkAndWrite(root),out=path.join(root,'output');
  const started=await startServer();server=started.server;
  const choices=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const executablePath=choices.find(p=>p&&existsSync(p));
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:project.width,height:project.height}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(started.url+'/?render=1');
  await page.waitForFunction(()=>window.__ready||window.__error,undefined,{timeout:60000});
  const startupError=await page.evaluate(()=>window.__error);if(startupError)throw new Error(startupError);
  const frame=async t=>Buffer.from(await page.evaluate(t=>{window.__render(t);return document.querySelector('#film').toDataURL('image/png').split(',')[1]},t),'base64');
  await mkdir(path.join(out,'stills'),{recursive:true});
  const stills=[];
  for(const [i,s]of project.scenes.entries())for(const part of [.15,.5,.85]){
    const time=s.start+(s.end-s.start)*part,name=`${String(i+1).padStart(2,'0')}-${Math.round(part*100)}.png`;
    await writeFile(path.join(out,'stills',name),await frame(time));stills.push({scene:s.id,time,file:'stills/'+name});
  }
  await writeFile(path.join(out,'stills.json'),JSON.stringify(stills,null,2));
  if(!process.argv.includes('--stills')){
    const destination=path.join(out,'video.mp4'),frames=Math.ceil(project.duration*project.fps-1e-9);
    encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(project.fps),'-c:v','png','-i','pipe:0','-i',localFile(root,project.audio),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',String(project.duration),'-movflags','+faststart',destination],{stdio:['pipe','ignore','pipe'],windowsHide:true});
    let stderr='';encoder.stderr.on('data',chunk=>stderr+=chunk.toString());encoder.stdin.on('error',()=>{});
    const completion=new Promise((resolve,reject)=>{encoder.once('error',reject);encoder.once('close',code=>code===0?resolve():reject(new Error(stderr||`FFmpeg exited ${code}`)))});
    completion.catch(()=>{});
    for(let i=0;i<frames;i++){
      if(encoder.exitCode!==null)throw new Error(stderr||'Encoder stopped early');
      const bytes=await frame(i/project.fps);
      if(!encoder.stdin.write(bytes))await Promise.race([once(encoder.stdin,'drain'),completion]);
      if(i%(project.fps*5)===0)console.log(`Rendering ${i}/${frames}`);
    }
    encoder.stdin.end();await completion;
    if(errors.length)throw new Error(errors.join('\n'));
    const info=probe(destination),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
    if(!video||!audio||video.width!==project.width||video.height!==project.height||Number(video.nb_frames)!==frames||Math.abs(Number(info.format.duration)-project.duration)>1/project.fps+.025)throw new Error('Exported media does not match the project');
    run('ffmpeg',['-hide_banner','-v','error','-i',destination,'-f','null','-']);
    await writeFile(path.join(out,'render-report.json'),JSON.stringify({duration_seconds:Number(info.format.duration),width:video.width,height:video.height,fps:video.r_frame_rate,frames,has_audio:true,full_decode:'passed',browser_errors:errors},null,2));
    console.log(`DONE ${destination}`);
  }else{if(errors.length)throw new Error(errors.join('\n'));console.log(`Saved ${stills.length} stills`)}
}catch(error){console.error(error.message);process.exitCode=1}
finally{if(encoder&&encoder.exitCode===null)encoder.kill();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
