// Creates its own current-starter fixture; accepts a local Playwright entry module.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const repo=fileURLToPath(new URL('../',import.meta.url));
const dependency=path.resolve(process.argv[2]||path.join(repo,'.work/smoke/node_modules/playwright/index.mjs'));
const {chromium}=await import(pathToFileURL(dependency).href);
const parent=await mkdtemp(path.join(os.tmpdir(),'pixel-video-resources-'));
const project=path.join(parent,'project');let browser,server;
try {
  const init=spawnSync(process.execPath,[path.join(repo,'scripts/pixel-video.mjs'),'init','--out',project,'--demo'],{encoding:'utf8',windowsHide:true});
  assert.equal(init.status,0,init.stderr);
  const file=path.join(project,'project.json'),config=JSON.parse(await readFile(file,'utf8'));
  const directory="assets/media #100%20 (雨)'";
  await mkdir(path.join(project,directory));
  for(const [key,name] of [['audio','tone #100%20.wav'],['captions','words #100%20.json'],['font',"pixel #100%20 (雨)'.woff2"]]) {
    const destination=directory+'/'+name;
    await rename(path.join(project,config[key]),path.join(project,destination));config[key]=destination;
  }
  const image=directory+'/image #100%20.png';
  await writeFile(path.join(project,image),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
  config.assets={special:image};
  await writeFile(file,'\uFEFF'+JSON.stringify(config));
  const captions=path.join(project,config.captions);await writeFile(captions,'\uFEFF'+await readFile(captions,'utf8'));
  const validate=spawnSync(process.execPath,[path.join(repo,'scripts/pixel-video.mjs'),'validate','--project',project],{encoding:'utf8',windowsHide:true});
  assert.equal(validate.status,0,validate.stderr);
  const started=await(await import(pathToFileURL(path.join(project,'tools/server.mjs')).href)).startServer();server=started.server;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--mute-audio']});
  const page=await browser.newPage(),errors=[],responses=new Map();
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>responses.set(response.url(),response.status()));
  await page.goto(started.url);await page.waitForFunction(()=>window.__ready||window.__error);
  assert.equal(await page.evaluate(()=>window.__error),undefined);
  await page.click('#play');await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  await page.click('#play');
  await page.locator('#scrub').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.waitForFunction(()=>Math.abs(window.__playback.time-4)<.01);
  assert.equal(await page.evaluate(()=>window.__render(window.__playback.time).caption),'Open a new way');
  assert.equal(await page.evaluate(()=>document.fonts.check('12px Pixel')),true);
  for(const relative of [config.audio,config.captions,config.font,image]) {
    const url=started.url+'/'+relative.split('/').map(encodeURIComponent).join('/');
    assert.ok([200,206].includes(responses.get(url)),`Resource not loaded: ${relative}`);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({current_starter:true,bom_project_and_captions:true,encoded_audio:true,encoded_captions:true,encoded_font:true,encoded_image:true,playback:true,scrub:true,browser_errors:errors},null,2));
} finally {
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(parent),os.tmpdir());assert.ok(path.basename(parent).startsWith('pixel-video-resources-'));
  await rm(parent,{recursive:true,force:true});
}
