import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProject, run } from '../cli/runtime/project.mjs';
import { snapshotProject, hashFile } from '../cli/runtime/manifest.mjs';
import { timeMapping } from '../cli/runtime/timing.mjs';

const cli = fileURLToPath(new URL('../cli/programmatic-video.mjs', import.meta.url));
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
const available = ['ffmpeg', 'ffprobe'].every((exe) => spawnSync(exe, ['-version'], { windowsHide: true }).status === 0);
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-description-'));
  const root = path.join(parent, 'project');
  t.after(async () => {
    assert.equal(path.dirname(parent), os.tmpdir());
    assert.ok(path.basename(parent).startsWith('programmatic-video-description-'));
    await rm(parent, { recursive: true, force: true });
  });
  const initialized = invoke('init', '--out', root, '--duration', '1');
  assert.equal(initialized.status, 0, initialized.stderr);
  await mkdir(path.join(root, 'output'), { recursive: true });
  const project = await json(path.join(root, 'project.json'));
  Object.assign(project, { width: 32, height: 32, logicalWidth: 32, logicalHeight: 32,
    fps: 8, font: null, audio: null, captions: null });
  await writeFile(path.join(root, 'animation.js'), 'export function draw() {}\n');
  project.scenes = [{ id: 'first', start: 0, end: .5, intent: 'First scene',
    source: { file: 'animation.js', symbol: 'draw' }, assets: [], params: { scale: 1, offset: 0 } },
    { id: 'second', start: .5, end: 1, intent: 'Second scene' }];
  project.review = { requirements: [
    { id: 'visible-label', text: 'The card says READY.', scenes: ['first'], source: 'brief.md', reference: 'brief.md' },
    { id: 'ending', text: 'End on blue.', scenes: ['second'], source: 'brief.md' },
  ] };
  const save = () => writeFile(path.join(root, 'project.json'), JSON.stringify(project)); await save();
  return { root, project, save };
}

test('one project description locates half-open scenes and edits declared parameters without changing source', async (t) => {
  const f = await fixture(t), source = await readFile(path.join(f.root, 'animation.js'));
  const locate = invoke('project', '--project', f.root, '--time', '0.5');
  assert.equal(locate.status, 0, locate.stderr);
  assert.equal(JSON.parse(locate.stdout).scenes[0].id, 'second');
  const edit = invoke('project', '--project', f.root, '--scene', 'first', '--set', 'offset', '--value=-12');
  assert.equal(edit.status, 0, edit.stderr);
  assert.equal((await json(path.join(f.root, 'project.json'))).scenes[0].params.offset, -12);
  assert.deepEqual(await readFile(path.join(f.root, 'animation.js')), source);
  const before = await readFile(path.join(f.root, 'project.json'));
  for (const [key, value] of [['unknown', '2'], ['scale', '1e400'], ['scale', '"wrong type"']]) {
    assert.equal(invoke('project', '--project', f.root, '--scene', 'first', '--set', key, '--value', value).status, 1);
    assert.deepEqual(await readFile(path.join(f.root, 'project.json')), before);
  }
});

test('optional scene links preserve legacy descriptions and reject broken resources and requirements', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await validateProject(f.root, { probeAudio: false })).errors, []);
  f.project.scenes[0].assets = ['missing']; await f.save();
  assert.ok((await validateProject(f.root, { probeAudio: false })).errors.some((error) => error.includes('registered')));
  f.project.scenes[0].assets = []; f.project.scenes[0].source.file = '../outside.js'; await f.save();
  assert.ok((await validateProject(f.root, { probeAudio: false })).errors.some((error) => error.includes('leaves project')));
  delete f.project.scenes[0].source; delete f.project.scenes[0].params;
  delete f.project.review; await f.save();
  assert.deepEqual((await validateProject(f.root, { probeAudio: false })).errors, []);
  f.project.review = { requirements: 'invalid' }; await f.save();
  assert.ok((await validateProject(f.root, { probeAudio: false })).errors.some((error) => error.includes('array')));
});

test('bound export lookups retain old parameters/source text and detect a changed current project', { skip: !available }, async (t) => {
  const f = await fixture(t), video = path.join(f.root, 'output/video.mp4');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=8:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const snapshot = await snapshotProject(f.root, f.project, []);
  const report = { video_sha256: await hashFile(video), project_snapshot: snapshot, time_mapping: timeMapping(0, 1) };
  await writeFile(path.join(f.root, 'output/render-report.json'), JSON.stringify(report));
  invoke('project', '--project', f.root, '--scene', 'first', '--set', 'scale', '--value', '0.7');
  await assert.rejects(snapshotProject(f.root, f.project, []), /description changed/);
  await appendFile(path.join(f.root, 'animation.js'), '// Current source changed\n');
  const result = invoke('project', '--project', f.root, '--input', 'output/video.mp4', '--time', '0.2');
  assert.equal(result.status, 0, result.stderr);
  const located = JSON.parse(result.stdout);
  assert.equal(located.scenes[0].params.scale, 1);
  assert.equal(located.source_matches_current, false);
  assert.equal(snapshot.inputs.find((input) => input.file === 'animation.js').text, 'export function draw() {}\n');
  const frozen = invoke('validate', '--project', f.root, '--input', 'output/video.mp4', '--report', 'output/render-report.json');
  assert.equal(frozen.status, 0, frozen.stdout + frozen.stderr);
  await appendFile(video, Buffer.from([0]));
  assert.equal(invoke('project', '--project', f.root, '--input', 'output/video.mp4').status, 1);
});

