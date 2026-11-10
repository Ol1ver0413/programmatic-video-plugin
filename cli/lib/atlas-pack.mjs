import { spawnSync } from 'node:child_process';
import { insidePolygon } from '../runtime/sprites.mjs';

// Coordinates remain in one shared scale; only crop translation changes.
export function packAtlasPixels(pixels, report, { padding = 2 } = {}) {
  if (!Number.isInteger(padding) || padding < 0 || padding > 128)
    throw new Error('Atlas padding must be an integer from 0 to 128');
  const { width, height } = report;
  if (pixels.length !== width * height * 4) throw new Error('Incomplete atlas pixels');
  const boxes = report.frames.map((frame) => {
    const [rx, ry, rw, rh] = frame.region;
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (let y = Math.floor(ry); y < Math.ceil(ry + rh); y++)
      for (let x = Math.floor(rx); x < Math.ceil(rx + rw); x++)
        if (
          x + 0.5 >= rx &&
          x + 0.5 < rx + rw &&
          y + 0.5 >= ry &&
          y + 0.5 < ry + rh &&
          insidePolygon(x + 0.5, y + 0.5, frame.polygon) &&
          pixels[(y * width + x) * 4 + 3]
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    return right < 0
      ? [Math.floor(rx), Math.floor(ry), 1, 1]
      : [left, top, right - left + 1, bottom - top + 1];
  });
  const cellW = Math.max(...boxes.map((box) => box[2])) + padding * 2;
  const cellH = Math.max(...boxes.map((box) => box[3])) + padding * 2;
  const outW = cellW * report.columns,
    outH = cellH * report.rows;
  if (outW * outH * 4 > 256 * 1024 * 1024)
    throw new Error('Packed atlas exceeds 256 MB RGBA limit');
  const output = Buffer.alloc(outW * outH * 4);
  const frames = report.frames.map((frame, i) => {
    const [sx, sy, w, h] = boxes[i];
    const x = (i % report.columns) * cellW + padding,
      y = Math.floor(i / report.columns) * cellH + padding;
    const dx = x - sx,
      dy = y - sy;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const px = sx + xx,
          py = sy + yy;
        const [rx, ry, rw, rh] = frame.region;
        if (
          px + 0.5 < rx ||
          px + 0.5 >= rx + rw ||
          py + 0.5 < ry ||
          py + 0.5 >= ry + rh ||
          !insidePolygon(px + 0.5, py + 0.5, frame.polygon)
        )
          continue;
        pixels.copy(
          output,
          ((y + yy) * outW + x + xx) * 4,
          (py * width + px) * 4,
          (py * width + px + 1) * 4,
        );
      }
    const translate = (point) => (point ? [point[0] + dx, point[1] + dy] : null);
    const { polygon, ...metadata } = frame;
    return {
      ...metadata,
      source_region: frame.region,
      ...(polygon ? { source_polygon: polygon } : {}),
      cell: [(i % report.columns) * cellW, Math.floor(i / report.columns) * cellH, cellW, cellH],
      region: [x, y, w, h],
      box: frame.box ? [frame.box[0] + dx, frame.box[1] + dy, ...frame.box.slice(2)] : null,
      anchor: translate(frame.anchor),
      anchors: Object.fromEntries(
        Object.entries(frame.anchors).map(([name, point]) => [name, translate(point)]),
      ),
      region_origin: 'packed',
    };
  });
  let clear = 0;
  for (let i = 3; i < output.length; i += 4) if (!output[i]) clear++;
  return {
    pixels: output,
    report: {
      ...report,
      width: outW,
      height: outH,
      frames,
      alpha_clear_fraction: clear / (outW * outH),
      packing: {
        padding,
        source_width: width,
        source_height: height,
        pixel_area_ratio: (outW * outH) / (width * height),
      },
    },
  };
}

export function encodeAtlasPng(pixels, width, height) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${width}x${height}`,
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:1',
    ],
    { input: pixels, windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0 || !result.stdout.length)
    throw new Error(result.error?.message || result.stderr.toString() || 'Atlas encoding failed');
  return result.stdout;
}
