import path from 'node:path';
import { realpath, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { outputFile, probe } from '../runtime/project.mjs';
import { newFile } from './media.mjs';
import { projectFile, readJson, fileHash } from './files.mjs';
import { regionBounds, insidePolygon, point } from '../runtime/sprites.mjs';
import { packAtlasPixels, encodeAtlasPng } from './atlas-pack.mjs';
import { applyProjectPatch } from './project-operations.mjs';

export async function atlasRequestKey(root, values) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        input: values.input,
        source: await fileHash(await projectFile(root, values.input)),
        layout: values.layout ? await fileHash(await projectFile(root, values.layout)) : null,
        columns: values.columns ?? null,
        rows: values.rows ?? null,
        threshold: values['alpha-threshold'] ?? 180,
        pack: values.pack ?? null,
        padding: values.padding ?? 2,
      }),
    )
    .digest('hex');
}

export function inspectPixels(pixels, width, height, columns, rows, threshold = 180, layout = {}) {
  for (const [name, value] of Object.entries({ columns, rows }))
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
  if (columns > width || rows > height) throw new Error('Grid cells must have positive dimensions');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 254)
    throw new Error('alpha-threshold must be an integer from 0 to 254');
  if (pixels.length !== width * height * 4) throw new Error('Incomplete RGBA image');
  if (layout.frames && (!Array.isArray(layout.frames) || layout.frames.length !== columns * rows))
    throw new Error('Layout frames must match the grid count');
  let clear = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) clear++;
  const frames = [];
  for (let i = 0; i < columns * rows; i++) {
    const x = Math.floor(((i % columns) * width) / columns);
    const y = Math.floor((Math.floor(i / columns) * height) / rows);
    const right = Math.floor((((i % columns) + 1) * width) / columns);
    const bottom = Math.floor(((Math.floor(i / columns) + 1) * height) / rows);
    const supplied = layout.frames?.[i] ?? {};
    const region = regionBounds(
      supplied,
      supplied.polygon && !supplied.region ? undefined : [x, y, right - x, bottom - y],
      width,
      height,
    );
    const [rx, ry, rw, rh] = region;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    const boundary = { left: 0, right: 0, top: 0, bottom: 0 };
    for (let yy = Math.floor(ry); yy < Math.ceil(ry + rh); yy++)
      for (let xx = Math.floor(rx); xx < Math.ceil(rx + rw); xx++) {
        if (
          xx + 0.5 < rx ||
          xx + 0.5 >= rx + rw ||
          yy + 0.5 < ry ||
          yy + 0.5 >= ry + rh ||
          !insidePolygon(xx + 0.5, yy + 0.5, supplied.polygon)
        )
          continue;
        if (pixels[(yy * width + xx) * 4 + 3] <= threshold) continue;
        x0 = Math.min(x0, xx);
        y0 = Math.min(y0, yy);
        x1 = Math.max(x1, xx);
        y1 = Math.max(y1, yy);
        if (xx === Math.floor(rx)) boundary.left++;
        if (xx === Math.ceil(rx + rw) - 1) boundary.right++;
        if (yy === Math.floor(ry)) boundary.top++;
        if (yy === Math.ceil(ry + rh) - 1) boundary.bottom++;
      }
    const empty = x1 < 0;
    frames.push({
      cell: [x, y, right - x, bottom - y],
      region,
      ...(supplied.polygon ? { polygon: supplied.polygon } : {}),
      empty,
      box: empty ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
      anchor: supplied.anchor ? point(supplied.anchor) : empty ? null : [(x0 + x1) / 2, y1],
      anchors: Object.fromEntries(
        Object.entries(supplied.anchors ?? {}).map(([name, value]) => [name, point(value)]),
      ),
      anchor_origin: supplied.anchor ? 'explicit' : 'candidate',
      region_origin: supplied.region || supplied.polygon ? 'explicit' : 'grid',
      boundary_occupancy: boundary,
    });
  }
  const referenceHeight = layout.reference_height ?? frames.find((f) => !f.empty)?.box[3] ?? null;
  if (referenceHeight !== null && (!Number.isFinite(referenceHeight) || referenceHeight <= 0))
    throw new Error('reference_height must be positive');
  return {
    schema_version: 1,
    width,
    height,
    columns,
    rows,
    alpha_threshold: threshold,
    alpha_clear_fraction: clear / (width * height),
    reference_height: referenceHeight,
    frames,
    limitation:
      'Boxes and bottom-center anchors are candidates in source-image coordinates, not detected feet/hands or verified contact. Inspect and calibrate per pose; choose a shared reference scale for the intended subject.',
  };
}

