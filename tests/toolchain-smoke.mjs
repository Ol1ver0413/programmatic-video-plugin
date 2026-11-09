// Real CLI/browser/media round trip; no production project or private assets are used.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, symlink, stat, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const dependency = path.resolve(process.argv[2] || path.join(repo, '.work/smoke/node_modules/playwright/index.mjs'));
const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-toolchain-'));
const project = path.join(parent, 'project'), cli = path.join(repo, 'cli/programmatic-video.mjs');
function execute(executable, args) {
  return spawnSync(executable, args, { cwd: project, encoding: 'utf8', windowsHide: true, timeout: 90000 });
}
function success(executable, args) {
  const result = execute(executable, args);
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  return result.stdout;
}
const invoke = (...args) => success(process.execPath, [cli, ...args]);
const json = async (file) => JSON.parse(await readFile(path.join(project, file), 'utf8'));
try {
  const init = spawnSync(process.execPath, [cli, 'init', '--out', project, '--duration', '3'],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const config = await json('project.json');
  Object.assign(config, { width: 320, height: 180, logicalWidth: 160, logicalHeight: 90,
    fps: 10, font: null, pixelArt: false, audio: null });
  config.scenes = [{ id: 'intro', start: 0, end: 1 }, { id: 'action', start: 1, end: 2 },
    { id: 'ending', start: 2, end: 3 }];
  await writeFile(path.join(project, 'project.json'), JSON.stringify(config));
  await writeFile(path.join(project, 'captions.json'), JSON.stringify([
    { start: 0, end: 1, text: 'FIRST' }, { start: 1, end: 2, text: 'SECOND' }, { start: 2, end: 3, text: 'THIRD' },
  ]));
  await mkdir(path.join(project, 'output'), { recursive: true });
  success('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=10:d=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'output/reference.mp4']);
  const times = Array.from({ length: 44 }, (_, i) => (0.02 + i * 0.065).toFixed(3)).join(',');
  const sampling = ['frames', '--project', project, '--input', 'output/reference.mp4',
    '--times', times, '--out', 'output/qa/recover'];
  // Without Playwright, extraction succeeds and assembly fails. Resume must reuse those PNGs.
  const failed = execute(process.execPath, [cli, ...sampling]);
  assert.equal(failed.status, 1);
  let state = await json('output/qa/recover/frames.json');
  assert.equal(state.frames.length, 44); assert.equal(state.status, 'failed');
  const firstTime = (await stat(path.join(project, 'output/qa/recover/001.png'))).mtimeMs;
  await symlink(path.dirname(path.dirname(dependency)), path.join(project, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  const recovered = JSON.parse(invoke(...sampling, '--resume'));
  state = await json('output/qa/recover/frames.json');
  assert.equal(state.status, 'complete'); assert.equal(state.frames.length, 44);
  assert.equal(recovered.contactSheets.length, 3);
  assert.equal((await stat(path.join(project, 'output/qa/recover/001.png'))).mtimeMs, firstTime);
  const before = await readFile(path.join(project, 'output/qa/recover/frames.json'));
  const changedTimes = execute(process.execPath, [cli, 'frames', '--project', project,
    '--input', 'output/reference.mp4', '--times', '0.3', '--out', 'output/qa/recover', '--resume']);
  assert.equal(changedTimes.status, 1);
  assert.deepEqual(await readFile(path.join(project, 'output/qa/recover/frames.json')), before);

  await mkdir(path.join(project, 'assets'), { recursive: true });
  const pixels = Buffer.alloc(40 * 20 * 4);
  for (let y = 3; y < 15; y++) for (let x = 3; x < 30; x++) {
    const at = (y * 40 + x) * 4;
    pixels[at + (x < 12 ? 0 : 1)] = 255; pixels[at + 3] = 255;
  }
  await writeFile(path.join(project, 'pixels.rgba'), pixels);
  success('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '40x20',
    '-i', 'pixels.rgba', '-frames:v', '1', 'assets/sheet.png']);
  await writeFile(path.join(project, 'src/layout.json'), JSON.stringify({ columns: 2, rows: 1,
    reference_height: 12, frames: [
      { region: [0, 0, 12, 20], anchor: [8, 15], anchors: { tip: [10, 5] } },
      { polygon: [[12, 0], [40, 0], [40, 20], [12, 20]], anchor: [23, 15], anchors: { tip: [25, 5] } },
    ] }));
  invoke('atlas', '--project', project, '--input', 'assets/sheet.png', '--layout', 'src/layout.json', '--out', 'src/sheet.json');
  config.assets = { sheet: 'assets/sheet.png' };
  await writeFile(path.join(project, 'project.json'), JSON.stringify(config));
  await writeFile(path.join(project, 'src/scenes.js'), `
    import {createAtlas,drawSprite,frameAt,valueAt} from './drawing.js';
    const metadata=await fetch('src/sheet.json').then(r=>r.json());
    export function drawScene({ctx,assets,time,width,height}){
      ctx.fillStyle='#111111';ctx.fillRect(0,0,width,height);
      const atlas=createAtlas(assets.sheet,metadata),frame=frameAt(time,[[0,0],[1,1]]);
      const actor=drawSprite(ctx,atlas,frame,{x:valueAt(time,[[0,45],[3,95]]),y:65,height:40,flip:time>=1,rotation:.1});
      const tip=actor.point('tip');ctx.fillStyle='#fff';ctx.fillRect(tip.x,tip.y,2,2);
    }
  `);
  invoke('render', '--project', project, '--scene', 'action', '--out', 'output/previews/action.mp4');
  const report = await json('output/previews/action.mp4.report.json');
  assert.equal(report.time_mapping.source_start_seconds, 1);
  const mapped = JSON.parse(invoke('frames', '--project', project, '--input', 'output/previews/action.mp4',
    '--map', 'output/previews/action.mp4.report.json', '--scene', 'action', '--samples', '2'));
  const mappedState = JSON.parse(await readFile(mapped.report, 'utf8'));
  assert.deepEqual(mappedState.frames.map((frame) => frame.time_requested), [1.25, 1.75]);
  assert.deepEqual(mappedState.frames.map((frame) => frame.time_input), [.25, .75]);
  invoke('captions', '--input', path.join(project, 'captions.json'), '--map',
    path.join(project, 'output/previews/action.mp4.report.json'), '--out', path.join(project, 'output/previews/action.json'));
  assert.deepEqual(await json('output/previews/action.json'), [{ start: 0, end: 1, text: 'SECOND' }]);
  const checked = JSON.parse(invoke('validate', '--project', project, '--input', 'output/previews/action.mp4',
    '--map', 'output/previews/action.mp4.report.json', '--captions-file', 'output/previews/action.json'));
  assert.equal(checked.ok, true);
  const source = JSON.parse(invoke('frames', '--project', project, '--scene', 'action', '--samples', '2'));
  assert.equal((await readFile(source.report, 'utf8')).includes('canvas-runtime-samples'), true);
  const sourceBytes = await readFile(source.report);
  await appendFile(path.join(project, 'tools/sprites.mjs'), '\n// Changed runtime dependency\n');
  const stale = execute(process.execPath, [cli, 'frames', '--project', project, '--scene', 'action',
    '--samples', '2', '--out', path.relative(project, source.directory), '--resume']);
  assert.equal(stale.status, 1); assert.match(stale.stderr, /source.*changed/);
  assert.deepEqual(await readFile(source.report), sourceBytes);
  console.log(JSON.stringify({ passed: true, encodedFullHdFrames: 44, contactSheetPages: 3,
    failedAssemblyRecoveredWithoutRecapture: true, changedResumeRejected: true,
    explicitAtlasToRealCanvas: true, changedRuntimeResumeRejected: true,
    projectToClipMapping: true, partialCaptionAndMediaCheck: true }));
} finally {
  assert.equal(path.dirname(parent), os.tmpdir());
  assert.ok(path.basename(parent).startsWith('programmatic-video-toolchain-'));
  await rm(parent, { recursive: true, force: true });
}
