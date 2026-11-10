const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const jsonValue = (value) =>
  value === null ||
  ['string', 'boolean'].includes(typeof value) ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every(jsonValue)) ||
  (object(value) && Object.values(value).every(jsonValue));

export function checkProjectLinks(project) {
  const errors = [],
    scenes = Array.isArray(project.scenes) ? project.scenes : [];
  const ids = new Set(scenes.map((scene) => scene?.id));
  for (const scene of scenes) {
    if (!scene) continue;
    if (
      scene.source !== undefined &&
      (!object(scene.source) ||
        !text(scene.source.file) ||
        (scene.source.symbol !== undefined && !text(scene.source.symbol)))
    )
      errors.push(`Scene ${scene.id}: source needs a file and optional symbol`);
    if (
      scene.source?.dependencies !== undefined &&
      (!Array.isArray(scene.source.dependencies) ||
        scene.source.dependencies.some((file) => !text(file)))
    )
      errors.push(`Scene ${scene.id}: source dependencies must be file paths`);
    if (
      scene.assets !== undefined &&
      (!Array.isArray(scene.assets) ||
        scene.assets.some((key) => !text(key) || !Object.hasOwn(project.assets ?? {}, key)))
    )
      errors.push(`Scene ${scene.id}: assets must name registered project assets`);
    if (scene.params !== undefined && (!object(scene.params) || !jsonValue(scene.params)))
      errors.push(`Scene ${scene.id}: params must contain finite JSON values`);
    if (
      scene.events !== undefined &&
      (!object(scene.events) ||
        Object.values(scene.events).some(
          (at) => !Number.isFinite(at) || at < 0 || at > scene.end - scene.start,
        ))
    )
      errors.push(`Scene ${scene.id}: events must use local seconds inside the scene`);
  }
  if (project.rendering?.sceneCache !== undefined && project.rendering.sceneCache !== 'isolated')
    errors.push('rendering.sceneCache must be isolated when specified');
  if (project.review !== undefined && !object(project.review))
    errors.push('review must be an object');
  const requirements = project.review?.requirements;
  if (requirements !== undefined) {
    if (!Array.isArray(requirements)) errors.push('review.requirements must be an array');
    else {
      const seen = new Set();
      for (const item of requirements) {
        if (!object(item) || !text(item.id) || seen.has(item.id) || !text(item.text))
          errors.push('Each review requirement needs a unique id and nonempty text');
        if (
          item?.scenes !== undefined &&
          (!Array.isArray(item.scenes) || item.scenes.some((id) => !ids.has(id)))
        )
          errors.push(`Review requirement ${item?.id}: unknown scene`);
        for (const name of ['source', 'reference'])
          if (item?.[name] !== undefined && !text(item[name]))
            errors.push(`Review requirement ${item?.id}: ${name} must be nonempty text`);
        seen.add(item?.id);
      }
    }
  }
  return errors;
}

export function locateScenes(project, { time, scene } = {}) {
  if (time !== undefined && scene !== undefined) throw new Error('Choose --time or --scene');
  if (
    time !== undefined &&
    (!Number.isFinite(Number(time)) || Number(time) < 0 || Number(time) >= project.duration)
  )
    throw new Error('Time must be inside the project timeline');
  const selected = project.scenes.filter((item) =>
    scene !== undefined
      ? item.id === scene
      : time !== undefined
        ? Number(time) >= item.start && Number(time) < item.end
        : true,
  );
  if (!selected.length) throw new Error(`Unknown scene: ${scene}`);
  return selected.map((item) => ({
    ...item,
    source: item.source ?? null,
    params: item.params ?? {},
    assets: (item.assets ?? []).map((key) => ({ id: key, file: project.assets[key] })),
    requirements: (project.review?.requirements ?? []).filter(
      (check) => !check.scenes?.length || check.scenes.includes(item.id),
    ),
  }));
}