export async function inspectAtlas(directory, values) {
  if (!values.input) throw new Error('atlas requires --input');
  const root = await realpath(directory);
  const file = await projectFile(root, values.input);
  const requestKey = await atlasRequestKey(root, values);
  const sourceHash = await fileHash(file);
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Input leaves project');
  const out = await outputFile(root, values.out || `output/qa/atlas-${path.parse(file).name}.json`);
  if (path.extname(out).toLowerCase() !== '.json')
    throw new Error('Atlas report output must be .json');
  newFile(out);
  const packedFile = values.pack ? await outputFile(root, values.pack) : null;
  if (packedFile) {
    if (path.extname(packedFile).toLowerCase() !== '.png')
      throw new Error('Packed atlas output must be .png');
    newFile(packedFile);
  }
  if (values.padding !== undefined && !packedFile) throw new Error('--padding requires --pack');
  const layout = values.layout ? await readJson(await projectFile(root, values.layout)) : {};
  for (const key of ['columns', 'rows'])
    if (
      values[key] !== undefined &&
      layout[key] !== undefined &&
      Number(values[key]) !== layout[key]
    )
      throw new Error(`${key} conflicts with the layout`);
  const image = probe(file).streams.find((stream) => stream.codec_type === 'video');
  if (!image) throw new Error('Input has no readable image');
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 * 1024 },
  );
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || 'Image decoding failed');
  let report = {
    input: relative.replaceAll('\\', '/'),
    sha256: sourceHash,
    request_key: requestKey,
    ...inspectPixels(
      decoded.stdout,
      image.width,
      image.height,
      Number(values.columns ?? layout.columns),
      Number(values.rows ?? layout.rows),
      Number(values['alpha-threshold'] ?? 180),
      layout,
    ),
  };
  const created = [];
  let registration;
  try {
    if ((await atlasRequestKey(root, values)) !== requestKey)
      throw new Error('Atlas inputs changed during preparation');
    if (packedFile) {
      const packed = packAtlasPixels(decoded.stdout, report, {
        padding: Number(values.padding ?? 2),
      });
      const png = encodeAtlasPng(packed.pixels, packed.report.width, packed.report.height);
      report = {
        ...packed.report,
        source: { input: report.input, sha256: report.sha256 },
        input: path.relative(root, packedFile).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(png).digest('hex'),
      };
      await writeFile(packedFile, png, { flag: 'wx' });
      created.push(packedFile);
    }
    await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    created.push(out);
    if (values.register)
      registration = await applyProjectPatch(root, { assets: { [values.register]: report.input } });
  } catch (error) {
    for (const file of created) await rm(file, { force: true });
    throw error;
  }
  return {
    report: path.relative(root, out).replaceAll('\\', '/'),
    frames: report.frames.length,
    empty_cells: report.frames.filter((frame) => frame.empty).length,
    alpha_clear_fraction: report.alpha_clear_fraction,
    boundary_frames: report.frames.flatMap((frame, index) =>
      Object.values(frame.boundary_occupancy).some(Boolean) ? [index] : [],
    ),
    limitation: report.limitation,
    ...(packedFile ? { image: report.input, packing: report.packing } : {}),
    ...(registration ? { registered: values.register, changes: registration } : {}),
  };
}
