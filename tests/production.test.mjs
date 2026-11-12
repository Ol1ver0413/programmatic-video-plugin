import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../cli/lib/project-init.mjs';
import { applyProjectPatch, patchProject, projectChanges, projectFiles } from '../cli/lib/project-operations.mjs';
import { context } from '../cli/lib/workflow.mjs';
import { alignCaptionText } from '../cli/lib/captions.mjs';
import { inspectPixels } from '../cli/lib/atlas.mjs';
import { packAtlasPixels } from '../cli/lib/atlas-pack.mjs';
import { sceneClock, eventAge, actionAt, cameraAt, cameraPoint, withCamera } from '../cli/runtime/animation.mjs';
import { renderSpec } from '../cli/runtime/render-spec.mjs';
import { stateAt, createPoseLibrary, drawPose } from '../cli/api.mjs';
import { cutAudio } from '../cli/lib/media.mjs';
import { run } from '../cli/runtime/project.mjs';

test('named performances retain their state across cuts and share calibrated pose drawing',()=>{
  const image={width:32,height:16},metadata={schema_version:1,width:32,height:16,reference_height:16,frames:[{region:[0,0,16,16],anchor:[8,15]},{region:[16,0,16,16],anchor:[24,15]}]};
  const library=createPoseLibrary({actor:image},{poses:{idle:{asset:'actor',atlas:'poses',frame:0},point:{asset:'actor',atlas:'poses',frame:1}}},{poses:metadata});
  const track=[[0,'idle'],[1,'point'],[2,'idle']];
  assert.equal(stateAt(1,track),'point');assert.equal(stateAt(1.8,track),'point');
  assert.equal(stateAt(2,track),'idle');
  const draws=[],ctx={save(){},restore(){},translate(){},rotate(){},scale(){},globalAlpha:1,drawImage(...args){draws.push(args);}};
  const placement=drawPose(ctx,library,stateAt(1.8,track),{x:100,y:90,height:32});
  assert.equal(draws[0][1],16);assert.equal(placement.scale,2);
  assert.deepEqual(placement.point([24,15]),{x:100,y:90});
  assert.throws(()=>stateAt(1,[[0,'a'],[0,'b']]),/increasing/);
  assert.throws(()=>createPoseLibrary({actor:image},{poses:{bad:{asset:'actor',region:[0,0,16,16],anchor:[8,15]}}}),/reference_height/);
  assert.throws(()=>drawPose(ctx,library,'missing',{}),/Unknown pose/);
});
import { createAtlas } from '../cli/runtime/sprites.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const media = ['ffmpeg', 'ffprobe'].every((tool) => spawnSync(tool, ['-version'], { windowsHide: true }).status === 0);
async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-production-'));
  t.after(async () => {
    assert.equal(path.dirname(parent), os.tmpdir()); assert.ok(path.basename(parent).startsWith('programmatic-video-production-'));
    await rm(parent, { recursive: true, force: true });
  });
  const root = path.join(parent, 'project');
  await createProject({ out: root, duration: '3', title: 'Production test' }, path.join(repo, 'templates/video'));
  return root;
}

test('batch project patches edit stable scene IDs, validate before saving and preserve authored code', async (t) => {
  const root = await fixture(t), file = path.join(root, 'project.json');
  const original = await readFile(file, 'utf8'), source = await readFile(path.join(root, 'src/scenes.js'), 'utf8');
  await assert.rejects(applyProjectPatch(root, { scenes: [{ id: 'run', end: 2 }] }), /noncontiguous/);
  assert.equal(await readFile(file, 'utf8'), original);
  const patch = { set: { duration: 4 }, scenes: [{ id: 'gate', end: 3 }, { id: 'jump', start: 3, end: 4, params: { actorScale: .8 } }] };
  const preview = await applyProjectPatch(root, patch, { dryRun: true });
  assert.equal(preview.applied, false); assert.equal(await readFile(file, 'utf8'), original);
  const changed = await applyProjectPatch(root, patch);
  assert.deepEqual(changed.changed_scenes, ['gate', 'jump']); assert.ok(changed.neighboring_scenes.includes('run'));
  const result = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(result.duration, 4); assert.equal(result.scenes[2].params.actorScale, .8);
  assert.equal(await readFile(path.join(root, 'src/scenes.js'), 'utf8'), source);
  assert.throws(() => patchProject(result, JSON.parse('{"set":{"__proto__":{"polluted":true}}}')), /Unsupported/);
  assert.throws(() => patchProject(result, { removeScenes: ['missing'] }), /Unknown scene/);
  assert.ok(projectChanges(result, { ...result, newField: true }).changed_fields.includes('newField'));
});

test('compact context omits historical payload and inventory leaves all project files intact', async (t) => {
  const root = await fixture(t), file = path.join(root, 'project.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.planning = { oldExperiments: 'x'.repeat(50_000) };
  await writeFile(file, JSON.stringify(config));
  const full = await context(root, path.join(root, 'memory'));
  const compact = await context(root, path.join(root, 'memory'), { summary: true });
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 5);
  assert.equal(compact.manifest.scenes.length, 3); assert.equal(compact.documents['plan.md'].file, 'plan.md');
  const inventory = await projectFiles(root); assert.equal(inventory.active.manifest, 'project.json'); assert.ok(inventory.groups.src.files > 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).planning.oldExperiments.length, 50_000);
});

