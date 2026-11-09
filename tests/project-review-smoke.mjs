// Real version-to-project lookup and review preparation; optional retained fixture for a host reviewer.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const keep = process.env.KEEP_PROJECT_REVIEW_FIXTURE === '1';
const dependency = path.resolve(process.argv[2] || path.join(repo, '.work/smoke/node_modules/playwright/index.mjs'));
const parent = keep
  ? await mkdtemp(path.join(repo, '.work/project-review-'))
  : await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-project-review-'));
const project = path.join(parent, 'project'), cli = path.join(repo, 'cli/programmatic-video.mjs');
function invoke(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  return result.stdout;
}
const json = async (file) => JSON.parse(await readFile(path.join(project, file), 'utf8'));
try {
  invoke('init', '--out', project, '--duration', '3');
  await symlink(path.dirname(path.dirname(dependency)), path.join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const config = await json('project.json');
  Object.assign(config, { width: 640, height: 360, logicalWidth: 320, logicalHeight: 180,
    fps: 10, font: null, audio: null, captions: null, pixelArt: false });
  config.scenes = [
    { id: 'intro', start: 0, end: 1, intent: 'A static introductory card.', source: { file: 'src/scenes.js', symbol: 'drawScene' }, params: { title: 'INTRO', offsetX: 0 } },
    { id: 'action', start: 1, end: 2, intent: 'A static title card as specified in the brief.', source: { file: 'src/scenes.js', symbol: 'drawScene' }, params: { title: 'WAIT', offsetX: 0 } },
    { id: 'ending', start: 2, end: 3, intent: 'A static ending card.', source: { file: 'src/scenes.js', symbol: 'drawScene' }, params: { title: 'END', offsetX: 0 } },
  ];
  config.review = { requirements: [{ id: 'title-text', text: 'The action title card must clearly read READY.', scenes: ['action'], source: 'brief.md' }] };
  await writeFile(path.join(project, 'project.json'), JSON.stringify(config));
  await writeFile(path.join(project, 'brief.md'), '# Title card request\n\nCreate a silent three-card video. The action card must clearly read READY. Static holds are intentional; no characters, captions or motion are required.\n');
  await writeFile(path.join(project, 'src/scenes.js'), `
    export function drawScene({ctx,scene,width,height}){
      ctx.fillStyle=scene.id==='action'?'#164a42':'#15293d';ctx.fillRect(0,0,width,height);
      ctx.fillStyle='#f6df9a';ctx.fillRect(28,30,264,3);
      ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff7e8';
      ctx.fillText(scene.params.title,width/2+scene.params.offsetX,height/2);
    }
  `);
  invoke('render', '--project', project, '--scene', 'action', '--out', 'output/previews/action-v1.mp4');
  const oldBytes = await readFile(path.join(project, 'output/previews/action-v1.mp4'));
  const oldReport = await json('output/previews/action-v1.mp4.report.json');
  assert.equal(oldReport.project_snapshot.project.scenes[1].params.title, 'WAIT');
  invoke('project', '--project', project, '--scene', 'action', '--set', 'title', '--value', '"READY"');
  const old = JSON.parse(invoke('project', '--project', project, '--input', 'output/previews/action-v1.mp4', '--time', '0.4'));
  assert.equal(old.project_time, 1.4); assert.equal(old.scenes[0].params.title, 'WAIT');
  assert.equal(old.source_matches_current, false);
  const oldFrames = JSON.parse(invoke('frames', '--project', project, '--input', 'output/previews/action-v1.mp4',
    '--report', 'output/previews/action-v1.mp4.report.json', '--scene', 'action', '--samples', '3'));
  invoke('render', '--project', project, '--scene', 'action', '--out', 'output/previews/action-v2.mp4');
  const newBytes = await readFile(path.join(project, 'output/previews/action-v2.mp4'));
  assert.notDeepEqual(newBytes, oldBytes, 'Declared parameter change must affect rendered pixels/video');
  const fresh = JSON.parse(invoke('project', '--project', project, '--input', 'output/previews/action-v2.mp4', '--time', '0.4'));
  assert.equal(fresh.scenes[0].params.title, 'READY'); assert.equal(fresh.source_matches_current, true);
  const tasks = [];
  for (const version of ['v1', 'v2']) {
    const prepared = JSON.parse(invoke('review', '--project', project, '--input', `output/previews/action-${version}.mp4`));
    assert.equal(prepared.binding, 'exported'); assert.equal(prepared.technical_ok, true);
    const task = await json(prepared.task);
    assert.ok(task.checks.some((check) => check.id === 'user:title-text'));
    tasks.push({ version, task: prepared.task });
  }
  await mkdir(path.join(project, 'output/qa/fixture'), { recursive: true });
  await writeFile(path.join(project, 'output/qa/fixture/review-tasks.json'), JSON.stringify({ project, tasks }, null, 2));
  console.log(JSON.stringify({ passed: true, singleProjectDescription: true,
    parameterAffectsRealVideo: true, frozenVersionLookup: true,
    encodedFrozenFrameSampling: true, generalAndUserReviewChecks: true,
    ...(keep ? { fixture: project, tasks, existingEvidence: oldFrames.report } : {}) }));
} finally {
  if (!keep) {
    assert.equal(path.dirname(parent), os.tmpdir());
    assert.ok(path.basename(parent).startsWith('programmatic-video-project-review-'));
    await rm(parent, { recursive: true, force: true });
  }
}
