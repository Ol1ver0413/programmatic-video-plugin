const clamp = (x) => Math.max(0, Math.min(1, x));
const finite = (value, name) => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
};

export function sceneClock(scene, time) {
  const duration = finite(scene.end - scene.start, 'Scene duration');
  if (duration <= 0) throw new Error('Scene duration must be positive');
  const local = finite(time, 'Time') - finite(scene.start, 'Scene start');
  return { local, duration, progress: clamp(local / duration) };
}

export function eventAge(scene, name, time) {
  const clock = sceneClock(scene, time),
    at = scene.events?.[name];
  if (!Number.isFinite(at) || at < 0 || at > clock.duration)
    throw new Error(`Scene event ${name} must be a local time inside the scene`);
  return clock.local - at;
}

export function actionAt(time, { prepare = 0, contact, release = contact, end }) {
  for (const [key, value] of Object.entries({ time, prepare, contact, release, end }))
    finite(value, key);
  if (!(prepare < contact && contact <= release && release < end))
    throw new Error('Action needs prepare < contact <= release < end');
  const phase =
    time < prepare
      ? 'before'
      : time < contact
        ? 'prepare'
        : time < release
          ? 'contact'
          : time < end
            ? 'recover'
            : 'after';
  const range =
    phase === 'prepare'
      ? [prepare, contact]
      : phase === 'contact'
        ? [contact, release]
        : [release, end];
  return {
    phase,
    progress:
      phase === 'before'
        ? 0
        : phase === 'after'
          ? 1
          : clamp((time - range[0]) / (range[1] - range[0])),
    hit: time >= contact,
    complete: time >= end,
  };
}

export function cameraAt(time, track = {}, { width, height }) {
  if (!(width > 0 && height > 0)) throw new Error('Camera viewport must be positive');
  finite(time, 'Camera time');
  const normalize = (value) => {
    const out = {
      x: value.x ?? width / 2,
      y: value.y ?? height / 2,
      zoom: value.zoom ?? 1,
      rotation: value.rotation ?? 0,
    };
    for (const [key, number] of Object.entries(out)) finite(number, `Camera ${key}`);
    if (out.zoom <= 0) throw new Error('Camera zoom must be positive');
    return out;
  };
  if (!Array.isArray(track)) return normalize(track);
  if (!track.length) return normalize({});
  for (let i = 0; i < track.length; i++)
    if (!Number.isFinite(track[i].time) || (i && track[i].time <= track[i - 1].time))
      throw new Error('Camera keyframes need strictly increasing local times');
  const leftIndex = Math.max(
    0,
    track.findLastIndex((key) => key.time <= time),
  );
  const left = track[leftIndex],
    right = track[Math.min(leftIndex + 1, track.length - 1)];
  let amount = left === right ? 0 : clamp((time - left.time) / (right.time - left.time));
  if (right.ease !== 'linear') amount = amount * amount * (3 - 2 * amount);
  const a = normalize(left),
    b = normalize(right);
  return Object.fromEntries(
    Object.keys(a).map((key) => [key, a[key] + (b[key] - a[key]) * amount]),
  );
}

export function cameraMatrix(camera, { width, height, depth = 1 }) {
  if (!Number.isFinite(depth) || depth < 0) throw new Error('Layer depth must be nonnegative');
  const normalized = cameraAt(0, camera, { width, height });
  const scale = 1 + (normalized.zoom - 1) * depth;
  if (scale <= 0) throw new Error('Layer scale must be positive');
  const rotation = -normalized.rotation * depth;
  const a = Math.cos(rotation) * scale,
    b = Math.sin(rotation) * scale;
  const c = -b,
    d = a;
  const x = width / 2 + (normalized.x - width / 2) * depth;
  const y = height / 2 + (normalized.y - height / 2) * depth;
  return [a, b, c, d, width / 2 - a * x - c * y, height / 2 - b * x - d * y];
}

export function cameraPoint(point, camera, viewport, { inverse = false } = {}) {
  const [a, b, c, d, e, f] = cameraMatrix(camera, viewport);
  const x = finite(point.x, 'Point x'),
    y = finite(point.y, 'Point y');
  if (!inverse) return { x: a * x + c * y + e, y: b * x + d * y + f };
  const determinant = a * d - b * c;
  return {
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (-b * (x - e) + a * (y - f)) / determinant,
  };
}

export function withCamera(ctx, camera, viewport, draw) {
  const matrix = cameraMatrix(camera, viewport);
  ctx.save();
  try {
    ctx.transform(...matrix);
    return draw();
  } finally {
    ctx.restore();
  }
}
