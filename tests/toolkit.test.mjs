import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,rm,rmdir} from 'node:fs/promises';
import {parseCaptions,clipCaptions} from '../scripts/pixel-video.mjs';
import {checkCues,toSrt,validateProject} from '../skills/using-pixel-video/assets/starter/tools/project.mjs';

test('source times move into the selected clip and crossing cues are cropped',()=>{
  const cues=clipCaptions([{start:38,end:39,text:'opening'},{start:47.54,end:49.02,text:'target'},{start:83,end:85,text:'ending'},{start:84,end:85,text:'excluded'}],38.88,45);
  assert.equal(cues.length,3);assert.equal(cues[0].start,0);assert.equal(cues[2].end,45);
  assert.ok(Math.abs(cues[1].start-8.66)<1e-9);assert.ok(Math.abs(cues[1].end-10.14)<1e-9);
  assert.deepEqual(clipCaptions([{start:0,end:1,text:'before'},{start:2,end:3,text:'after'}],1,1),[]);
  assert.throws(()=>clipCaptions([],0,-1));
});
test('SRT preserves multiline text and rejects invalid or overlapping ranges',()=>{
  const input='\ufeff1\r\n00:00:01,250 --> 00:00:02,500\r\nfirst line\r\nsecond line\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nlast';
  const cues=parseCaptions(input,'.srt');assert.equal(cues[0].text,'first line\nsecond line');
  assert.deepEqual(parseCaptions(toSrt(cues),'.srt'),cues);
  assert.throws(()=>parseCaptions('[{"start":0,"end":2,"text":"a"},{"start":1,"end":3,"text":"b"}]','.json'),/overlap/);
  assert.throws(()=>parseCaptions('1\n00:00:61,000 --> 00:01:04,000\na','.srt'),/timestamp/);
  assert.ok(checkCues([{start:0,end:46,text:'too long'}],45).length);
});

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'pixel-video-test-'));
  const project={duration:3,fps:30,width:1280,height:720,logicalWidth:320,logicalHeight:180,audio:'audio.wav',captions:'captions.json',assets:{},scenes:[{id:'one',start:0,end:1},{id:'two',start:1,end:3}]};
  await writeFile(path.join(root,'audio.wav'),'fixture');
  await writeFile(path.join(root,'captions.json'),'[{"start":0,"end":3,"text":"test"}]');
  const save=()=>writeFile(path.join(root,'project.json'),JSON.stringify(project));await save();
  t.after(async()=>{for(const file of ['audio.wav','captions.json','project.json'])await rm(path.join(root,file),{force:true});await rmdir(root)});
  return {root,project,save};
}
test('project validation detects coverage gaps and audio paths outside the project',async t=>{
  const f=await fixture(t);assert.deepEqual((await validateProject(f.root,{probeAudio:false})).errors,[]);
  f.project.scenes[1].start=1.1;await f.save();assert.ok((await validateProject(f.root,{probeAudio:false})).errors.some(e=>e.includes('noncontiguous')));
  f.project.scenes[1].start=1;f.project.audio='../other.wav';await f.save();assert.ok((await validateProject(f.root,{probeAudio:false})).errors.some(e=>e.includes('leaves project')));
});
test('project validation rejects aspect distortion and unreadable empty captions',async t=>{
  const f=await fixture(t);f.project.width=1282;await f.save();
  assert.ok((await validateProject(f.root,{probeAudio:false})).errors.some(e=>e.includes('uniform scale')));
  await writeFile(path.join(f.root,'captions.json'),'[{"start":0,"end":1,"text":""}]');
  assert.ok((await validateProject(f.root,{probeAudio:false})).errors.some(e=>e.includes('missing text')));
});

test('project and caption JSON accept a leading UTF-8 BOM',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.root,'project.json'),'\uFEFF'+JSON.stringify(f.project));
  assert.deepEqual((await validateProject(f.root,{probeAudio:false})).errors,[]);
  await writeFile(path.join(f.root,'captions.json'),'\uFEFF[{"start":0,"end":3,"text":"BOM caption"}]');
  const result=await validateProject(f.root,{probeAudio:false});
  assert.deepEqual(result.errors,[]);assert.equal(result.cues[0].text,'BOM caption');
});
