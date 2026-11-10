#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { repoRoot, run, git, checkVersion, isPluginChange } from './version.mjs';

export function checkPackage(files) {
  const forbidden = files.filter(
    ({ path: name }) =>
      name
        .split(/[\\/]/)
        .some((part) =>
          [
            '.context',
            '.work',
            'node_modules',
            '.git',
            'projects',
            'output',
            'memory',
            'traces',
            '.traces',
            '.programmatic-video',
          ].includes(part),
        ) ||
      /(?:\.jsonl|\.mp4|\.mov|\.tgz|\.log|\.tmp)$/i.test(name) ||
      /rollout-/i.test(name),
  );
  if (forbidden.length)
    throw new Error(
      `Private or generated files in package: ${forbidden.map((file) => file.path).join(', ')}`,
    );
  for (const required of [
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
  ]) {
    if (!files.some((file) => file.path === required))
      throw new Error(`Package missing ${required}`);
  }
  const skills = files.filter((file) => /^skills\/[^/]+\/SKILL.md$/.test(file.path));
  if (skills.length !== 6) throw new Error('Package must contain all six workflow skills');
}

export function tagDecision({ head, target, ancestor, pluginChanged, published }) {
  if (!target) return 'create';
  if (target === head) return published ? 'skip' : 'resume';
  if (ancestor && !pluginChanged && published) return 'skip';
  throw new Error(
    'Existing version tag belongs to a different release. Never move it; use a new version or rerun its original workflow.',
  );
}

export async function pack(root, destination) {
  const [metadata] = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], root)
      .stdout,
  );
  checkPackage(metadata.files);
  return path.join(destination, metadata.filename);
}

export async function publish(root = repoRoot, env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Publish only through the successful main GitHub Actions workflow');
  }
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''))
    throw new Error('Missing repository');
  const release = await checkVersion(root),
    head = git(root, 'rev-parse', 'HEAD');
  if (head !== env.GITHUB_SHA)
    throw new Error('Checkout does not match the tested workflow commit');
  if (git(root, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('Release checkout must be clean');
  git(root, 'merge-base', '--is-ancestor', head, 'origin/main');
  const refs = git(
    root,
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${release.tag}`,
    `refs/tags/${release.tag}^{}`,
  )
    .split('\n')
    .filter(Boolean);
  const target = (refs.find((line) => line.endsWith('^{}')) ?? refs[0])?.split(/\s+/)[0];
  const prior = run(
    'gh',
    ['release', 'view', release.tag, '--repo', repository, '--json', 'isDraft,url'],
    root,
    { optional: true },
  );
  if (prior.status && !/release not found/i.test(prior.stderr)) throw new Error(prior.stderr);
  const existing = prior.status ? null : JSON.parse(prior.stdout);
  const ancestor = target
    ? run('git', ['merge-base', '--is-ancestor', target, head], root, { optional: true }).status ===
      0
    : false;
  const pluginChanged =
    target && ancestor
      ? git(root, 'diff', '--name-only', target, head).split('\n').some(isPluginChange)
      : true;
  const decision = tagDecision({
    head,
    target,
    ancestor,
    pluginChanged,
    published: existing && !existing.isDraft,
  });
  if (decision === 'skip')
    return { version: release.version, status: 'already-published', url: existing.url };

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-release-'));
  try {
    const archive = await pack(root, temporary);
    const notes = path.join(temporary, 'notes.md'),
      checksumFile = path.join(temporary, 'SHA256SUMS.txt');
    const checksum = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    await writeFile(notes, release.notes + '\n');
    await writeFile(checksumFile, `${checksum}  ${path.basename(archive)}\n`);
    if (decision === 'create') {
      git(root, 'config', 'user.name', 'github-actions[bot]');
      git(root, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
      git(root, 'tag', '-a', release.tag, head, '-m', `Programmatic Video ${release.version}`);
      git(root, 'push', 'origin', `refs/tags/${release.tag}`);
    }
    if (!existing) {
      run(
        'gh',
        [
          'release',
          'create',
          release.tag,
          '--repo',
          repository,
          '--verify-tag',
          '--draft',
          '--title',
          release.tag,
          '--notes-file',
          notes,
          ...(release.version.includes('-') ? ['--prerelease'] : []),
        ],
        root,
      );
    }
    // Only unpublished drafts are resumable. Published assets are never overwritten.
    run(
      'gh',
      ['release', 'upload', release.tag, archive, checksumFile, '--repo', repository, '--clobber'],
      root,
    );
    run('gh', ['release', 'edit', release.tag, '--repo', repository, '--draft=false'], root);
    return {
      version: release.version,
      tag: release.tag,
      commit: head,
      sha256: checksum,
      status: 'published',
      url: `https://github.com/${repository}/releases/tag/${release.tag}`,
    };
  } finally {
    if (
      path.dirname(temporary) !== os.tmpdir() ||
      !path.basename(temporary).startsWith('programmatic-video-release-')
    ) {
      throw new Error('Unexpected release temporary directory');
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'publish')
      throw new Error('Usage: node scripts/release.mjs publish');
    console.log(JSON.stringify(await publish(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
