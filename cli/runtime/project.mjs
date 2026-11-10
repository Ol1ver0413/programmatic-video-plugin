import path from 'node:path';
import { readFile, realpath, stat, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { checkProjectLinks } from './project-links.mjs';

export function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
export function run(command, args) {
  const r = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) throw new Error(`${command}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${command} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}
export function probe(file) {
  return JSON.parse(
    run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]),
  );
}
export function localFile(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    /^[a-z]+:/i.test(relative)
  )
    throw new Error(`Expected project-relative file: ${relative}`);
  const file = path.resolve(root, relative),
    rel = path.relative(root, file);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error(`File leaves project: ${relative}`);
  return file;
}
export async function outputFile(root, relative) {
  const actualRoot = await realpath(root),
    file = localFile(actualRoot, relative);
  // Check the nearest existing parent before creating directories through it.
  let parent = path.dirname(file);
  while (true) {
    try {
      const actual = await realpath(parent),
        rel = path.relative(actualRoot, actual);
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
        throw new Error('Output parent leaves project');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      parent = path.dirname(parent);
    }
  }
  await mkdir(path.dirname(file), { recursive: true });
  const actualParent = await realpath(path.dirname(file)),
    rel = path.relative(actualRoot, actualParent);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error('Output parent leaves project');
  try {
    const existing = await realpath(file),
      existingRel = path.relative(actualRoot, existing);
    if (
      existingRel === '..' ||
      existingRel.startsWith('..' + path.sep) ||
      path.isAbsolute(existingRel)
    )
      throw new Error('Output leaves project');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return file;
}
export function checkCues(cues, duration) {
  if (!Array.isArray(cues)) return ['Captions must be an array'];
  const errors = [];
  let previousEnd = 0;
  cues.forEach((cue, i) => {
    if (
      !cue ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start ||
      cue.end > duration + 1e-6
    )
      errors.push(`Caption ${i + 1}: invalid time range`);
    else {
      if (cue.start < previousEnd - 1e-6)
        errors.push(`Caption ${i + 1}: overlaps the previous caption`);
      previousEnd = cue.end;
    }
    if (typeof cue?.text !== 'string' || !cue.text.trim())
      errors.push(`Caption ${i + 1}: missing text`);
  });
  return errors;
}
export function toSrt(cues) {
  const stamp = (t) => {
    const ms = Math.round(t * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues
    .map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
    .join('\n');
}
export async function validateProject(directory, { probeAudio = true, project: candidate } = {}) {
  const root = await realpath(directory),
    project = candidate ?? parseJson(await readFile(path.join(root, 'project.json'), 'utf8'));
  const errors = [],
    warnings = [];
  errors.push(...checkProjectLinks(project));
  if (!Number.isFinite(project.duration) || project.duration <= 0)
    errors.push('duration must be positive');
  if (project.burnCaptions !== undefined && typeof project.burnCaptions !== 'boolean')
    errors.push('burnCaptions must be a boolean');
  for (const key of ['width', 'height', 'logicalWidth', 'logicalHeight', 'fps'])
    if (!Number.isInteger(project[key]) || project[key] <= 0)
      errors.push(`${key} must be a positive integer`);
  if (project.width % 2 || project.height % 2) errors.push('H.264 output dimensions must be even');
  const scale = project.width / project.logicalWidth;
  if (!Number.isFinite(scale) || scale <= 0 || scale !== project.height / project.logicalHeight)
    errors.push('Output must be a uniform scale of the logical canvas');
  else if (project.pixelArt !== false && !Number.isInteger(scale))
    errors.push('Pixel-art output must be an integer uniform scale of the logical canvas');
  if (project.pixelArt !== undefined && typeof project.pixelArt !== 'boolean')
    errors.push('pixelArt must be a boolean');
  let end = 0;
  const ids = new Set();
  if (!Array.isArray(project.scenes) || !project.scenes.length)
    errors.push('scenes must not be empty');
  else
    for (const [i, scene] of project.scenes.entries()) {
      if (
        !scene ||
        !Number.isFinite(scene.start) ||
        !Number.isFinite(scene.end) ||
        Math.abs(scene.start - end) > 1e-6 ||
        scene.end <= scene.start
      )
        errors.push(`Scene ${i + 1}: invalid or noncontiguous time range`);
      if (typeof scene?.id !== 'string' || !scene.id || ids.has(scene.id))
        errors.push(`Scene ${i + 1}: missing or duplicate id`);
      ids.add(scene?.id);
      end = scene?.end;
    }
  if (Math.abs(end - project.duration) > 1e-6)
    errors.push('Scenes must cover the full project duration');
  const hasAudio = project.audio !== null && project.audio !== undefined;
  const hasCaptions = project.captions !== null && project.captions !== undefined;
  const required = [
    ...(hasAudio ? [project.audio] : []),
    ...(hasCaptions ? [project.captions] : []),
    ...Object.values(project.assets || {}),
    ...(project.font ? [project.font] : []),
    ...(Array.isArray(project.scenes) ? project.scenes : []).flatMap((scene) =>
      scene?.source?.file
        ? [
            scene.source.file,
            ...(Array.isArray(scene.source.dependencies) ? scene.source.dependencies : []),
          ]
        : [],
    ),
    ...(Array.isArray(project.review?.requirements) ? project.review.requirements : []).flatMap(
      (check) => (check?.reference ? [check.reference] : []),
    ),
  ];
  for (const relative of required) {
    try {
      const file = await realpath(localFile(root, relative));
      const rel = path.relative(root, file);
      if (
        rel === '..' ||
        rel.startsWith('..' + path.sep) ||
        path.isAbsolute(rel) ||
        !(await stat(file)).isFile()
      )
        throw new Error('not an in-project file');
    } catch (e) {
      errors.push(`Resource ${relative}: ${e.message}`);
    }
  }
  let cues = [];
  if (hasCaptions)
    try {
      cues = parseJson(await readFile(localFile(root, project.captions), 'utf8'));
      errors.push(...checkCues(cues, project.duration));
    } catch (e) {
      errors.push(`Captions: ${e.message}`);
    }
  if (probeAudio && hasAudio && !errors.length) {
    try {
      const info = probe(localFile(root, project.audio));
      if (!info.streams.some((s) => s.codec_type === 'audio'))
        errors.push('Input has no audio stream');
      const duration = Number(info.format.duration);
      if (!Number.isFinite(duration) || duration + 0.05 < project.duration)
        errors.push('Audio is shorter than the timeline');
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { root, project, cues, errors, warnings };
}
export async function checkAndWrite(directory) {
  const result = await validateProject(directory);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  await writeFile(await outputFile(result.root, 'output/captions.srt'), toSrt(result.cues));
  await writeFile(
    await outputFile(result.root, 'output/check.json'),
    JSON.stringify(
      {
        ok: true,
        scenes: result.project.scenes.length,
        captions: result.cues.length,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  return result;
}
