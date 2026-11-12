// Pure geometry plus Canvas drawing; shared by the CLI and standalone projects.
export function point(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite))
    throw new Error('A source point must contain two finite coordinates');
  return value;
}

export function regionBounds(frame, fallback, width, height) {
  let region = frame.region ?? fallback;
  if (frame.polygon !== undefined) {
    if (!Array.isArray(frame.polygon) || frame.polygon.length < 3)
      throw new Error('A crop polygon needs at least three source points');
    frame.polygon.forEach(point);
    const xs = frame.polygon.map((p) => p[0]),
      ys = frame.polygon.map((p) => p[1]);
    region ??= [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ];
  }
  if (
    !Array.isArray(region) ||
    region.length !== 4 ||
    !region.every(Number.isFinite) ||
    region[0] < 0 ||
    region[1] < 0 ||
    region[2] <= 0 ||
    region[3] <= 0 ||
    region[0] + region[2] > width ||
    region[1] + region[3] > height
  )
    throw new Error('Crop region must be a positive rectangle inside the source image');
  if (
    frame.polygon?.some(
      ([x, y]) =>
        x < region[0] || y < region[1] || x > region[0] + region[2] || y > region[1] + region[3],
    )
  )
    throw new Error('Crop polygon must stay inside its region');
  return region;
}

export function insidePolygon(x, y, polygon) {
  if (!polygon) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

export function createAtlas(image, metadata) {
  if (
    metadata.schema_version !== 1 ||
    metadata.width !== image.width ||
    metadata.height !== image.height
  )
    throw new Error('Atlas metadata version or source dimensions do not match');
  if (
    !Number.isFinite(metadata.reference_height) ||
    metadata.reference_height <= 0 ||
    !Array.isArray(metadata.frames) ||
    !metadata.frames.length
  )
    throw new Error('Atlas needs frames and a positive shared reference_height');
  for (const frame of metadata.frames) {
    regionBounds(frame, frame.cell, image.width, image.height);
    if (!frame.empty) point(frame.anchor);
    Object.values(frame.anchors ?? {}).forEach(point);
  }
  return { image, metadata };
}

export function drawSprite(
  ctx,
  atlas,
  index,
  { x, y, height, flip = false, rotation = 0, alpha = 1, anchor } = {},
) {
  const { image, metadata } = atlas;
  if (!Number.isInteger(index) || !metadata.frames[index])
    throw new Error(`Unknown atlas frame ${index}`);
  if (
    ![x, y, height, rotation, alpha].every(Number.isFinite) ||
    height <= 0 ||
    alpha < 0 ||
    alpha > 1
  )
    throw new Error('Sprite needs a finite position, positive height and alpha from zero to one');
  const frame = metadata.frames[index];
  if (frame.empty) return null;
  const origin = point(anchor ?? frame.anchor),
    scale = height / metadata.reference_height;
  const projectPoint = (value) => {
    const source = point(typeof value === 'string' ? frame.anchors?.[value] : value);
    const dx = (source[0] - origin[0]) * scale * (flip ? -1 : 1),
      dy = (source[1] - origin[1]) * scale;
    return {
      x: x + Math.cos(rotation) * dx - Math.sin(rotation) * dy,
      y: y + Math.sin(rotation) * dx + Math.cos(rotation) * dy,
    };
  };
  const [sx, sy, sw, sh] = regionBounds(frame, frame.cell, image.width, image.height);
  ctx.save();
  try {
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(flip ? -scale : scale, scale);
    ctx.globalAlpha *= alpha;
    if (frame.polygon) {
      ctx.beginPath();
      frame.polygon.forEach(([px, py], i) =>
        i ? ctx.lineTo(px - origin[0], py - origin[1]) : ctx.moveTo(px - origin[0], py - origin[1]),
      );
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(image, sx, sy, sw, sh, sx - origin[0], sy - origin[1], sw, sh);
  } finally {
    ctx.restore();
  }
  return { point: projectPoint, scale, x, y, rotation };
}

export function frameAt(time, keys) {
  if (!Number.isFinite(time) || !Array.isArray(keys) || !keys.length)
    throw new Error('Pose keys need a finite time and a nonempty list');
  for (let i = 0; i < keys.length; i++) {
    if (
      !Array.isArray(keys[i]) ||
      keys[i].length !== 2 ||
      !Number.isFinite(keys[i][0]) ||
      !Number.isInteger(keys[i][1]) ||
      keys[i][1] < 0 ||
      (i && keys[i][0] <= keys[i - 1][0])
    )
      throw new Error('Pose keys must have increasing times and nonnegative frame indices');
  }
  return keys.reduce((frame, [at, value]) => (time >= at ? value : frame), keys[0][1]);
}

// Use project time for performances that continue across camera cuts.
export function stateAt(time, keys) {
  if (
    !Number.isFinite(time) ||
    !Array.isArray(keys) ||
    !keys.length ||
    keys.some(
      (key, index) =>
        !Array.isArray(key) ||
        key.length !== 2 ||
        !Number.isFinite(key[0]) ||
        (typeof key[1] !== 'string' && !Number.isFinite(key[1])) ||
        key[1] === '' ||
        (index && key[0] <= keys[index - 1][0]),
    )
  )
    throw new Error('State keys need increasing finite times and named or numeric values');
  return keys.reduce((value, [at, next]) => (time >= at ? next : value), keys[0][1]);
}

export function createPoseLibrary(images, description, metadata = {}) {
  if (
    !description?.poses ||
    typeof description.poses !== 'object' ||
    Array.isArray(description.poses)
  )
    throw new Error('A pose library needs named poses');
  const poses = new Map();
  for (const [name, pose] of Object.entries(description.poses)) {
    const image = images?.[pose?.asset];
    if (!image) throw new Error(`Pose ${name} refers to an unavailable image`);
    const details = pose.atlas
      ? metadata instanceof Map
        ? metadata.get(pose.atlas)
        : metadata[pose.atlas]
      : {
          schema_version: 1,
          width: image.width,
          height: image.height,
          reference_height: pose.reference_height ?? description.reference_height,
          frames: [
            { region: pose.region, anchor: pose.anchor, anchors: pose.anchors ?? {}, empty: false },
          ],
        };
    if (!details) throw new Error(`Pose ${name} needs its declared atlas metadata`);
    const atlas = createAtlas(image, details),
      frame = pose.frame ?? 0;
    if (!Number.isInteger(frame) || !atlas.metadata.frames[frame])
      throw new Error(`Pose ${name} refers to an unknown frame`);
    poses.set(name, { atlas, frame });
  }
  return poses;
}

export function drawPose(ctx, library, name, options) {
  const pose = library.get(name);
  if (!pose) throw new Error(`Unknown pose: ${name}`);
  return drawSprite(ctx, pose.atlas, pose.frame, options);
}

export function valueAt(time, keys, easing = (t) => t) {
  if (
    !Number.isFinite(time) ||
    !Array.isArray(keys) ||
    !keys.length ||
    keys.some(
      (key, i) =>
        !Array.isArray(key) ||
        key.length !== 2 ||
        !key.every(Number.isFinite) ||
        (i && key[0] <= keys[i - 1][0]),
    )
  )
    throw new Error('Value keys need increasing finite times and values');
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (time <= keys[i][0]) {
      const [a, b] = [keys[i - 1], keys[i]];
      return a[1] + (b[1] - a[1]) * easing((time - a[0]) / (b[0] - a[0]));
    }
  }
  return keys.at(-1)[1];
}
