import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { outputFile } from '../runtime/project.mjs';
import { checkProjectLinks, locateScenes } from '../runtime/project-links.mjs';
import { selectRange } from '../runtime/sampling.mjs';
import { mapTime } from '../runtime/timing.mjs';
import { projectInputs } from '../runtime/manifest.mjs';
import { readJson, saveJson, projectFile, fileHash } from './files.mjs';
import { readExport } from './project-export.mjs';
import { reviewChecks, reviewRequirements } from './review-checks.mjs';
import { validateMedia } from './media-check.mjs';

const taskId = (task) => {
  const { task_id, ...body } = task;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
};
const relative = (root, file) => path.relative(root, file).replaceAll('\\', '/');
const qaPath = (value) => {
  const normalized =
    typeof value === 'string' ? path.posix.normalize(value.replaceAll('\\', '/')) : '';
  if (!normalized.startsWith('output/qa/'))
    throw new Error('Review tasks and results belong under output/qa/');
  return normalized;
};

async function prepare(root, values) {
  const exported = await readExport(root, values.input, values.report);
  const project = exported.snapshot.project;
  const current = await readJson(path.join(root, 'project.json'));
  const errors = checkProjectLinks(current);
  if (errors.length) throw new Error(errors.join('\n'));
  const requested = selectRange(project, values);
  const start = Math.max(requested.start, exported.time_mapping?.source_start_seconds ?? 0),
    end = Math.min(
      requested.end,
      project.duration,
      exported.time_mapping?.source_end_seconds ?? project.duration,
    );
  if (end <= start) throw new Error('Review scope does not overlap the exported video');
  const scenes = project.scenes
    .filter((scene) => scene.end > start && scene.start < end)
    .map((scene) => scene.id);
  const directory = qaPath(
    values.out ||
      `output/qa/review-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`,
  );
  const taskFile = await outputFile(root, directory + '/review-task.json');
  if ((await readdir(path.dirname(taskFile))).length)
    throw new Error('Choose an empty review output directory');
  const technical = await validateMedia(root, {
    input: values.input,
    ...(exported.binding === 'exported' ? { report: exported.export_report.file } : {}),
    out: directory + '/media-check.json',
  });
  const task = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    input: values.input,
    video_sha256: exported.video_sha256,
    binding: exported.binding,
    render_spec: exported.render_spec,
    export_report: exported.export_report,
    source_fingerprint: exported.snapshot.fingerprint,
    source_matches_current: exported.source_matches_current,
    warnings: exported.warnings,
    time_mapping: exported.time_mapping,
    scope: {
      start,
      end,
      scenes,
      input_start: exported.time_mapping ? mapTime(start, exported.time_mapping) : start,
      input_end: exported.time_mapping ? mapTime(end, exported.time_mapping) : end,
    },
    scene_map: locateScenes(project).filter((scene) => scenes.includes(scene.id)),
    requirements: reviewRequirements(current, scenes),
    reference_inputs: await Promise.all(
      [
        ...new Set(
          reviewRequirements(current, scenes)
            .map((check) => check.reference)
            .filter(Boolean),
        ),
      ].map(async (file) => ({ file, sha256: await fileHash(await projectFile(root, file)) })),
    ),
    audio: project.audio ?? null,
    captions: {
      file: project.captions ?? null,
      cues: (exported.snapshot.captions ?? []).filter((cue) => cue.end > start && cue.start < end),
    },
    checks: reviewChecks(current, scenes),
    technical: { ...technical, sha256: await fileHash(await projectFile(root, technical.report)) },
    reviewer: { role: 'video-reviewer', max_reviewers: 1, production_read_only: true },
    limitation:
      'Prepared evidence and checklist only. A host reviewer must inspect the media; this CLI does not perform model inference.',
  };
  if ((await fileHash(await projectFile(root, values.input))) !== task.video_sha256)
    throw new Error('Video changed while preparing the review; prepare again');
  task.task_id = taskId(task);
  await saveJson(taskFile, task);
  return {
    task: relative(root, taskFile),
    task_id: task.task_id,
    checks: task.checks.length,
    technical_ok: technical.ok,
    binding: task.binding,
    render_spec: task.render_spec ?? null,
    scope: task.scope,
    warnings: task.warnings,
    reviewer: task.reviewer,
  };
}

async function loadTask(root, file) {
  const task = await readJson(await projectFile(root, qaPath(file)));
  if (task.schema_version !== 1 || task.task_id !== taskId(task))
    throw new Error('Review task changed or has an unsupported format; prepare a new task');
  if ((await fileHash(await projectFile(root, task.input))) !== task.video_sha256)
    throw new Error('Review video changed; prepare a task for the new export');
  if (
    task.export_report &&
    (await fileHash(await projectFile(root, task.export_report.file))) !== task.export_report.sha256
  )
    throw new Error('Export report changed; prepare a new review task');
  if ((await fileHash(await projectFile(root, task.technical.report))) !== task.technical.sha256)
    throw new Error('Technical evidence changed; prepare a new review task');
  for (const reference of task.reference_inputs ?? [])
    if ((await fileHash(await projectFile(root, reference.file))) !== reference.sha256)
      throw new Error('Review reference changed; prepare a new task');
  const current = await readJson(path.join(root, 'project.json'));
  if (
    JSON.stringify(reviewRequirements(current, task.scope.scenes)) !==
    JSON.stringify(task.requirements)
  )
    throw new Error('User review requirements changed; prepare a new task');
  return task;
}

