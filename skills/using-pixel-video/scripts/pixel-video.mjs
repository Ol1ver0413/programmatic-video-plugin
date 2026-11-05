#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {existsSync} from 'node:fs';
import {cp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {run,probe,checkCues,checkAndWrite} from '../assets/starter/tools/project.mjs';
import {initWorkflow,context,checkpoint,finish,remember,readMemory} from './workflow.mjs';

const skillDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=file=>readFile(file,'utf8').then(value=>JSON.parse(value.replace(/^\uFEFF/,'')));
const save=(file,data)=>writeFile(file,JSON.stringify(data,null,2)+'\n');
const number=(value,name)=>{const n=Number(value);if(value===undefined||!Number.isFinite(n))throw new Error(`${name} must be a number`);return n};
function newFile(file){if(existsSync(file))throw new Error(`Will not overwrite ${file}`)}
function audioDuration(file){const info=probe(file);if(!info.streams.some(s=>s.codec_type==='audio'))throw new Error('Input has no audio stream');const d=Number(info.format.duration);if(!Number.isFinite(d)||d<=0)throw new Error('Cannot determine audio duration');return d}

export function parseCaptions(text,format){
  let cues;
  if(format==='.json')cues=JSON.parse(text.replace(/^\uFEFF/,''));
  else if(format==='.srt'){
    const time=s=>{const match=/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(s.trim());if(!match||Number(match[2])>59||Number(match[3])>59)throw new Error(`Invalid SRT timestamp: ${s}`);return Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000};
    cues=text.replace(/^\uFEFF/,'').trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map(block=>{
      const lines=block.split(/\r?\n/);if(/^\d+$/.test(lines[0].trim()))lines.shift();
      const range=lines.shift().split(/\s+-->\s+/);if(range.length!==2)throw new Error('Invalid SRT cue');
      return {start:time(range[0]),end:time(range[1]),text:lines.join('\n')};
    });
  }else throw new Error('Captions must be .srt or .json');
  const errors=checkCues(cues,Number.MAX_VALUE);if(errors.length)throw new Error(errors.join('\n'));
  return cues;
}
export function clipCaptions(cues,offset,duration){
  if(!Number.isFinite(offset)||offset<0||!Number.isFinite(duration)||duration<=0)throw new Error('offset must be nonnegative and duration positive');
  return cues.filter(c=>c.end>offset&&c.start<offset+duration).map(c=>({start:Math.max(0,c.start-offset),end:Math.min(duration,c.end-offset),text:c.text}));
}
async function init(values){
  if(!values.out)throw new Error('init requires --out');
  if(values.audio&&values.demo)throw new Error('Choose --audio or --demo, not both');
  if(values.duration&&(values.audio||values.demo))throw new Error('--duration is for silent projects; audio and demo supply their own duration');
  const target=path.resolve(values.out);newFile(target);
  const source=values.audio?path.resolve(values.audio):null;
  const duration=source?audioDuration(source):values.demo?8:number(values.duration??'8','duration');
  if(duration<=0)throw new Error('duration must be positive');
  await mkdir(path.dirname(target),{recursive:true});await cp(path.join(skillDir,'assets/starter'),target,{recursive:true});
  const audioName=source?'clip'+path.extname(source).toLowerCase():'demo.wav';
  const audioFile=path.join(target,'assets/audio',audioName);
  if(source||values.demo)await mkdir(path.dirname(audioFile),{recursive:true});
  if(source)await copyFile(source,audioFile);
  else if(values.demo)run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=8','-af','volume=0.06,tremolo=f=2:d=0.95','-ac','2',audioFile]);
  const project=await json(path.join(target,'project.json'));
  project.title=values.title?.trim()||path.basename(target);
  project.duration=duration;project.audio=(source||values.demo)?'assets/audio/'+audioName:null;
  const bounds=[0,duration/3,duration*2/3,duration];
  project.scenes.forEach((s,i)=>{s.start=bounds[i];s.end=bounds[i+1]});
  await save(path.join(target,'project.json'),project);
  await save(path.join(target,'captions.json'),values.demo?project.scenes.map((s,i)=>({start:s.start,end:s.end,text:['Run to the gate','Open a new way','Make the landing'][i]})):[]);
  if(project.audio)await save(path.join(target,'assets/audio/source.json'),{kind:source?'user-file':'generated-demo-tone',source_file:source?path.basename(source):null,sha256:createHash('sha256').update(await readFile(audioFile)).digest('hex'),duration_seconds:duration});
  await initWorkflow(target,project.title);
  console.log(`Created ${target}\nStart with brief.md and plan.md. This is an editable starter, not a content-derived storyboard. Run pixel-video context --project "${target}" to resume.`);
}
async function cutAudio(v){
  if(!v.input||!v.out)throw new Error('audio requires --input and --out');
  const start=number(v.start??'0','start'),duration=number(v.duration,'duration');
  if(start<0||duration<=0)throw new Error('start must be nonnegative and duration positive');
  const input=path.resolve(v.input),out=path.resolve(v.out);newFile(out);newFile(out+'.source.json');
  if(path.extname(out).toLowerCase()!=='.wav')throw new Error('Use a .wav output to preserve the selected audio without another lossy encoding');
  if(start+duration>audioDuration(input)+.025)throw new Error('Selected interval exceeds the audio duration');
  await mkdir(path.dirname(out),{recursive:true});
  run('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(start),'-i',input,'-t',String(duration),'-vn','-c:a','pcm_s16le',out]);
  const actual=audioDuration(out);if(Math.abs(actual-duration)>.025)throw new Error('Output duration differs from the requested clip');
  await save(out+'.source.json',{source_file:path.basename(input),source_sha256:createHash('sha256').update(await readFile(input)).digest('hex'),start_seconds:start,duration_seconds:duration,verified_duration_seconds:actual});
  console.log(out);
}
export async function main(argv=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:Object.fromEntries(['out','audio','input','project','start','duration','offset','title','memory-dir','stage','note','key','value','evidence','port'].map(x=>[x,{type:'string'}]).concat(['demo','help','confirmed','stills','version'].map(x=>[x,{type:'boolean'}])))});
  const command=positionals[0];
  if(values.version){console.log('0.2.1');return}
  if(values.help||!command){console.log(`pixel-video — pixel video projects, media tools and personal memory

  init --out DIR [--title TEXT] [--audio FILE | --demo | --duration SECONDS]
  context --project DIR [--memory-dir DIR]
  checkpoint --project DIR --stage STAGE --note TEXT
  preview --project DIR [--port NUMBER]
  render --project DIR [--stills]
  finish --project DIR --input REVIEW.json [--memory-dir DIR]
  memory [--memory-dir DIR]
  remember --key KEY --value TEXT --evidence TEXT --confirmed [--project DIR] [--memory-dir DIR]
  doctor
  audio --input FILE --out FILE.wav --start SECONDS --duration SECONDS
  captions --input FILE.srt|json --out FILE.json --offset SECONDS --duration SECONDS
  validate --project DIR

Stages: brainstorming, writing-plans, producing-video, finishing-video
init without audio creates a silent starter (8 seconds unless --duration is set).
Memory: --memory-dir > PIXEL_VIDEO_MEMORY_DIR > ~/.pixel-video/memory
The CLI stores records; the agent authors the story, animation, review and preferences.`);return}
  const allowed={doctor:[],init:['out','audio','demo','title','duration'],audio:['input','out','start','duration'],captions:['input','out','offset','duration'],validate:['project'],context:['project','memory-dir'],checkpoint:['project','stage','note'],preview:['project','port'],render:['project','stills'],finish:['project','input','memory-dir'],memory:['memory-dir'],remember:['key','value','evidence','confirmed','project','memory-dir']}[command];
  if(!allowed||positionals.length!==1)throw new Error(`Unknown command: ${positionals.join(' ')}`);
  for(const key of Object.keys(values))if(!allowed.includes(key))throw new Error(`${command} does not accept --${key}`);
  if(command==='doctor'){
    const report={node:process.versions.node};let ok=Number(process.versions.node.split('.')[0])>=20;
    for(const exe of ['ffmpeg','ffprobe']){try{report[exe]=run(exe,['-version']).split(/\r?\n/)[0]}catch(e){report[exe]=e.message;ok=false}}
    console.log(JSON.stringify({...report,browser:'Use system Chrome/Edge via CHROME_PATH, or install Chromium in the generated project',ok},null,2));if(!ok)process.exitCode=1;
  }else if(command==='init')await init(values);
  else if(command==='audio')await cutAudio(values);
  else if(command==='captions'){
    if(!values.input||!values.out)throw new Error('captions requires --input and --out');
    const out=path.resolve(values.out);newFile(out);const input=path.resolve(values.input);
    const cues=clipCaptions(parseCaptions(await readFile(input,'utf8'),path.extname(input).toLowerCase()),number(values.offset??'0','offset'),number(values.duration,'duration'));
    await mkdir(path.dirname(out),{recursive:true});await save(out,cues);console.log(`Wrote ${cues.length} captions to ${out}`);
  }else if(command==='validate'){const r=await checkAndWrite(path.resolve(values.project||'.'));console.log(JSON.stringify({ok:true,scenes:r.project.scenes.length,captions:r.cues.length,warnings:r.warnings},null,2))}
  else if(command==='memory')console.log(JSON.stringify(await readMemory(values['memory-dir']),null,2));
  else if(command==='remember')console.log(JSON.stringify(await remember({directory:values['memory-dir'],key:values.key,value:values.value,evidence:values.evidence,confirmed:values.confirmed,project:values.project}),null,2));
  else{
    if(!values.project)throw new Error(`${command} requires --project`);
    const root=path.resolve(values.project);
    if(command==='context')console.log(JSON.stringify(await context(root,values['memory-dir']),null,2));
    else if(command==='checkpoint')console.log(JSON.stringify(await checkpoint(root,values.stage,values.note),null,2));
    else if(command==='finish'){
      if(!values.input)throw new Error('finish requires --input REVIEW.json');
      console.log(JSON.stringify(await finish(root,await json(path.resolve(values.input)),values['memory-dir']),null,2));
    }else{
      await checkAndWrite(root);
      const args=command==='render'&&values.stills?['--stills']:[];
      let port;
      if(values.port!==undefined){port=number(values.port,'port');if(!Number.isInteger(port)||port<0||port>65535)throw new Error('port must be an integer from 0 to 65535')}
      if(command==='preview'){
        const {startServer}=await import(pathToFileURL(path.join(root,'tools/server.mjs')).href);
        const {server,url}=await startServer(port??4173);
        console.log(url);
        process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());
        return;
      }
      await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[path.join(root,'tools/render.mjs'),...args],{cwd:root,stdio:'inherit',windowsHide:true});
        child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} stopped: ${signal||code}`)));
      });
    }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1});
