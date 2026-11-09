import path from 'node:path';
import { parseJson, validateProject } from '../runtime/project.mjs';
import { checkProjectLinks, locateScenes } from '../runtime/project-links.mjs';
import { saveJson } from './files.mjs';
import { readExport } from './project-export.mjs';

export async function inspectProject(directory, values) {
  if (values.input) {
    if (values.set !== undefined || values.value !== undefined)
      throw new Error('Export snapshots are read-only; edit the current project without --input');
    const exported = await readExport(directory, values.input, values.report);
    let at = values.time;
    if (at !== undefined && exported.time_mapping) {
      const map = exported.time_mapping;
      if (
        !Number.isFinite(Number(at)) ||
        Number(at) < map.output_start_seconds ||
        Number(at) >= map.output_end_seconds
      )
        throw new Error('Time must be inside the exported clip');
      at = Number(at) - map.output_start_seconds + map.source_start_seconds;
    }
    const scenes = locateScenes(exported.snapshot.project, {
      time: at,
      scene: values.scene,
    }).filter(
      (scene) =>
        !exported.time_mapping ||
        (scene.end > exported.time_mapping.source_start_seconds &&
          scene.start < exported.time_mapping.source_end_seconds),
    );
    if (!scenes.length) throw new Error('Selected scene is outside the exported clip');
    return {
      input: values.input,
      audio: exported.snapshot.project.audio ?? null,
      captions: exported.snapshot.project.captions ?? null,
      caption_cues: (exported.snapshot.captions ?? []).filter((cue) =>
        scenes.some(
          (scene) =>
            cue.end > Math.max(scene.start, exported.time_mapping?.source_start_seconds ?? 0) &&
            cue.start < Math.min(scene.end, exported.time_mapping?.source_end_seconds ?? Infinity),
        ),
      ),
      video_sha256: exported.video_sha256,
      binding: exported.binding,
      source_matches_current: exported.source_matches_current,
      warnings: exported.warnings,
      ...(at !== undefined ? { project_time: Number(at) } : {}),
      scenes,
    };
  }
  if (values.report) throw new Error('--report requires --input');
  const checked = await validateProject(directory, { probeAudio: false });
  if (checked.errors.length) throw new Error(checked.errors.join('\n'));
  const { project, root } = checked;
  const selected = locateScenes(project, values);
  if (values.set !== undefined) {
    if (!values.scene || values.time !== undefined || values.value === undefined)
      throw new Error('Parameter edits need --scene, --set KEY and --value JSON');
    const target = project.scenes.find((scene) => scene.id === values.scene);
    if (
      ['__proto__', 'constructor', 'prototype'].includes(values.set) ||
      !Object.hasOwn(target.params ?? {}, values.set)
    )
      throw new Error('Only a declared scene.params key can be edited');
    const before = target.params[values.set],
      after = parseJson(values.value);
    if (
      before !== null &&
      (Array.isArray(before) !== Array.isArray(after) ||
        typeof before !== typeof after ||
        after === null)
    )
      throw new Error(
        'Keep the declared parameter type; edit the project description to change its contract',
      );
    target.params[values.set] = after;
    const errors = checkProjectLinks(project);
    if (errors.length) throw new Error(errors.join('\n'));
    await saveJson(path.join(root, 'project.json'), project);
    return {
      scene: values.scene,
      parameter: values.set,
      before,
      after,
      rerender_required: true,
      source: target.source ?? null,
    };
  }
  if (values.value !== undefined) throw new Error('--value requires --set');
  return {
    title: project.title,
    duration: project.duration,
    audio: project.audio ?? null,
    captions: project.captions ?? null,
    scenes: selected,
  };
}
