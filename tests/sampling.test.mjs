import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRange,selectTimes} from '../skills/using-programmatic-video/assets/starter/tools/sampling.mjs';

const project={duration:4.25,fps:30,scenes:[{id:'intro',start:0,end:1.1},{id:'action',start:1.1,end:4.25}]};

test('scene drafts keep global frame positions instead of restarting the scene clock',()=>{
  const saved=JSON.stringify(project),range=selectRange(project,{scene:'action'});
  assert.equal(range.firstFrame,33);assert.equal(range.start,1.1);
  assert.equal(range.endFrame,128);assert.equal(range.frames,95);assert.equal(range.partial,true);
  assert.equal(JSON.stringify(project),saved);
});

test('range boundaries select only source frames within the requested half-open interval',()=>{
  const range=selectRange(project,{start:'0.101',duration:'0.1'});
  assert.equal(range.firstFrame,4);assert.equal(range.endFrame,7);assert.equal(range.frames,3);
  assert.throws(()=>selectRange(project,{start:0.001,duration:0.001}),/no output frames/);
  assert.throws(()=>selectRange(project,{start:4,duration:1}),/inside/);
  assert.throws(()=>selectRange(project,{scene:'missing'}),/Unknown scene/);
  assert.throws(()=>selectRange(project,{scene:'action',start:1}),/Choose/);
});

test('full ranges retain the final fractional frame and exact samples are ordered and deduplicated',()=>{
  assert.equal(selectRange(project).frames,128);
  assert.equal(selectRange(project).partial,false);
  assert.equal(selectRange({...project,scenes:[{id:'all',start:0,end:4.25}]},{scene:'all'}).partial,true);
  assert.deepEqual(selectTimes(project,{times:'2,0.68,0.68,1'}),[0.68,1,2]);
  assert.throws(()=>selectTimes(project,{times:'0.1,'}),/comma-separated/);
  assert.throws(()=>selectTimes(project,{times:'4.25'}),/inside/);
  assert.throws(()=>selectTimes(project,{times:'1',scene:'intro'}),/cannot be combined/);
});

test('sampling is configurable per scene and is not coupled to shot count or captions',()=>{
  const times=selectTimes(project,{scene:'action',samples:'8'});
  assert.equal(times.length,8);assert.ok(times.every(time=>time>=1.1&&time<4.25));
  assert.equal(selectTimes(project).length,6);
  assert.throws(()=>selectTimes(project,{samples:0}),/integer/);
  assert.throws(()=>selectTimes(project,{scene:'missing'}),/Unknown scene/);
});
