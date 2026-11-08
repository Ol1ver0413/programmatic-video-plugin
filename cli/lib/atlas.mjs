import path from 'node:path';
import { realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { localFile, outputFile, probe } from '../runtime/project.mjs';
import { newFile } from './media.mjs';

export function inspectPixels(pixels, width, height, columns, rows, threshold = 180) {
  for (const [name, value] of Object.entries({ columns, rows }))
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
  if (columns > width || rows > height) throw new Error('Grid cells must have positive dimensions');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 254)
    throw new Error('alpha-threshold must be an integer from 0 to 254');
  if (pixels.length !== width * height * 4) throw new Error('Incomplete RGBA image');
  let clear = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) clear++;
  const frames = [];
  for (let i = 0; i < columns * rows; i++) {
    const x = Math.floor(((i % columns) * width) / columns);
    const y = Math.floor((Math.floor(i / columns) * height) / rows);
    const right = Math.floor((((i % columns) + 1) * width) / columns);
    const bottom = Math.floor(((Math.floor(i / columns) + 1) * height) / rows);
    let x0 = right,
      y0 = bottom,
      x1 = -1,
      y1 = -1;
    for (let yy = y; yy < bottom; yy++)
      for (let xx = x; xx < right; xx++) {
        if (pixels[(yy * width + xx) * 4 + 3] <= threshold) continue;
        x0 = Math.min(x0, xx);
        y0 = Math.min(y0, yy);
        x1 = Math.max(x1, xx);
        y1 = Math.max(y1, yy);
      }
    const empty = x1 < 0;
    frames.push({
      cell: [x, y, right - x, bottom - y],
      empty,
      box: empty ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
      anchor: empty ? null : [(x0 + x1) / 2, y1],
    });
  }
  return {
    width,
    height,
    columns,
    rows,
    alpha_threshold: threshold,
    alpha_clear_fraction: clear / (width * height),
    reference_height: frames.find((f) => !f.empty)?.box[3] ?? null,
    frames,
    limitation:
      'Boxes and bottom-center anchors are candidates in source-image coordinates, not detected feet/hands or verified contact. Inspect and calibrate per pose; choose a shared reference scale for the intended subject.',
  };
}

export async function inspectAtlas(directory, values) {
  if (!values.input) throw new Error('atlas requires --input');
  const root = await realpath(directory);
  const file = await realpath(localFile(root, values.input));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Input leaves project');
  const out = await outputFile(root, values.out || `output/qa/atlas-${path.parse(file).name}.json`);
  if (path.extname(out).toLowerCase() !== '.json')
    throw new Error('Atlas report output must be .json');
  newFile(out);
  const image = probe(file).streams.find((stream) => stream.codec_type === 'video');
  if (!image) throw new Error('Input has no readable image');
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { windowsHide: true, maxBuffer: 256 * 1024 * 1024 },
  );
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString() || 'Image decoding failed');
  const report = {
    input: relative.replaceAll('\\', '/'),
    sha256: createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    ...inspectPixels(
      decoded.stdout,
      image.width,
      image.height,
      Number(values.columns),
      Number(values.rows),
      Number(values['alpha-threshold'] ?? 180),
    ),
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return {
    report: path.relative(root, out).replaceAll('\\', '/'),
    frames: report.frames.length,
    empty_cells: report.frames.filter((frame) => frame.empty).length,
    alpha_clear_fraction: report.alpha_clear_fraction,
    limitation: report.limitation,
  };
}
