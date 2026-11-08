export function selectRange(project, { scene, start, duration } = {}) {
  if (scene !== undefined && (start !== undefined || duration !== undefined))
    throw new Error('Choose --scene or --start/--duration, not both');
  let from = 0,
    to = project.duration;
  if (scene !== undefined) {
    const selected = project.scenes.find((item) => item.id === scene);
    if (!selected) throw new Error(`Unknown scene: ${scene}`);
    from = selected.start;
    to = selected.end;
  } else {
    if (start !== undefined) from = Number(start);
    if (duration !== undefined) to = from + Number(duration);
  }
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to > project.duration + 1e-7
  )
    throw new Error('Requested range must be inside the project timeline');
  const firstFrame = Math.ceil(from * project.fps - 1e-7),
    endFrame = Math.ceil(to * project.fps - 1e-7);
  if (endFrame <= firstFrame) throw new Error('Requested range contains no output frames');
  return {
    requestedStart: from,
    requestedEnd: to,
    start: firstFrame / project.fps,
    end: endFrame / project.fps,
    firstFrame,
    endFrame,
    frames: endFrame - firstFrame,
    duration: (endFrame - firstFrame) / project.fps,
    partial: scene !== undefined || start !== undefined || duration !== undefined,
  };
}

export function selectTimes(project, { scene, times, samples } = {}) {
  if (times !== undefined) {
    if (scene !== undefined || samples !== undefined)
      throw new Error('--times cannot be combined with --scene or --samples');
    const parts = String(times).split(',');
    if (parts.some((part) => !part.trim()))
      throw new Error('--times must be a comma-separated list of seconds');
    const values = parts.map(Number);
    if (
      !values.length ||
      values.length > 256 ||
      values.some((value) => !Number.isFinite(value) || value < 0 || value >= project.duration)
    )
      throw new Error('Sample times must be inside the timeline (maximum 256 samples)');
    return [...new Set(values)].sort((a, b) => a - b);
  }
  const count = Number(samples ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 32)
    throw new Error('--samples must be an integer from 1 to 32 per scene');
  const scenes =
    scene === undefined ? project.scenes : project.scenes.filter((item) => item.id === scene);
  if (!scenes.length) throw new Error(`Unknown scene: ${scene}`);
  return scenes.flatMap((item) =>
    Array.from(
      { length: count },
      (_, i) => item.start + ((item.end - item.start) * (i + 0.5)) / count,
    ),
  );
}
