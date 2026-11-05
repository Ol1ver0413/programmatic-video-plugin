import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

if(!process.argv[2]) throw new Error('Usage: node tests/silent-smoke.mjs PROJECT');
const project = path.resolve(process.argv[2]);
const {chromium} = await import(pathToFileURL(path.join(project, 'node_modules/playwright/index.mjs')).href);
const {startServer} = await import(pathToFileURL(path.join(project, 'tools/server.mjs')).href);
const {server, url} = await startServer(); let browser;
try {
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
  browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => window.__ready || window.__error);
  assert.equal(await page.evaluate(() => window.__error), undefined);
  assert.equal(await page.evaluate(() => window.__project.audio), null);
  await page.click('#play');
  await page.waitForFunction(() => window.__playback.time > .1);
  await page.click('#play');
  assert.equal(await page.evaluate(() => window.__playback.playing), false);
  await page.locator('#scrub').evaluate(el => {el.value = el.max / 2; el.dispatchEvent(new Event('input', {bubbles:true}));});
  assert.ok(await page.evaluate(() => Math.abs(window.__playback.time - window.__project.duration / 2) < .01));
  const pixels = await page.evaluate(() => {
    // A deterministic scene lets us check the clean-frame contract exactly.
    window.__project.scenes[0].start = 0;
    const canvas = document.querySelector('#film');
    const sample = time => {window.__render(time); return canvas.toDataURL();};
    const first = sample(.1); sample(.2); const repeat = sample(.1);
    const ctx = canvas.getContext('2d');
    const y = canvas.height - 4, data = ctx.getImageData(0, y, canvas.width, 1).data;
    let subtitleBandPixels = 0, progressPixels = 0;
    for(let i = 0; i < data.length; i += 4) if(data[i] === 8 && data[i + 1] === 14 && data[i + 2] === 25) subtitleBandPixels++;
    const bottom = ctx.getImageData(0, canvas.height - 1, canvas.width, 1).data;
    for(let i = 0; i < bottom.length; i += 4) if(bottom[i] === 204 && bottom[i + 1] === 90 && bottom[i + 2] === 89) progressPixels++;
    return {deterministic:first === repeat, subtitleBandPixels, progressPixels};
  });
  assert.ok(pixels.deterministic); assert.equal(pixels.subtitleBandPixels, 0); assert.equal(pixels.progressPixels, 0);
  assert.deepEqual(errors, []);
  await mkdir(path.join(project, 'output'), {recursive:true});
  await page.locator('#film').screenshot({path:path.join(project, 'output/silent-preview.png')});
  const report = {silent_playback:true, pause:true, scrub:true, clean_frame:true, deterministic:pixels.deterministic, browser_errors:errors};
  await writeFile(path.join(project, 'output/silent-browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {if(browser) await browser.close(); await new Promise(resolve => server.close(resolve));}
