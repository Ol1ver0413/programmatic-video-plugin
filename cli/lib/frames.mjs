import path from 'node:path';
import { writeFile, realpath, stat, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateProject, localFile, outputFile, probe } from '../runtime/project.mjs';
import { selectTimes } from '../runtime/sampling.mjs';
import { startServer } from '../runtime/server.mjs';
import { openBrowser, loadProjectPage, captureFrame } from '../runtime/browser.mjs';
import { readJson } from './files.mjs';

export async function collectFrames(directory, options = {}) {
  const root = await realpath(directory),
    started = performance.now();
  let project;
  if (options.input) project = await readJson(path.join(root, 'project.json'));
  else {
    const checked = await validateProject(root, { probeAudio: false });
    if (checked.errors.length) throw new Error(checked.errors.join('\n'));
    project = checked.project;
  }
  let input, source, inputDuration, inputSize;
  if (options.input) {
    input = await realpath(localFile(root, options.input));
    const relative = path.relative(root, input);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('Input leaves project');
    const info = probe(input),
      video = info.streams.find((stream) => stream.codec_type === 'video');
    inputDuration = Number(info.format.duration);
    if (!video || !Number.isFinite(inputDuration) || inputDuration <= 0)
      throw new Error('Input must be a video with a readable duration');
    inputSize = { width: video.width, height: video.height };
    const attributes = await stat(input);
    source = {
      file: options.input,
      size: attributes.size,
      modified_at: attributes.mtime.toISOString(),
    };
  }
  const times = selectTimes(
    input && options.times !== undefined ? { ...project, duration: inputDuration } : project,
    options,
  );
  if (input && times.some((time) => time >= inputDuration))
    throw new Error(
      'Sample times must be inside the encoded video; use --times in input-video seconds for partial clips',
    );
  const relativeOutput =
    options.out ||
    `output/qa/frames-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
  const reportFile = await outputFile(root, relativeOutput + '/frames.json'),
    out = path.dirname(reportFile);
  // outputFile creates the parent; require an empty destination to preserve prior evidence.
  if ((await readdir(out)).length)
    throw new Error('Frame output directory must be empty; choose a new --out directory');
  let browser, server;
  try {
    browser = await openBrowser(root);
    let page,
      errors = [];
    if (input) page = await browser.newPage({ viewport: inputSize });
    else {
      const startedServer = await startServer(0, root);
      server = startedServer.server;
      ({ page, errors } = await loadProjectPage(browser, startedServer.url, project));
    }
    const records = [],
      images = [];
    for (const [index, time] of times.entries()) {
      let bytes;
      if (input) {
        const captured = spawnSync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(time),
            '-i',
            input,
            '-frames:v',
            '1',
            '-f',
            'image2pipe',
            '-c:v',
            'png',
            'pipe:1',
          ],
          { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        );
        if (captured.error || captured.status !== 0 || !captured.stdout?.length)
          throw new Error(
            captured.error?.message ||
              captured.stderr?.toString() ||
              'Encoded frame extraction failed',
          );
        bytes = captured.stdout;
      } else bytes = await captureFrame(page, time);
      const file = `${String(index + 1).padStart(3, '0')}.png`;
      await writeFile(await outputFile(root, relativeOutput + '/' + file), bytes);
      records.push({
        file,
        time_requested: time,
        scene_from_project: input
          ? undefined
          : project.scenes.find((scene) => time >= scene.start && time < scene.end)?.id,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      images.push(bytes.toString('base64'));
    }
    const sheet = await page.evaluate(
      async ({ images, records }) => {
        const width = 280,
          height = 158,
          label = 28,
          gap = 8,
          columns = Math.min(4, images.length),
          rows = Math.ceil(images.length / columns);
        const canvas = document.createElement('canvas');
        canvas.width = columns * (width + gap) + gap;
        canvas.height = rows * (height + label + gap) + gap;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#131722';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px monospace';
        ctx.textBaseline = 'top';
        for (let i = 0; i < images.length; i++) {
          const image = new Image();
          image.src = 'data:image/png;base64,' + images[i];
          await image.decode();
          const x = gap + (i % columns) * (width + gap),
            y = gap + Math.floor(i / columns) * (height + label + gap),
            scale = Math.min(width / image.width, height / image.height);
          ctx.drawImage(
            image,
            x + (width - image.width * scale) / 2,
            y + (height - image.height * scale) / 2,
            image.width * scale,
            image.height * scale,
          );
          ctx.fillStyle = '#eef1f7';
          ctx.fillText(`#${i + 1}  ${records[i].time_requested.toFixed(3)}s`, x, y + height + 5);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { images, records },
    );
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(
      await outputFile(root, relativeOutput + '/contact-sheet.png'),
      Buffer.from(sheet, 'base64'),
    );
    const report = {
      kind: input ? 'encoded-video-samples' : 'canvas-runtime-samples',
      time_basis: input ? 'input-video-seconds' : 'project-seconds',
      source: source || { file: 'project.json' },
      sample_count: records.length,
      unique_sample_images: new Set(records.map((record) => record.sha256)).size,
      limitation:
        'Samples and image differences do not establish natural motion, full-frame coverage or user acceptance.',
      browser_errors: errors,
      elapsed_seconds: Math.round(performance.now() - started) / 1000,
      frames: records,
    };
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    return {
      directory: out,
      contactSheet: path.join(out, 'contact-sheet.png'),
      report: reportFile,
      samples: records.length,
      kind: report.kind,
    };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
