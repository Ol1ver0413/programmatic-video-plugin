import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,readFile,rm,rmdir} from 'node:fs/promises';
import {parseCaptions,clipCaptions} from '../cli/programmatic-video.mjs';
import {checkCues,toSrt,validateProject} from '../cli/runtime/project.mjs';
import {captionRowsAt,convertCaptions} from '../cli/api.mjs';

test('source times move into the selected clip and crossing cues are cropped',()=>{
  const cues=clipCaptions([{start:38,end:39,text:'opening'},{start:47.54,end:49.02,text:'target'},{start:83,end:85,text:'ending'},{start:84,end:85,text:'excluded'}],38.88,45);
  assert.equal(cues.length,3);assert.equal(cues[0].start,0);assert.equal(cues[2].end,45);
  assert.ok(Math.abs(cues[1].start-8.66)<1e-9);assert.ok(Math.abs(cues[1].end-10.14)<1e-9);
  assert.deepEqual(clipCaptions([{start:0,end:1,text:'before'},{start:2,end:3,text:'after'}],1,1),[]);
  assert.throws(()=>clipCaptions([],0,-1));
});

test('dialogue clipping preserves attribution and maps overlapping utterance times',()=>{
  const original=[{start:10,end:14,text:'- First\n- Second',speaker:'b',speakers:['b','a'],note:{source:'authored'},utterances:[{speaker:'a',start:10,end:12.5},{speaker:'b',start:12,end:14}]}];
  const snapshot=structuredClone(original),clipped=clipCaptions(original,11,2);
  assert.deepEqual(clipped[0].speakers,['a','b']);
  assert.equal(clipped[0].speaker,'b');
  assert.deepEqual(clipped[0].utterances.map(({speaker,start,end})=>({speaker,start,end})),[{speaker:'a',start:0,end:1.5},{speaker:'b',start:1,end:2}]);
  assert.deepEqual(clipped[0].note,{source:'authored'});
  assert.deepEqual(original,snapshot);
  const last=clipCaptions(original,13,1)[0];
  assert.equal(last.text,'- Second');assert.equal(last.speaker,'b');
  assert.equal(last.utterances.length,1);assert.deepEqual(last.speakers,['b']);
});

test('dialogue metadata rejects ambiguous rows and invalid nested times while allowing overlaps',()=>{
  const cue={start:0,end:3,text:'one\ntwo',utterances:[{speaker:'a',start:0,end:2},{speaker:'b',start:1,end:3}]};
  assert.deepEqual(checkCues([cue],3),[]);
  assert.ok(checkCues([{...cue,text:'ambiguous'}],3).some(error=>/utterance/i.test(error)));
  assert.ok(checkCues([{...cue,utterances:[{speaker:'a',start:0,end:4,text:'one'}]}],3).some(error=>/utterance/i.test(error)));
  assert.ok(checkCues([{...cue,speaker:42}],3).length);
});

test('explicit utterance text and negative numbers survive while legacy dialogue markers are removed',()=>{
  for(const text of ['-5 C','- hello']) {
    const cue={start:0,end:2,text,utterances:[{speaker:'narrator',start:0,end:2,text}]};
    assert.equal(captionRowsAt(cue,1)[0].text,text);
    assert.equal(clipCaptions([cue],0,1)[0].utterances[0].text,text);
  }
  const cue={start:0,end:2,text:'- First\n-5 C',utterances:[{speaker:'a',start:0,end:1},{speaker:'b',start:1,end:2}]};
  assert.deepEqual(captionRowsAt(cue,1.5).map(row=>row.text),['First','-5 C']);
});

test('caption conversion moves nested dialogue to the output time and renders actual speakers',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'video-dialogue-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input=path.join(root,'input.json'),out=path.join(root,'clip.json'),map=path.join(root,'map.json');
  await writeFile(input,JSON.stringify([{start:10,end:13,text:'a\nb',speaker:'b',speakers:['b','a'],utterances:[{speaker:'a',start:10,end:12},{speaker:'b',start:11.5,end:13}]}]));
  await writeFile(map,JSON.stringify({source_start_seconds:11,source_end_seconds:13,output_start_seconds:4,output_end_seconds:6}));
  await convertCaptions({input,out,map});
  const [cue]=JSON.parse(await readFile(out,'utf8'));
  assert.deepEqual([cue.start,cue.end],[4,6]);
  assert.deepEqual(cue.utterances.map(row=>[row.start,row.end]),[[4,5],[4.5,6]]);
  assert.deepEqual(captionRowsAt(cue,4.25).map(row=>[row.speaker,row.visible,row.active]),[['a',true,true],['b',false,false]]);
  assert.deepEqual(captionRowsAt(cue,5.25).map(row=>[row.speaker,row.visible,row.active]),[['a',true,false],['b',true,true]]);
  assert.deepEqual(captionRowsAt(cue,6),[]);
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
  const root=await mkdtemp(path.join(os.tmpdir(),'programmatic-video-test-'));
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

test('non-pixel projects can use fractional uniform scaling while pixel projects retain integer scaling',async t=>{
  const f=await fixture(t);f.project.logicalWidth=512;f.project.logicalHeight=288;await f.save();
  assert.ok((await validateProject(f.root,{probeAudio:false})).errors.some(error=>error.includes('integer')));
  f.project.pixelArt=false;await f.save();
  assert.deepEqual((await validateProject(f.root,{probeAudio:false})).errors,[]);
});