test('camera transforms preserve shared contact points and recover world coordinates after a moving close-up', () => {
  const viewport = { width: 320, height: 180 };
  const camera = cameraAt(1, [{ time: 0, x: 160, y: 90, zoom: 1 }, { time: 2, x: 220, y: 80, zoom: 2, rotation: .2 }], viewport);
  const hand = { x: 205, y: 95 }, target = { ...hand };
  assert.deepEqual(cameraPoint(hand, camera, viewport), cameraPoint(target, camera, viewport));
  const screen = cameraPoint(hand, camera, viewport), recovered = cameraPoint(screen, camera, viewport, { inverse: true });
  assert.ok(Math.abs(recovered.x - hand.x) < 1e-9 && Math.abs(recovered.y - hand.y) < 1e-9);
  const calls = [];
  assert.throws(() => withCamera({ save: () => calls.push('save'), transform: () => {}, restore: () => calls.push('restore') }, camera, viewport, () => { throw new Error('draw failed'); }), /draw failed/);
  assert.deepEqual(calls, ['save', 'restore']);
});

test('scene-local events survive scene relocation and action phases do not restart after impact', () => {
  const scene = { start: 10, end: 14, events: { impact: 1.2 } };
  assert.equal(sceneClock(scene, 11.5).local, 1.5); assert.ok(Math.abs(eventAge(scene, 'impact', 11.5) - .3) < 1e-9);
  assert.equal(eventAge({ ...scene, start: 20, end: 24 }, 'impact', 21.5), eventAge(scene, 'impact', 11.5));
  assert.equal(actionAt(.5, { contact: 1, release: 1.1, end: 2 }).phase, 'prepare');
  assert.equal(actionAt(1.05, { contact: 1, release: 1.1, end: 2 }).phase, 'contact');
  assert.equal(actionAt(3, { contact: 1, release: 1.1, end: 2 }).complete, true);
  assert.throws(() => cameraAt(0, [{ time: 0 }, { time: 0 }], { width: 320, height: 180 }), /increasing/);
});

test('atlas packing preserves translucent edges, reference scale and named-anchor geometry', () => {
  const pixels = Buffer.alloc(16 * 8 * 4);
  for (const offset of [0, 8]) for (let y = 1; y < 6; y++) for (let x = 2; x < 5; x++) {
    const i = (y * 16 + offset + x) * 4; pixels[i] = offset ? 0 : 255; pixels[i + 2] = offset ? 255 : 0; pixels[i + 3] = 255;
  }
  pixels[(2 * 16 + 1) * 4 + 3] = 40;
  const report = inspectPixels(pixels, 16, 8, 2, 1, 180, { reference_height: 5, frames: [{ anchor: [3, 5], anchors: { contact: [4, 2] } }, { anchor: [11, 5] }] });
  const packed = packAtlasPixels(pixels, report, { padding: 1 });
  const frame = packed.report.frames[0];
  assert.equal(packed.report.reference_height, 5);
  assert.deepEqual([frame.anchors.contact[0] - frame.anchor[0], frame.anchors.contact[1] - frame.anchor[1]], [1, -3]);
  assert.ok([...packed.pixels].some((v, i) => i % 4 === 3 && v === 40));
  assert.equal(packed.report.frames.length, 2);
  const sparse = Buffer.alloc(8 * 8 * 4); sparse[(3 * 8 + 3) * 4 + 3] = 255;
  const masked = inspectPixels(sparse, 8, 8, 1, 1, 180, { frames: [{ polygon: [[0, 0], [8, 0], [8, 8], [0, 8]] }] });
  const trimmed = packAtlasPixels(sparse, masked);
  assert.doesNotThrow(() => createAtlas({ width: trimmed.report.width, height: trimmed.report.height }, trimmed.report));
  assert.ok(trimmed.report.frames[0].source_polygon);
});

test('caption text matching keeps supplied wording and consumes repeated lines in order', () => {
  const cues = [{ start: 0, end: 1, text: 'Hello, WORLD!' }, { start: 1, end: 2, text: 'Hello world' }];
  const matched = alignCaptionText(cues, 'hello world\nHELLO WORLD\nUnused');
  assert.deepEqual(matched.cues.map((c) => c.text), ['hello world', 'HELLO WORLD']);
  assert.deepEqual(matched.cues.map((c) => c.start), [0, 1]); assert.equal(matched.unmatched.length, 0);
  assert.equal(matched.unused_lines.length, 1);
  assert.equal(alignCaptionText(cues, 'hello world').unmatched.length, 1);
});

test('draft profiles retain the motion clock and pixel scale while reducing large output dimensions', () => {
  const original = { width: 1920, height: 1080, logicalWidth: 640, logicalHeight: 360, fps: 60, pixelArt: true };
  assert.deepEqual(renderSpec(original, { profile: 'draft' }), { profile: 'draft', width: 640, height: 360, fps: 60, preset: 'veryfast', crf: 25 });
  assert.equal(renderSpec(original).width, 1920); assert.equal(original.width, 1920);
});

test('audio fades change the selected clip without changing its source time mapping', { skip: !media }, async (t) => {
  const root = await fixture(t), input = path.join(root, 'tone.wav'), out = path.join(root, 'faded.wav');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=3', input]);
  await cutAudio({ input, out, start: '1', duration: '2', 'fade-in': '.5', 'fade-out': '.5' });
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { windowsHide: true });
  assert.equal(result.status, 0);
  const rms = (from, to) => {
    let total = 0; for (let i = from; i < to; i++) total += result.stdout.readInt16LE(i * 2) ** 2;
    return Math.sqrt(total / (to - from));
  };
  assert.ok(rms(0, 400) < rms(7000, 7400) / 3); assert.ok(rms(15600, 16000) < rms(7000, 7400) / 3);
  const source = JSON.parse(await readFile(out + '.source.json', 'utf8'));
  assert.equal(source.time_mapping.source_start_seconds, 1); assert.equal(source.edits.speed, 1);
});
