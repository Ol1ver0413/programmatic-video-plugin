// Run after creating and installing the .work/smoke demo project.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.resolve(process.argv[2]||path.join(repo,'.work/smoke'));
const {chromium}=await import(pathToFileURL(path.join(project,'node_modules/playwright/index.mjs')).href);
const {startServer}=await import(pathToFileURL(path.join(project,'tools/server.mjs')).href);
const {server,url}=await startServer();let browser;
try{
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.waitForFunction(()=>window.__ready||window.__error);assert.equal(await page.evaluate(()=>window.__error),undefined);
  await page.click('#play');
  await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>.1,undefined,{timeout:10000});
  await page.click('#play');assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),true);
  await page.locator('#scrub').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}))});
  const frame=await page.evaluate(()=>window.__render(4));assert.equal(frame.scene,'gate');assert.equal(frame.caption,'Open a new way');
  const samples=await page.evaluate(()=>{
    const draw=t=>{window.__render(t);return document.querySelector('#film').toDataURL()};
    const first=draw(4);draw(1);const repeat=draw(4),different=draw(4.5);
    return {repeatMatches:first===repeat,actionChanges:first!==different};
  });assert.ok(samples.repeatMatches&&samples.actionChanges);
  const atlas=await page.evaluate(async()=>{
    const {makeAtlas,drawAtlas}=await import('/src/drawing.js');
    const source=document.createElement('canvas');source.width=16;source.height=8;
    const s=source.getContext('2d');s.fillStyle='#fff';s.fillRect(2,1,3,6);s.fillRect(10,2,3,4);
    const sheet=makeAtlas(source,2,1),target=document.createElement('canvas');target.width=48;target.height=48;
    const ctx=target.getContext('2d');ctx.globalAlpha=.5;
    const point=drawAtlas(ctx,sheet,0,{x:16,y:24,height:12,anchor:[3,3],flip:true,rotation:Math.PI/2,alpha:.5});
    return {point,alpha:ctx.getImageData(24,25,1,1).data[3],restoredAlpha:ctx.globalAlpha,referenceHeight:sheet.referenceHeight,shorterFrame:sheet.frames[1].h};
  });
  assert.ok(Math.abs(atlas.point.x-24)<1e-6&&Math.abs(atlas.point.y-25)<1e-6);
  assert.ok(Math.abs(atlas.alpha-64)<=1);assert.equal(atlas.restoredAlpha,.5);assert.equal(atlas.referenceHeight,6);assert.equal(atlas.shorterFrame,4);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(project,'output/preview.png'),fullPage:true});
  const report={audio_plays:true,pause:true,scrub:true,caption_matches:true,deterministic_frames:samples.repeatMatches,action_changes:samples.actionChanges,atlas_anchor_transform:true,atlas_inherits_alpha:true,browser_errors:errors};
  await writeFile(path.join(project,'output/browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