async function record(root, taskPath, task, input) {
  if (input.task_id !== task.task_id || input.video_sha256 !== task.video_sha256)
    throw new Error('Review result must identify its task and exact video hash');
  if (!Array.isArray(input.checks)) throw new Error('Review result needs a checks array');
  const seen = new Set();
  for (const check of input.checks) {
    if (!task.checks.some((item) => item.id === check.id) || seen.has(check.id))
      throw new Error('Review result contains an unknown or duplicate check');
    seen.add(check.id);
    if (
      !['pass', 'issue', 'not_applicable', 'unverified'].includes(check.status) ||
      typeof check.note !== 'string' ||
      !check.note.trim()
    )
      throw new Error('Each check needs a status and an explanatory note');
    if (
      check.status === 'not_applicable' &&
      (check.id.startsWith('user:') ||
        ['common:media', 'common:content', 'common:composition'].includes(check.id))
    )
      throw new Error(
        'Required checks cannot be skipped; use unverified when evidence is insufficient',
      );
    if (
      !Array.isArray(check.evidence) ||
      (['pass', 'issue'].includes(check.status) && !check.evidence.length)
    )
      throw new Error('Passing checks and issues need existing evidence files');
    for (const file of check.evidence) await projectFile(root, file);
    if (check.id === 'common:media' && check.status === 'pass' && !task.technical.ok)
      throw new Error('A failed technical check cannot be marked passed');
    if (check.status === 'issue') {
      if (typeof check.suggestion !== 'string' || !check.suggestion.trim())
        throw new Error('Each issue needs a suggested correction');
      if (check.scene !== undefined && !task.scope.scenes.includes(check.scene))
        throw new Error('Issue scene is outside the reviewed scope');
      if (
        check.time !== undefined &&
        (!Number.isFinite(check.time) ||
          check.time < task.scope.start ||
          check.time >= task.scope.end)
      )
        throw new Error('Issue time must be in project seconds inside the reviewed scope');
      if (check.time === undefined && !check.scene && check.scope !== 'artifact')
        throw new Error('Locate an issue by project time, scene, or artifact scope');
      if (
        check.scene &&
        check.time !== undefined &&
        !task.scene_map.some(
          (scene) =>
            scene.id === check.scene && check.time >= scene.start && check.time < scene.end,
        )
      )
        throw new Error('Issue time does not belong to its scene');
    }
  }
  const missing = task.checks.filter((check) => !seen.has(check.id)).map((check) => check.id);
  const status =
    input.checks.some((check) => check.status === 'issue') || !task.technical.ok
      ? 'needs_changes'
      : missing.length ||
          task.binding !== 'exported' ||
          input.checks.some((check) => check.status === 'unverified')
        ? 'incomplete'
        : 'reviewed';
  const resultFile = await outputFile(
    root,
    relative(
      root,
      path.join(path.dirname(await projectFile(root, taskPath)), 'review-result.json'),
    ),
  );
  let previous;
  try {
    previous = await readJson(resultFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous && previous.task_id !== task.task_id)
    throw new Error('Existing review result belongs to another task');
  const result = {
    schema_version: 1,
    task_id: task.task_id,
    video_sha256: task.video_sha256,
    updated_at: new Date().toISOString(),
    status,
    checks: input.checks,
    missing,
    revisions: previous
      ? [
          ...(previous.revisions ?? []),
          { updated_at: previous.updated_at, status: previous.status, checks: previous.checks },
        ]
      : [],
    limitation: 'Reviewer findings concern the recorded scope and evidence, not user acceptance.',
  };
  await saveJson(resultFile, result);
  return {
    status,
    result: relative(root, resultFile),
    missing,
    issues: input.checks.filter((check) => check.status === 'issue'),
  };
}

export async function reviewVideo(directory, values) {
  const root = await realpath(directory);
  if (!values.task) {
    if (!values.input || values.result)
      throw new Error('Prepare with --input, or use --task [--result]');
    return prepare(root, values);
  }
  if (
    ['input', 'out', 'scene', 'start', 'duration', 'report'].some(
      (name) => values[name] !== undefined,
    )
  )
    throw new Error('Task status/result cannot be combined with prepare options');
  const task = await loadTask(root, values.task);
  if (values.result)
    return record(
      root,
      values.task,
      task,
      await readJson(await projectFile(root, qaPath(values.result))),
    );
  const resultPath = path.join(
    path.dirname(await projectFile(root, values.task)),
    'review-result.json',
  );
  let result;
  try {
    result = await readJson(await projectFile(root, relative(root, resultPath)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let sourceMatches = false;
  try {
    const current = await readJson(path.join(root, 'project.json'));
    sourceMatches =
      task.binding === 'exported' &&
      (await projectInputs(root, current)).fingerprint === task.source_fingerprint;
  } catch {
    /* The reviewed artifact remains readable when current source has drifted. */
  }
  return {
    status: result?.status ?? 'pending',
    task_id: task.task_id,
    input: task.input,
    source_matches_current: sourceMatches,
    render_spec: task.render_spec ?? null,
    scope: task.scope,
    scene_map: task.scene_map,
    checks: task.checks,
    technical: task.technical,
    binding: task.binding,
    warnings: task.warnings,
    issues: result?.checks.filter((check) => check.status === 'issue') ?? [],
  };
}
