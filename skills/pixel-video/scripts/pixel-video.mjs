#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {existsSync} from 'node:fs';
import {cp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {run,probe,checkCues,checkAndWrite} from '../assets/starter/tools/project.mjs';

const skillDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=file=>readFile(file,'utf8').then(JSON.parse);
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
  if(Boolean(values.audio)===Boolean(values.demo))throw new Error('Choose --audio or --demo');
  const target=path.resolve(values.out);newFile(target);
  const source=values.audio?path.resolve(values.audio):null;
  const duration=source?audioDuration(source):8;
  await mkdir(path.dirname(target),{recursive:true});await cp(path.join(skillDir,'assets/starter'),target,{recursive:true});
  const audioName=source?'clip'+path.extname(source).toLowerCase():'demo.wav';
  await mkdir(path.join(target,'assets/audio'),{recursive:true});
  const audioFile=path.join(target,'assets/audio',audioName);
  if(source)await copyFile(source,audioFile);
  else run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=8','-af','volume=0.06,tremolo=f=2:d=0.95','-ac','2',audioFile]);
  const project=await json(path.join(target,'project.json'));
  project.duration=duration;project.audio='assets/audio/'+audioName;
  const bounds=[0,duration/3,duration*2/3,duration];
  project.scenes.forEach((s,i)=>{s.start=bounds[i];s.end=bounds[i+1]});
  await save(path.join(target,'project.json'),project);
  await save(path.join(target,'captions.json'),values.demo?project.scenes.map((s,i)=>({start:s.start,end:s.end,text:['Run to the gate','Open a new way','Make the landing'][i]})):[]);
  await save(path.join(target,'assets/audio/source.json'),{kind:source?'user-file':'generated-demo-tone',source_file:source?path.basename(source):null,sha256:createHash('sha256').update(await readFile(audioFile)).digest('hex'),duration_seconds:duration});
  console.log(`Created ${target}\nNext: install dependencies in that directory, then run npm run check and npm run dev. Scene animation is a starter; adapt it to the real audio.`);
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
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:Object.fromEntries(['out','audio','input','project','start','duration','offset'].map(x=>[x,{type:'string'}]).concat([['demo',{type:'boolean'}],['help',{type:'boolean'}]]))});
  const command=positionals[0];
  if(values.help||!command){console.log('pixel-video.mjs doctor | init --out DIR (--audio FILE | --demo) | audio --input FILE --out FILE.wav --start SECONDS --duration SECONDS | captions --input FILE.srt|json --out FILE.json --offset SECONDS --duration SECONDS | validate --project DIR');return}
  const allowed={doctor:[],init:['out','audio','demo'],audio:['input','out','start','duration'],captions:['input','out','offset','duration'],validate:['project']}[command];
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
  }else{const r=await checkAndWrite(path.resolve(values.project||'.'));console.log(JSON.stringify({ok:true,scenes:r.project.scenes.length,captions:r.cues.length,warnings:r.warnings},null,2))}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1});