test('review combines common and scoped user checks, keeps incomplete work open, and rejects stale evidence', { skip: !available }, async (t) => {
  const f = await fixture(t), video = path.join(f.root, 'output/video.mp4');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=8:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  await writeFile(path.join(f.root, 'output/render-report.json'), JSON.stringify({
    video_sha256: await hashFile(video), project_snapshot: await snapshotProject(f.root, f.project, []),
    time_mapping: timeMapping(0, 1),
  }));
  const prepared = invoke('review', '--project', f.root, '--input', 'output/video.mp4', '--scene', 'first');
  assert.equal(prepared.status, 0, prepared.stderr);
  const summary = JSON.parse(prepared.stdout), task = await json(path.join(f.root, summary.task));
  assert.ok(task.checks.some((check) => check.id === 'common:composition'));
  assert.ok(task.checks.some((check) => check.id === 'user:visible-label'));
  assert.ok(!task.checks.some((check) => check.id === 'user:ending'));
  const observations = path.posix.join(path.posix.dirname(summary.task), 'observations.json');
  const result = { task_id: task.task_id, video_sha256: task.video_sha256, checks: [
    { id: 'common:media', status: 'pass', note: 'Encoded checks passed.', evidence: [task.technical.report] },
  ] };
  const record = () => invoke('review', '--project', f.root, '--task', summary.task, '--result', observations);
  await writeFile(path.join(f.root, observations), JSON.stringify(result));
  let recorded = record(); assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(JSON.parse(recorded.stdout).status, 'incomplete');
  result.checks = task.checks.map((check) => ({ id: check.id, status: 'pass', note: 'Fixture evidence checked.', evidence: [task.technical.report] }));
  result.checks.find((check) => check.id === 'user:visible-label').status = 'not_applicable';
  await writeFile(path.join(f.root, observations), JSON.stringify(result));
  assert.equal(record().status, 1);
  Object.assign(result.checks.find((check) => check.id === 'user:visible-label'),
    { status: 'issue', scene: 'first', time: .2, note: 'Required label is absent.', suggestion: 'Draw the requested title.' });
  await writeFile(path.join(f.root, observations), JSON.stringify(result));
  recorded = record(); assert.equal(recorded.status, 0, recorded.stderr);
  const recordedData = JSON.parse(recorded.stdout);
  assert.equal(recordedData.status, 'needs_changes');
  assert.equal((await json(path.join(f.root, recordedData.result))).revisions.length, 1);
  Object.assign(result.checks.find((check) => check.id === 'user:visible-label'),
    { status: 'pass', note: 'Fixture evidence checked.' });
  await writeFile(path.join(f.root, observations), JSON.stringify(result));
  assert.equal(JSON.parse(record().stdout).status, 'reviewed');
  const finishInput = path.join(f.root, 'output/qa/finish.json');
  const finishData = { summary: 'Fixture delivery', style: 'Solid color test',
    deliverables: ['output/video.mp4'], reviewTask: summary.task };
  await writeFile(finishInput, JSON.stringify(finishData));
  const finish = () => invoke('finish', '--project', f.root, '--input', finishInput,
    '--memory-dir', path.join(f.root, '.test-memory'));
  const partialFinish = finish(); assert.equal(partialFinish.status, 1);
  assert.match(partialFinish.stderr, /full project/);
  const full = JSON.parse(invoke('review', '--project', f.root, '--input', 'output/video.mp4').stdout);
  const fullTask = await json(path.join(f.root, full.task));
  const fullObservations = path.posix.join(path.posix.dirname(full.task), 'observations.json');
  await writeFile(path.join(f.root, fullObservations), JSON.stringify({ task_id: fullTask.task_id,
    video_sha256: fullTask.video_sha256, checks: fullTask.checks.map((check) => ({
      id: check.id, status: 'pass', note: 'Fixture evidence checked.', evidence: [fullTask.technical.report],
    })) }));
  const fullRecorded = invoke('review', '--project', f.root, '--task', full.task, '--result', fullObservations);
  assert.equal(fullRecorded.status, 0, fullRecorded.stderr);
  await writeFile(finishInput, JSON.stringify({ ...finishData, reviewTask: full.task }));
  const fullFinish = finish(); assert.equal(fullFinish.status, 0, fullFinish.stderr);
  const referenceBytes = await readFile(path.join(f.root, 'brief.md'));
  await appendFile(path.join(f.root, 'brief.md'), '\nChanged review reference\n');
  const changedReference = record(); assert.equal(changedReference.status, 1);
  assert.match(changedReference.stderr, /reference changed/);
  await writeFile(path.join(f.root, 'brief.md'), referenceBytes);
  f.project.review.requirements[0].text = 'The card now says GO.'; await f.save();
  const stale = record(); assert.equal(stale.status, 1); assert.match(stale.stderr, /requirements changed/);
  assert.equal(invoke('review', '--project', f.root, '--input', 'output/video.mp4', '--out', 'output/qa/../../src/bad').status, 1);
});
