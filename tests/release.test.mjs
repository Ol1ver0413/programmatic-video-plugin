import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import {
  repoRoot,
  run,
  git,
  parseVersion,
  compareVersions,
  setVersion,
  checkVersion,
  releaseNotes,
} from '../scripts/version.mjs';
import { checkPackage, tagDecision, publish } from '../scripts/release.mjs';

const json = async (root, name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const notes = (version) =>
  `# Changelog\n\n## [${version}] - 2026-11-10\n\n- A tested plugin update.\n`;

async function fixture(t, version = '0.1.0', { initial = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-version-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('programmatic-video-version-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = await json(repoRoot, '.version-bump.json');
  for (const name of new Set(['.version-bump.json', ...config.files.map((item) => item.path)])) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await copyFile(path.join(repoRoot, name), path.join(root, name));
  }
  await setVersion(root, version);
  if (!initial) await writeFile(path.join(root, 'CHANGELOG.md'), notes(version));
  await mkdir(path.join(root, 'cli'));
  await writeFile(path.join(root, 'cli/example.mjs'), 'export const value = 1;\n');
  run('git', ['init', '--initial-branch=main'], root);
  git(root, 'config', 'user.name', 'Release test');
  git(root, 'config', 'user.email', 'release-test@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Fixture baseline');
  return { root, base: git(root, 'rev-parse', 'HEAD'), config };
}

test('release versions reject ambiguous values and order numeric prereleases correctly', () => {
  for (const value of ['0.1.0', '1.2.3-beta.12', '10.20.30-rc.1']) assert.ok(parseVersion(value));
  for (const value of [
    'v0.1.0',
    '01.2.3',
    '1.2',
    '1.2.3.4',
    '1.2.3-beta.01',
    '1.2.3\n',
    '1.2.3+build',
  ]) {
    assert.throws(() => parseVersion(value), /Invalid release version/);
  }
  assert.equal(compareVersions('0.1.0-beta.10', '0.1.0-beta.2'), 1);
  assert.equal(compareVersions('0.1.0-beta.10', '0.1.0'), -1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.1.99'), 1);
});

test('one version update synchronizes every host and both lock fields, with preflight before writes', async (t) => {
  const { root, config } = await fixture(t);
  await setVersion(root, '0.2.0');
  for (const entry of config.files) {
    const value = entry.field.reduce((current, key) => current[key], await json(root, entry.path));
    assert.equal(value, '0.2.0');
  }
  const before = await readFile(path.join(root, 'package.json'));
  await writeFile(path.join(root, '.codex-plugin/plugin.json'), '{}\n');
  await assert.rejects(setVersion(root, '0.3.0'), /Missing version field/);
  assert.deepEqual(await readFile(path.join(root, 'package.json')), before);
});

test('release checks reject host drift and missing or duplicate notes', async (t) => {
  const { root } = await fixture(t);
  const host = await json(root, '.codebuddy-plugin/plugin.json');
  host.version = '0.2.0';
  await writeFile(path.join(root, '.codebuddy-plugin/plugin.json'), JSON.stringify(host));
  await assert.rejects(checkVersion(root), /Version drift/);
  await setVersion(root, '0.1.0');
  await writeFile(path.join(root, 'CHANGELOG.md'), notes('0.2.0'));
  await assert.rejects(checkVersion(root), /exactly one/);
  assert.throws(() => releaseNotes(notes('0.1.0') + notes('0.1.0'), '0.1.0'), /exactly one/);
  assert.throws(() => releaseNotes('## [0.1.0] - 2026-11-10\n', '0.1.0'), /Write release notes/);
  assert.equal(
    releaseNotes(notes('0.1.0') + '\n## [0.0.9] - 2026-11-09\n\n- Previous release.\n', '0.1.0'),
    '- A tested plugin update.',
  );
});

test('main changes to the installed plugin need an increasing version; maintenance can keep it', async (t) => {
  const { root, base } = await fixture(t);
  await writeFile(path.join(root, 'README.md'), 'Documentation only.\n');
  assert.equal((await checkVersion(root, { base })).version, '0.1.0');
  await writeFile(path.join(root, 'cli/example.mjs'), 'export const value = 2;\n');
  await assert.rejects(checkVersion(root, { base }), /need a new version/);
  await setVersion(root, '0.1.1');
  await writeFile(path.join(root, 'CHANGELOG.md'), notes('0.1.1'));
  assert.equal((await checkVersion(root, { base })).tag, 'v0.1.1');
  await setVersion(root, '0.0.9');
  await writeFile(path.join(root, 'CHANGELOG.md'), notes('0.0.9'));
  await assert.rejects(checkVersion(root, { base }), /must increase/);
});

test('initial version setup is limited to the first release and its exact tagged retry', async (t) => {
  const { root, base } = await fixture(t, '0.5.0', { initial: true });
  await setVersion(root, '0.1.0');
  await writeFile(path.join(root, 'CHANGELOG.md'), notes('0.1.0'));
  assert.equal((await checkVersion(root, { base })).tag, 'v0.1.0');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial public release');
  git(root, 'tag', 'v0.1.0');
  assert.equal(
    (await checkVersion(root, { base })).tag,
    'v0.1.0',
    'the original tagged workflow can be retried',
  );
  const other = await fixture(t, '0.5.0', { initial: true });
  git(other.root, 'tag', 'v0.0.1');
  await setVersion(other.root, '0.1.0');
  await writeFile(path.join(other.root, 'CHANGELOG.md'), notes('0.1.0'));
  await assert.rejects(checkVersion(other.root, { base: other.base }), /must increase/);
});

test('release archive checks require the complete plugin and exclude private or generated files', () => {
  const files = [
    'plugin.json',
    '.codebuddy-plugin/plugin.json',
    '.codebuddy-plugin/marketplace.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'cli/programmatic-video.mjs',
    'bin/programmatic-video',
    'hooks/hooks.json',
    'hooks/session-start.mjs',
    'templates/video/project.json',
    'agents/video-reviewer.md',
    'LICENSE',
    ...[
      'using-programmatic-video',
      'brainstorming',
      'writing-plans',
      'producing-video',
      'reviewing-video',
      'finishing-video',
    ].map((name) => `skills/${name}/SKILL.md`),
  ].map((name) => ({ path: name }));
  checkPackage(files);
  for (const name of [
    '.context/review.md',
    'traces/session.jsonl',
    'output/video.mp4',
    'memory/preferences.json',
  ]) {
    assert.throws(() => checkPackage([...files, { path: name }]), /Private or generated/);
  }
  assert.throws(
    () => checkPackage(files.filter((file) => file.path !== 'cli/programmatic-video.mjs')),
    /missing/,
  );
});

test('release tags cannot move and only drafts can be resumed', () => {
  assert.equal(tagDecision({ head: 'a' }), 'create');
  assert.equal(tagDecision({ head: 'a', target: 'a', published: false }), 'resume');
  assert.equal(tagDecision({ head: 'a', target: 'a', published: true }), 'skip');
  assert.equal(
    tagDecision({ head: 'b', target: 'a', ancestor: true, pluginChanged: false, published: true }),
    'skip',
  );
  for (const state of [
    { ancestor: false, published: true },
    { ancestor: true, pluginChanged: true, published: true },
    { ancestor: true, pluginChanged: false, published: false },
  ]) {
    assert.throws(() => tagDecision({ head: 'b', target: 'a', ...state }), /Never move/);
  }
});

test('publication refuses feature branches and local invocations before any remote action', async () => {
  await assert.rejects(publish(repoRoot, {}), /successful main/);
  await assert.rejects(
    publish(repoRoot, { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/topic' }),
    /successful main/,
  );
});
