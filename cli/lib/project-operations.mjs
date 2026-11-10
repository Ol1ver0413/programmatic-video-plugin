import path from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateProject, parseJson } from '../runtime/project.mjs';
import { readJson, saveJson, projectFile } from './files.mjs';

const record = (v) => v && typeof v === 'object' && !Array.isArray(v);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function safe(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error(`Unsupported property: ${key}`);
    safe(item);
  }
}
function merge(base, patch) {
  if (!record(patch)) return structuredClone(patch);
  const out = record(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) out[key] = merge(out[key], value);
  return out;
}
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex');

// Scene updates use stable IDs; arrays inside a scene are replaced, objects are merged.
export function patchProject(project, patch) {
  if (!record(patch)) throw new Error('Project patch must be an object');
  safe(patch);
  for (const key of Object.keys(patch))
    if (!['set', 'assets', 'scenes', 'removeScenes', 'removeAssets'].includes(key))
      throw new Error(`Unknown patch operation: ${key}`);
  if (patch.set !== undefined && !record(patch.set)) throw new Error('set must be an object');
  if (patch.set && ['scenes', 'assets'].some((key) => Object.hasOwn(patch.set, key)))
    throw new Error('Use scenes/assets operations instead of set.scenes or set.assets');
  if (patch.assets !== undefined && !record(patch.assets))
    throw new Error('assets must be an object');
  const next = merge(project, patch.set ?? {});
  next.assets = merge(next.assets ?? {}, patch.assets ?? {});
  for (const [key, list] of [
    ['removeScenes', patch.removeScenes],
    ['removeAssets', patch.removeAssets],
  ])
    if (list !== undefined && (!Array.isArray(list) || list.some((id) => typeof id !== 'string')))
      throw new Error(`${key} must be an array of IDs`);
  for (const id of patch.removeAssets ?? []) {
    if (!Object.hasOwn(next.assets, id)) throw new Error(`Unknown asset: ${id}`);
    delete next.assets[id];
  }
  for (const id of patch.removeScenes ?? [])
    if (!next.scenes.some((scene) => scene.id === id)) throw new Error(`Unknown scene: ${id}`);
  next.scenes = next.scenes.filter((scene) => !(patch.removeScenes ?? []).includes(scene.id));
  if (patch.scenes !== undefined && !Array.isArray(patch.scenes))
    throw new Error('scenes must be an array');
  const seen = new Set();
  for (const update of patch.scenes ?? []) {
    if (!record(update) || typeof update.id !== 'string' || !update.id || seen.has(update.id))
      throw new Error('Each scene update needs a unique id');
    seen.add(update.id);
    const index = next.scenes.findIndex((scene) => scene.id === update.id);
    if (index < 0) next.scenes.push(structuredClone(update));
    else next.scenes[index] = merge(next.scenes[index], update);
  }
  next.scenes.sort((a, b) => a.start - b.start);
  return next;
}

export function projectChanges(before, after) {
  const changedScenes = after.scenes
    .filter((scene) => {
      const old = before.scenes.find((item) => item.id === scene.id);
      return !old || digest(old) !== digest(scene);
    })
    .map((scene) => scene.id);
  const removed = before.scenes
    .filter((scene) => !after.scenes.some((s) => s.id === scene.id))
    .map((scene) => scene.id);
  const neighbors = new Set();
  for (const project of [before, after])
    project.scenes.forEach((scene, index) => {
      if ([...changedScenes, ...removed].includes(scene.id))
        for (const item of project.scenes.slice(Math.max(0, index - 1), index + 2))
          neighbors.add(item.id);
    });
  const globals = Object.keys({ ...before, ...after }).filter(
    (key) => key !== 'scenes' && digest(before[key]) !== digest(after[key]),
  );
  return {
    changed_scenes: changedScenes,
    removed_scenes: removed,
    neighboring_scenes: [...neighbors],
    changed_fields: globals,
    global_review_required: globals.length > 0,
  };
}

export async function applyProjectPatch(directory, patch, { dryRun = false } = {}) {
  const root = await realpath(directory),
    file = await projectFile(root, 'project.json');
  const original = await readFile(file, 'utf8'),
    before = parseJson(original);
  const next = patchProject(before, patch);
  const checked = await validateProject(root, {
    project: next,
    probeAudio: before.audio !== next.audio || before.duration !== next.duration,
  });
  if (checked.errors.length) throw new Error(checked.errors.join('\n'));
  if ((await readFile(file, 'utf8')) !== original)
    throw new Error('Project changed during editing; retry from current state');
  const changes = projectChanges(before, next);
  if (!dryRun) await saveJson(file, next);
  return {
    applied: !dryRun,
    ...changes,
    rerender_required: !dryRun,
    limitation:
      'Updates the active description only. Scene code must consume local time/parameters; inspect changed actions and neighboring cuts.',
  };
}

export async function readPatch(root, input) {
  if (input === '-') {
    let text = '';
    let bytes = 0;
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      text += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2_000_000) throw new Error('Patch input exceeds 2 MB');
    }
    return parseJson(text);
  }
  return readJson(await projectFile(root, input));
}

export async function projectFiles(directory) {
  const root = await realpath(directory),
    project = await readJson(await projectFile(root, 'project.json'));
  const groups = {};
  async function visit(dir = '') {
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(relative);
      else {
        const group = relative.startsWith('.programmatic-video/')
          ? 'cache'
          : relative.split('/').length === 1
            ? 'root'
            : relative.split('/')[0];
        const size = (await stat(path.join(root, relative))).size;
        groups[group] ??= { files: 0, bytes: 0 };
        groups[group].files++;
        groups[group].bytes += size;
      }
    }
  }
  await visit();
  return {
    active: {
      manifest: 'project.json',
      audio: project.audio ?? null,
      captions: project.captions ?? null,
      assets: project.assets ?? {},
      sources: [...new Set(project.scenes.map((s) => s.source?.file).filter(Boolean))],
    },
    groups,
    limitation:
      'Inventory only; no files are deleted or classified as unused from incomplete references.',
  };
}
