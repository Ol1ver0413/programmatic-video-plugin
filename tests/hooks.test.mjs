import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sessionStart} from '../hooks/session-start.mjs';

test('startup, resume and compaction return the same scoped entry guide without creating memory', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-hook-'));
  t.after(async () => {
    assert.equal(path.dirname(parent), os.tmpdir());
    assert.ok(path.basename(parent).startsWith('programmatic-video-hook-'));
    await rm(parent, {recursive:true, force:true});
  });
  const memory = path.join(parent, 'memory');
  const hook = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url));
  let first;
  for(const source of ['startup', 'resume', 'compact']) {
    const result = spawnSync(process.execPath, [hook], {input:JSON.stringify({hook_event_name:'SessionStart', source}), encoding:'utf8', windowsHide:true,
      env:{...process.env, PROGRAMMATIC_VIDEO_MEMORY_DIR:memory}});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
    const guide = payload.hookSpecificOutput.additionalContext;
    assert.ok(guide.includes('Using Programmatic Video'));
    assert.ok(!guide.startsWith('---'));
    first ??= guide; assert.equal(guide, first);
  }
  assert.deepEqual(await sessionStart({hook_event_name:'Stop'}), {});
  await assert.rejects(stat(memory), {code:'ENOENT'});
});

test('host manifests stay versioned together and every stage reference resolves', async () => {
  const portable = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
  const codex = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
  const claude = JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const buddy = JSON.parse(await readFile(new URL('../.codebuddy-plugin/plugin.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for(const manifest of [portable, codex, claude, buddy]) assert.equal(manifest.version, pkg.version);
  assert.equal(portable.extensions['com.openai'].hooks, './hooks/hooks.json');
  assert.equal(codex.hooks, './hooks/hooks.json');
  const config = JSON.parse(await readFile(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  assert.match(config.hooks.SessionStart[0].hooks[0].command, /node .*session-start\.mjs/);
  for(const stage of ['using-programmatic-video', 'brainstorming', 'writing-plans', 'producing-video', 'reviewing-video', 'finishing-video']) {
    const location = new URL(`../skills/${stage}/SKILL.md`, import.meta.url);
    const contents = await readFile(location, 'utf8');
    for(const match of contents.matchAll(/\]\(([^)]+\.md)\)/g)) await readFile(new URL(match[1], location), 'utf8');
  }
});
