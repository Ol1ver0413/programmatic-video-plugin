// Run against an extracted npm package to catch checkout-only resource paths.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { readFile, stat, mkdtemp, rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { checkPackage } from '../scripts/release.mjs';

if (!process.argv[2]) throw new Error('Usage: node tests/package-smoke.mjs <extracted-package-directory>');
const root = path.resolve(process.argv[2]);
const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-package-'));
const project = path.join(parent, '新 工程');
const run = (entry, args = []) => spawnSync(process.execPath, [path.join(root, entry), ...args], { cwd: parent, encoding: 'utf8', windowsHide: true });
async function packagedFiles(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) files.push(...await packagedFiles(path.join(directory, item.name), name + '/'));
    else files.push({ path: name });
  }
  return files;
}
try {
  checkPackage(await packagedFiles(root));
  const version = run('bin/programmatic-video', ['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), expected);
  assert.equal(run('scripts/programmatic-video.mjs', ['--version']).status, 0);
  const init = run('cli/programmatic-video.mjs', ['init', '--out', project, '--duration', '1']);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(await readFile(path.join(project, '.gitignore'), 'utf8'), await readFile(path.join(root, 'templates/video/gitignore'), 'utf8'));
  await assert.rejects(stat(path.join(project, 'gitignore')), { code: 'ENOENT' });
  for (const name of await readdir(path.join(root, 'cli/runtime')))
    assert.deepEqual(await readFile(path.join(project, 'tools', name)), await readFile(path.join(root, 'cli/runtime', name)));
  const check = spawnSync(process.execPath, [path.join(project, 'tools/check.mjs')], { cwd: parent, encoding: 'utf8', windowsHide: true });
  assert.equal(check.status, 0, check.stderr);
  const hook = spawnSync(process.execPath, [path.join(root, 'hooks/session-start.mjs')], {
    input: '{"hook_event_name":"SessionStart","source":"startup"}', cwd: parent, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PROGRAMMATIC_VIDEO_MEMORY_DIR: path.join(parent, 'unused-memory') },
  });
  assert.equal(hook.status, 0, hook.stderr);
  const guide = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.ok(guide.includes('Using Programmatic Video'));
  assert.ok(guide.includes('cli/programmatic-video.mjs'));
  await assert.rejects(stat(path.join(parent, 'unused-memory')), { code: 'ENOENT' });
  await stat(path.join(root, 'cli/lib/audio-audit.py'));
  await stat(path.join(root, 'agents/video-reviewer.md'));
  const buddy = JSON.parse(await readFile(path.join(root, '.codebuddy-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(root, '.codebuddy-plugin/marketplace.json'), 'utf8'));
  assert.equal(buddy.name, 'programmatic-video');
  assert.equal(buddy.version, expected);
  assert.equal(marketplace.plugins[0].name, buddy.name);
  assert.equal(path.resolve(root, marketplace.plugins[0].source), root);
  assert.equal((await readdir(path.join(root, 'skills'))).length, 6);
  await stat(path.join(root, 'hooks/hooks.json'));
  await stat(path.join(root, 'docs/workbuddy.md'));
  await stat(path.join(root, 'skills/producing-video/references/asset-reuse.md'));
  await stat(path.join(project, 'tools/manifest.mjs'));
  await stat(path.join(project, 'tools/animation.mjs'));
  await stat(path.join(project, 'tools/render-core.mjs'));
  const apiPath = createRequire(path.join(root, 'package.json')).resolve('programmatic-video-plugin');
  const api = await import(pathToFileURL(apiPath));
  for (const name of ['applyProjectPatch', 'renderProject', 'renderIncremental', 'prepareAtlases', 'cameraAt', 'collectFrames']) assert.equal(typeof api[name], 'function');
  assert.equal(run('cli/programmatic-video.mjs', ['project', '--project', project, '--time', '0.1']).status, 0);
  console.log(JSON.stringify({ archive_version: expected, canonical_and_legacy_entries: true, public_api: true, unrelated_cwd: true, standalone_project_runtime: true, packaged_ignore_rules: true, session_hook: true, codebuddy_distribution: true, optional_audio_helper: true }));
} finally {
  assert.equal(path.dirname(parent), os.tmpdir());
  assert.ok(path.basename(parent).startsWith('programmatic-video-package-'));
  await rm(parent, { recursive: true, force: true });
}
