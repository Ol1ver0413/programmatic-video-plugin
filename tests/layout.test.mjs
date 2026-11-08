import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'cli/programmatic-video.mjs');
test('plugin launchers and package lock resolve the public CLI with portable shebangs', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  for (const name of ['programmatic-video', 'pixel-video']) {
    const file = path.join(root, 'bin', name);
    const bytes = await readFile(file);
    assert.ok(bytes.toString('utf8').startsWith('#!/usr/bin/env node\n'));
    assert.equal(bytes.includes(13), false, 'POSIX launchers must use LF');
    const result = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), pkg.version);
  }
});

test('init copies standalone runtime and materializes packaged ignore rules from an unrelated cwd', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-layout-'));
  t.after(async () => {
    assert.equal(path.dirname(parent), os.tmpdir());
    assert.ok(path.basename(parent).startsWith('programmatic-video-layout-'));
    await rm(parent, { recursive: true, force: true });
  });
  const project = path.join(parent, '可编辑 工程');
  const result = spawnSync(process.execPath, [cli, 'init', '--out', project, '--duration', '1'], { cwd: parent, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  for (const name of await readdir(path.join(root, 'cli/runtime'))) {
    assert.deepEqual(await readFile(path.join(project, 'tools', name)), await readFile(path.join(root, 'cli/runtime', name)));
  }
  assert.equal(await readFile(path.join(project, '.gitignore'), 'utf8'), await readFile(path.join(root, 'templates/video/gitignore'), 'utf8'));
  await assert.rejects(stat(path.join(project, 'gitignore')), { code: 'ENOENT' });
  const check = spawnSync(process.execPath, [path.join(project, 'tools/check.mjs')], { cwd: parent, encoding: 'utf8', windowsHide: true });
  assert.equal(check.status, 0, check.stderr);
});
