// Real-browser integration, using a local Playwright installation; no downloads.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, symlink, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { run } from '../skills/using-programmatic-video/assets/starter/tools/project.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const dependency = path.resolve(process.argv[2] || '.work/smoke/node_modules/playwright/index.mjs');
const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-playback-'));
const root = path.join(parent, 'project');
const cli = path.join(repo, 'scripts/programmatic-video.mjs');
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 90000 });
const save = (file, value) => writeFile(path.join(root, file), JSON.stringify(value));
const report = async () => JSON.parse(await readFile(path.join(root, 'output/qa/playback.json'), 'utf8'));
try {
  const init = invoke('init', '--out', root, '--duration', '1.2');
  assert.equal(init.status, 0, init.stderr);
  await symlink(path.dirname(path.dirname(dependency)), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const project = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
  Object.assign(project, { width: 320, height: 180, logicalWidth: 320, logicalHeight: 180, font: null, pixelArt: false });
  await save('captions.json', [{ start: 0, end: 0.003, text: 'tiny cue' }, { start: 0.2, end: 1.2, text: 'A quiet explanation' }]);
  await save('project.json', project);
  const validate = () => invoke('validate', '--project', root, '--playback');
  let checked = validate();
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal((await report()).caption_checks, 6);
  assert.equal((await report()).playback.audio_duration, null);

  for (const length of [1.2, 2.4]) {
    const file = `tone-${length}.wav`;
    run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${length}`, path.join(root, file)]);
    project.audio = file;
    await save('project.json', project);
    checked = validate();
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal((await report()).playback.audio_ended, length === 1.2);
  }

  const playerPath = path.join(root, 'src/player.js');
  const player = await readFile(playerPath, 'utf8');
  project.audio = 'tone-1.2.wav';
  await save('project.json', project);
  const badPlayer = player.replace("audio.onplay = () => (play.textContent = '暂停');", `
    let starts = 0;
    audio.onplay = () => {
      play.textContent = '暂停';
      if (++starts === 2) setTimeout(() => {
        audio.pause();
        audio.currentTime = project.duration - 0.01;
      }, 200);
    };
  `);
  assert.notEqual(badPlayer, player, 'Regression fixture must change the player');
  await writeFile(playerPath, badPlayer);
  checked = validate();
  assert.equal(checked.status, 1, checked.stderr);
  assert.match((await report()).error, /native ended/);
  assert.equal((await report()).ok, false);
  await writeFile(playerPath, player + '\nconst originalRender = window.__render; window.__render = t => ({...originalRender(t), caption: "wrong"});\n');
  checked = validate();
  assert.equal(checked.status, 1);
  assert.match((await report()).error, /Caption at/);
  await writeFile(playerPath, player);

  project.assets = { missing: 'missing.png' };
  await save('project.json', project);
  checked = validate();
  assert.equal(checked.status, 1);
  assert.equal((await report()).ok, false, 'Static failure must replace any previous successful playback report');
  assert.equal((await report()).stage, 'static validation');
  project.assets = {};
  await save('project.json', project);

  const rendered = invoke('render', '--project', root, '--no-stills');
  assert.equal(rendered.status, 0, rendered.stderr);
  const exported = JSON.parse(await readFile(path.join(root, 'output/render-report.json'), 'utf8'));
  assert.equal(exported.stills_written, 0);
  assert.equal(exported.full_decode, 'passed');
  await assert.rejects(access(path.join(root, 'output/stills')), { code: 'ENOENT' });
  assert.equal(invoke('render', '--project', root, '--stills', '--no-stills').status, 1);
  console.log(JSON.stringify({ silent_nonpixel: true, tiny_cues: true, equal_length_audio_ended: true, longer_audio_stops: true, premature_pause_rejected: true, bad_captions_rejected: true, no_stills_export: true }));
} finally {
  assert.equal(path.dirname(parent), os.tmpdir());
  assert.ok(path.basename(parent).startsWith('programmatic-video-playback-'));
  await rm(parent, { recursive: true, force: true });
}
