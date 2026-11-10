#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export function parseVersion(value) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (!match || match[0] !== value || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error(`Invalid release version: ${value}. Use X.Y.Z or X.Y.Z-beta.N.`);
  }
  return { numbers: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? [] };
}

export function compareVersions(left, right) {
  const a = parseVersion(left),
    b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function run(command, args, root = repoRoot, { optional = false, env } = {}) {
  if (command === 'git')
    args = ['-c', `safe.directory=${path.resolve(root).replaceAll('\\', '/')}`, ...args];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !optional) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

export const git = (root, ...args) => run('git', args, root).stdout.trim();

async function versionFiles(root) {
  const { files } = await readJson(path.join(root, '.version-bump.json'));
  const documents = new Map();
  for (const item of files) {
    if (
      !item.path ||
      path.isAbsolute(item.path) ||
      item.path.split(/[\\/]/).includes('..') ||
      !Array.isArray(item.field) ||
      !item.field.length ||
      item.field.some(
        (key) => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key),
      )
    ) {
      throw new Error('Invalid version manifest entry');
    }
    if (!documents.has(item.path))
      documents.set(item.path, await readJson(path.join(root, item.path)));
    let parent = documents.get(item.path);
    for (const key of item.field.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, key))
        throw new Error(`Missing version field: ${item.path}`);
      parent = parent[key];
    }
    const key = item.field.at(-1);
    if (!parent || !Object.hasOwn(parent, key) || typeof parent[key] !== 'string') {
      throw new Error(`Missing version field: ${item.path}`);
    }
    parseVersion(parent[key]);
    item.parent = parent;
    item.key = key;
  }
  return { files, documents };
}

export async function setVersion(root, value) {
  parseVersion(value);
  const { files, documents } = await versionFiles(root);
  for (const item of files) item.parent[item.key] = value;
  for (const [name, data] of documents) {
    await writeFile(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
  }
  return { version: value, files: [...documents.keys()] };
}

export function releaseNotes(text, version) {
  const headings = [...text.matchAll(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}\s*$/gm)];
  const found = headings.filter((heading) => heading[1] === version);
  if (found.length !== 1)
    throw new Error(`CHANGELOG.md needs exactly one dated [${version}] section`);
  const start = found[0],
    end = headings.find((heading) => heading.index > start.index);
  const notes = text.slice(start.index + start[0].length, end?.index).trim();
  if (!notes || /\b(?:TBD|TODO)\b/.test(notes))
    throw new Error(`Write release notes for ${version}`);
  return notes;
}

export function isPluginChange(file) {
  return (
    /^(?:bin|cli|skills|hooks|agents|templates)\//.test(file) ||
    /^\.[^/]+-plugin\//.test(file) ||
    [
      'package.json',
      'package-lock.json',
      'plugin.json',
      '.agents/plugins/marketplace.json',
      'scripts/programmatic-video.mjs',
      'scripts/pixel-video.mjs',
    ].includes(file)
  );
}

export async function checkVersion(root, { base } = {}) {
  const canonical = await readJson(path.join(root, 'package.json'));
  const { files } = await versionFiles(root);
  const mismatches = files.filter((item) => item.parent[item.key] !== canonical.version);
  if (mismatches.length)
    throw new Error(`Version drift: ${mismatches.map((item) => item.path).join(', ')}`);
  const notes = releaseNotes(
    await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'),
    canonical.version,
  );
  let previous;
  if (base) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base)) throw new Error('Invalid base ref');
    const resolved = git(root, 'rev-parse', '--verify', `${base}^{commit}`);
    previous = JSON.parse(git(root, 'show', `${resolved}:package.json`)).version;
    const changed = git(root, 'diff', '--name-only', resolved).split('\n').filter(Boolean);
    const comparison = compareVersions(canonical.version, previous);
    const initialTag = run('git', ['rev-parse', '--verify', 'v0.1.0^{commit}'], root, {
      optional: true,
    });
    const resumingInitialRelease =
      initialTag.status === 0 &&
      initialTag.stdout.trim() === git(root, 'rev-parse', 'HEAD') &&
      JSON.parse(git(root, 'show', 'v0.1.0:package.json')).version === '0.1.0';
    const firstPublicRelease =
      canonical.version === '0.1.0' &&
      (!git(root, 'tag', '--list', 'v*') || resumingInitialRelease) &&
      run('git', ['cat-file', '-e', `${resolved}:CHANGELOG.md`], root, { optional: true })
        .status !== 0;
    if (comparison < 0 && !firstPublicRelease)
      throw new Error(`Version must increase from ${previous}`);
    if (!comparison && changed.some(isPluginChange)) {
      throw new Error('Plugin changes need a new version before merging to main');
    }
  }
  return { version: canonical.version, tag: `v${canonical.version}`, previous, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, value, ...extra] = process.argv.slice(2);
    let result;
    if (command === 'set' && value && !extra.length) result = await setVersion(repoRoot, value);
    else if (command === 'check' && (!value || (value === '--base' && extra.length === 1))) {
      result = await checkVersion(repoRoot, { base: extra[0] });
    } else throw new Error('Usage: node scripts/version.mjs set VERSION | check [--base REF]');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
