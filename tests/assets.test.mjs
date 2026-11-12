import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync,spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { createProject } from '../cli/lib/project-init.mjs';
import { encodeAtlasPng } from '../cli/lib/atlas-pack.mjs';
import { prepareAsset, importAsset, adoptAsset, listAssets, applyProjectPatch,recoverAssetLock } from '../cli/api.mjs';

const cli=fileURLToPath(new URL('../cli/programmatic-video.mjs',import.meta.url));
async function fixture(t) {
  const base=await mkdtemp(path.join(os.tmpdir(),'video-assets-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=path.join(base,'project'),native=path.join(base,'native.png');
  await createProject({out:root,duration:3},fileURLToPath(new URL('../templates/video',import.meta.url)));
  const pixels=Buffer.alloc(8*8*4,255),png=encodeAtlasPng(pixels,8,8);
  await writeFile(native,png);await writeFile(path.join(root,'assets/style.png'),png);
  const request={id:'guest-v1',asset:'guest',kind:'production',purpose:'A new scene pose',prompt:'A complete illustrated pose',references:[{file:'assets/style.png',role:'style only'}],minimum:{width:8,height:8},scenes:['gate']};
  return {base,root,native,request,png};
}

test('native image requests, imports and adoption are reusable without losing provenance',async t=>{
  const f=await fixture(t);
  const prepared=await prepareAsset(f.root,f.request);
  assert.equal(prepared.reused,false);assert.equal(prepared.status,'requested');
  assert.equal(prepared.generation.references[0].role,'style only');
  assert.ok(path.isAbsolute(prepared.generation.references[0].file));
  assert.equal((await prepareAsset(f.root,f.request)).reused,true);
  const imported=await importAsset(f.root,f.request.id,f.native);
  assert.equal(imported.status,'candidate');assert.deepEqual(imported.dimensions,{width:8,height:8});
  assert.deepEqual(await readFile(path.join(f.root,imported.file)),f.png);
  assert.equal((await importAsset(f.root,f.request.id,f.native)).reused,true);
  const adopted=await adoptAsset(f.root,f.request.id);
  assert.equal(adopted.active,true);assert.equal(adopted.status,'adopted');
  assert.equal((await adoptAsset(f.root,f.request.id)).reused,true);
  assert.equal((await prepareAsset(f.root,f.request)).active,true);
  await applyProjectPatch(f.root,{scenes:[{id:'gate',assets:['guest']}]});
  const saved=await listAssets(f.root,f.request.id);
  assert.equal(saved.imports.length,1);assert.equal(saved.request.prompt,f.request.prompt);
  assert.equal(saved.request.references[0].sha256.length,64);
  assert.deepEqual(saved.declared_scenes,['gate']);
  const second={...f.request,id:'guest-v2',asset:'secondGuest'};
  await prepareAsset(f.root,second);
  assert.equal((await importAsset(f.root,second.id,f.native)).file,imported.file);
});

test('request revisions, reference drift and undersized production images are explicit',async t=>{
  const f=await fixture(t);
  await prepareAsset(f.root,f.request);
  await assert.rejects(()=>prepareAsset(f.root,{...f.request,prompt:'Different action'}),/new id/);
  await writeFile(path.join(f.root,'assets/style.png'),'changed');
  await assert.rejects(()=>importAsset(f.root,f.request.id,f.native),/Reference changed/);
  await writeFile(path.join(f.root,'assets/style.png'),f.png);
  await prepareAsset(f.root,{...f.request,id:'large',minimum:{width:16,height:16}});
  const result=await importAsset(f.root,'large',f.native);
  assert.equal(result.warnings.length,1);
  await assert.rejects(()=>adoptAsset(f.root,'large'),/declared size/);
  assert.equal(JSON.parse(await readFile(path.join(f.root,'project.json'),'utf8')).assets.guest,undefined);
  assert.equal((await listAssets(f.root,'large')).status,'candidate');
});

test('catalog updates retain legacy records and concurrent retries do not lose requests',async t=>{
  const f=await fixture(t),file=path.join(f.root,'assets/sources.json');
  await writeFile(file,JSON.stringify({legacy:{source:'user provided'}}));
  const requests=[f.request,{...f.request,id:'second'}];
  const attempts=await Promise.allSettled(requests.map(request=>prepareAsset(f.root,request)));
  for(const[index,result]of attempts.entries())if(result.status==='rejected')await prepareAsset(f.root,requests[index]);
  const catalog=await listAssets(f.root);
  assert.equal(catalog.jobs.length,2);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).legacy,{source:'user provided'});
});

test('asset references and generated destinations stay inside the project',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>prepareAsset(f.root,{...f.request,id:'../escape'}),/Asset ids/);
  await assert.rejects(()=>prepareAsset(f.root,{...f.request,references:[{file:'../native.png',role:'style'}]}),/leaves project/);
  await prepareAsset(f.root,f.request);
  const external=path.join(f.base,'outside');await mkdir(external);
  try {await symlink(external,path.join(f.root,'assets/generated'),'junction');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Cannot create a directory link on this host');return;}throw error;}
  await assert.rejects(()=>importAsset(f.root,f.request.id,f.native),/leaves project/);
  assert.deepEqual(await readdir(external),[]);
});

test('the CLI exposes the same prepare/import/adopt chain',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.root,'request.json'),JSON.stringify(f.request));
  const run=(...args)=>{
    const result=spawnSync(process.execPath,[cli,'assets','--project',f.root,...args],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  assert.equal(run('--prepare','request.json').status,'requested');
  assert.equal(run('--job',f.request.id,'--import',f.native).status,'candidate');
  assert.equal(run('--job',f.request.id,'--adopt').status,'adopted');
  assert.equal(run().jobs.length,1);
});

test('interrupted asset operations can recover without clearing an active lock',async t=>{
  const f=await fixture(t),script=path.join(f.base,'hold-lock.mjs');
  const moduleUrl=pathToFileURL(fileURLToPath(new URL('../cli/lib/asset-catalog.mjs',import.meta.url))).href;
  await writeFile(script,`import {updateAssetCatalog} from ${JSON.stringify(moduleUrl)};await updateAssetCatalog(${JSON.stringify(f.root)},async()=>{console.log('locked');setInterval(()=>{},1000);await new Promise(()=>{});});`);
  const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  try {
    const ready=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Lock fixture exited too early');})]);
    assert.ok(String(ready[0]).includes('locked'));
    await assert.rejects(()=>recoverAssetLock(f.root),/still active/);
    await assert.rejects(()=>prepareAsset(f.root,f.request),/locked/);
    const stopped=once(child,'exit');child.kill();await stopped;
    assert.equal((await recoverAssetLock(f.root)).recovered,true);
    assert.equal((await prepareAsset(f.root,f.request)).status,'requested');
    assert.equal((await recoverAssetLock(f.root)).recovered,false);
  } finally {if(child.exitCode===null && child.signalCode===null)child.kill();}
});
