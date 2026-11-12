// Real browser + FFmpeg integration. This is a regression fixture, not an eval framework.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProject } from '../cli/lib/project-init.mjs';
import { renderProject, renderIncremental, applyProjectPatch, collectFrames, inspectAtlas, prepareAtlases, validateMedia, prepareVideoPreview } from '../cli/api.mjs';
import { openBrowser } from '../cli/runtime/browser.mjs';
import { startServer } from '../cli/runtime/server.mjs';
import { encodeAtlasPng } from '../cli/lib/atlas-pack.mjs';
import { probe, run } from '../cli/runtime/project.mjs';
import { fileHash } from '../cli/lib/files.mjs';
import { finish } from '../cli/lib/workflow.mjs';
import { reviewVideo } from '../cli/lib/review.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const dependency = path.resolve(process.argv[2] || path.join(repo, 'node_modules/playwright/index.mjs'));
const { chromium } = await import(pathToFileURL(dependency).href);
process.env.CHROME_PATH ??= chromium.executablePath();
const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-production-smoke-'));
const root = path.join(parent, 'project');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const silent = { 'no-stills': true };
try {
  await createProject({ out: root, title: 'Production integration', duration: '3.25' }, path.join(repo, 'templates/video'));
  await symlink(path.dirname(path.dirname(dependency)), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const config = await json('project.json');
  Object.assign(config, { width: 1280, height: 720, logicalWidth: 320, logicalHeight: 180, fps: 12, font: null, audio: 'tone.wav', captions: 'captions.json', rendering: { sceneCache: 'isolated' } });
  config.scenes = [
    { id: 'one', start: 0, end: 1.033, source: { file: 'src/scenes.js' }, params: { color: '#234a63' } },
    { id: 'two', start: 1.033, end: 2.117, source: { file: 'src/scenes.js' }, params: { color: '#632a43', camera: [{ time: 0, x: 160, y: 90, zoom: 1 }, { time: 1, x: 180, y: 90, zoom: 1.4 }] } },
    { id: 'three', start: 2.117, end: 3.25, source: { file: 'src/scenes.js' }, params: { color: '#326344' } },
  ];
  await writeFile(path.join(root, 'project.json'), JSON.stringify(config));
  await writeFile(path.join(root, 'captions.json'), JSON.stringify([{ start: .1, end: .8, text: 'FIRST' }, { start: 1.3, end: 1.9, text: 'SECOND' }]));
  await writeFile(path.join(root, 'src/scenes.js'), `export function drawScene({ctx,scene,local,width,height}){ctx.fillStyle=scene.params.color;ctx.fillRect(0,0,width,height);ctx.fillStyle='#efca75';ctx.fillRect(70+local*60,60,28,35);ctx.fillStyle='#e8eff1';ctx.fillRect(130,120,60,5);}`);
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3.25', path.join(root, 'tone.wav')]);
  const originalDescription = await readFile(path.join(root, 'project.json'), 'utf8');
  const full = await renderProject(root, { ...silent, out: 'output/previews/full.mp4', cache: true });
  const fullReport = await json(full.report);
  assert.equal(full.frames, 39); assert.equal(fullReport.capture_size.width, 320);
  const warm = await renderProject(root, { ...silent, out: full.file, cache: true });
  assert.equal(warm.cache_hit, true); assert.equal(warm.captured_frames, 0);
  const cachedStills = await renderProject(root, { out: full.file, cache: true });
  assert.equal(cachedStills.cache_hit, true); assert.equal(cachedStills.captured_frames, 0); assert.equal(cachedStills.stills_written, 9);
  const stillFile = path.join(root, 'output/stills/01-15.png'), stillHash = await fileHash(stillFile);
  await writeFile(stillFile, 'stale still');
  await renderProject(root, { out: full.file, cache: true });
  assert.equal(await fileHash(stillFile), stillHash);
  const reference = await renderProject(root, { ...silent, out: 'output/previews/reference.mp4', nativeFrames: false });
  const pixelHash = (file) => run('ffmpeg', ['-v', 'error', '-i', path.join(root, file), '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-']).trim();
  assert.equal(pixelHash(reference.file), pixelHash(full.file), 'Native pixel capture must preserve the reference decoded frames');
  const draft = await renderProject(root, { profile: 'draft' });
  const draftInfo = probe(path.join(root, draft.file));
  assert.equal(draftInfo.streams.find((s) => s.codec_type === 'video').width, 960);
  assert.equal(draft.render_spec.fps, 12); assert.equal((await json(draft.report)).stills_written, 0);
  assert.equal(await readFile(path.join(root, 'project.json'), 'utf8'), originalDescription);
  assert.equal((await validateMedia(root, { input: draft.file, report: draft.report })).ok, true);
  const draftTask = await reviewVideo(root, { input: draft.file, report: draft.report });
  const task = await json(draftTask.task);
  await writeFile(path.join(root, 'output/qa/draft-observations.json'), JSON.stringify({ task_id: task.task_id, video_sha256: task.video_sha256, checks: task.checks.map((check) => ({ id: check.id, status: 'pass', note: 'Synthetic review fixture for delivery gate', evidence: [draft.file] })) }));
  await reviewVideo(root, { task: draftTask.task, result: 'output/qa/draft-observations.json' });
  await assert.rejects(finish(root, { summary: 'Synthetic draft', feedback: ['Awaiting final delivery'], lessons: ['Fixture only'], style: 'Cards', deliverables: [draft.file], reviewTask: draftTask.task, preferences: [] }, path.join(root, 'unused-memory')), /Draft review/);

  const cold = await renderIncremental(root, { out: 'output/previews/incremental.mp4' });
  assert.equal(cold.captured_frames, 39); assert.equal(cold.rendered_scenes.length, 3);
  assert.equal((await validateMedia(root, { input: cold.file, report: cold.report })).ok, true);
  const repeated = await renderIncremental(root, { out: cold.file });
  assert.equal(repeated.captured_frames, 0); assert.equal(repeated.reused_scenes.length, 3);
  await applyProjectPatch(root, { scenes: [{ id: 'two', params: { color: '#874a32' } }] });
  const edited = await renderIncremental(root, { out: cold.file });
  assert.deepEqual(edited.rendered_scenes, ['two']); assert.deepEqual(edited.reused_scenes, ['one', 'three']); assert.equal(edited.captured_frames, 13);
  await writeFile(path.join(root, 'src/drawing.js'), (await readFile(path.join(root, 'src/drawing.js'), 'utf8')) + '\n// shared dependency changed\n');
  const shared = await renderIncremental(root, { out: cold.file });
  assert.equal(shared.rendered_scenes.length, 3);
  const captions = await json('captions.json'); captions[0].text = 'FIRST EDIT';
  await writeFile(path.join(root, 'captions.json'), JSON.stringify(captions));
  const textEdit = await renderIncremental(root, { out: cold.file });
  assert.deepEqual(textEdit.rendered_scenes, ['one']);
  const videoHash = () => run('ffmpeg', ['-v', 'error', '-i', path.join(root, cold.file), '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-']).trim();
  const beforeAudio = videoHash();
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3.25', path.join(root, 'tone2.wav')]);
  await applyProjectPatch(root, { set: { audio: 'tone2.wav' } });
  const audioEdit = await renderIncremental(root, { out: cold.file });
  assert.equal(audioEdit.captured_frames, 0); assert.equal(videoHash(), beforeAudio);
  assert.equal((await validateMedia(root, { input: cold.file, report: cold.report })).ok, true);

  const a = await collectFrames(root, { input: cold.file, report: cold.report, times: '.4,1.5,2.7', cache: true, width: '640' });
  const b = await collectFrames(root, { input: cold.file, report: cold.report, times: '1.5,2.7', cache: true, width: '640' });
  assert.equal(a.captured_frames, 3); assert.equal(b.captured_frames, 0); assert.equal(b.reused_frames, 2);
  const aManifest = JSON.parse(await readFile(a.report, 'utf8')), bManifest = JSON.parse(await readFile(b.report, 'utf8'));
  assert.equal(path.resolve(a.directory, aManifest.frames[1].file), path.resolve(b.directory, bManifest.frames[0].file));
  assert.equal(probe(path.resolve(a.directory, aManifest.frames[0].file)).streams[0].width, 640);
  const sharedFrame = path.resolve(a.directory, aManifest.frames[1].file);
  const expectedHash = await fileHash(sharedFrame); await writeFile(sharedFrame, 'corrupt cache');
  const repaired = await collectFrames(root, { input: cold.file, report: cold.report, times: '1.5', cache: true, width: '640' });
  assert.equal(repaired.captured_frames, 1); assert.equal(await fileHash(sharedFrame), expectedHash);

  const pixels = Buffer.alloc(16 * 8 * 4);
  for (let y = 1; y < 6; y++) for (let x = 2; x < 5; x++) for (const dx of [0, 8]) {
    const at = (y * 16 + x + dx) * 4; pixels[at] = 200; pixels[at + 3] = 255;
  }
  await writeFile(path.join(root, 'sprite.png'), encodeAtlasPng(pixels, 16, 8));
  const atlas = await inspectAtlas(root, { input: 'sprite.png', columns: '2', rows: '1', pack: 'assets/packed.png', out: 'assets/packed-atlas.json', register: 'packed' });
  assert.equal((await json('project.json')).assets.packed, 'assets/packed.png');
  assert.ok(atlas.packing.pixel_area_ratio > 0);
  const batchItems = [{ input: 'sprite.png', columns: '2', rows: '1', out: 'assets/batch-atlas.json', register: 'batchSprite' }];
  assert.equal((await prepareAtlases(root, batchItems)).prepared, 1);
  assert.equal((await prepareAtlases(root, batchItems, { resume: true })).reused, 1);
  const preview=await prepareVideoPreview(root,{input:full.file,compare:draft.file});
  const previewServer=await startServer(0,root),previewBrowser=await openBrowser(root);
  try {
    const page=await previewBrowser.newPage({viewport:{width:1100,height:850}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(previewServer.url+'/'+preview.file);
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(video=>video.readyState>=2));
    assert.deepEqual(await page.locator('video').evaluateAll(videos=>videos.map(video=>video.videoWidth)),[1280,960]);
    await page.click('#play-together');
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(video=>video.currentTime>.1));
    const poseResult=await page.evaluate(async()=>{
      const {createPoseLibrary,drawPose,stateAt}=await import('/tools/sprites.mjs');
      const image=new Image();image.src='/assets/packed.png';await image.decode();
      const metadata=await fetch('/assets/packed-atlas.json').then(response=>response.json());
      const library=createPoseLibrary({actor:image},{poses:{idle:{asset:'actor',atlas:'main',frame:0},next:{asset:'actor',atlas:'main',frame:1}}},{main:metadata});
      const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d');
      drawPose(ctx,library,stateAt(1.5,[[0,'idle'],[1,'next']]),{x:50,y:80,height:40});
      return [...ctx.getImageData(0,0,100,100).data].some((value,index)=>index%4===3&&value>0);
    });
    assert.equal(poseResult,true);assert.deepEqual(errors,[]);
    if(process.env.PROGRAMMATIC_VIDEO_PREVIEW_SCREENSHOT)await page.screenshot({path:path.resolve(process.env.PROGRAMMATIC_VIDEO_PREVIEW_SCREENSHOT),fullPage:true});
  } finally {await previewBrowser.close();await new Promise(resolve=>previewServer.server.close(resolve));}
  const blobs = await readdir(path.join(root, 'output/qa/.frames'));
  console.log(JSON.stringify({ passed: true, realCameraAndDraft: true, nativeCapture: fullReport.capture_size, finalSize: [fullReport.width, fullReport.height], unchangedSourceDuringDraft: true, exactRenderReuse: warm.captured_frames, incrementalColdFrames: cold.captured_frames, incrementalEditedFrames: edited.captured_frames, sharedCodeInvalidatesAll: shared.rendered_scenes.length, captionEditScenes: textEdit.rendered_scenes, audioEditCapturedFrames: audioEdit.captured_frames, sharedFrameReuse: b.reused_frames, frameBlobs: blobs.length, corruptedFrameRepaired: true, atlasPackedAndRegistered: true, observedSeconds: { full: full.timings.total_seconds, warm: warm.timings.total_seconds, draft: draft.timings.total_seconds } }));
} finally {
  assert.equal(path.dirname(parent), os.tmpdir()); assert.ok(path.basename(parent).startsWith('programmatic-video-production-smoke-'));
  await rm(parent, { recursive: true, force: true });
}
