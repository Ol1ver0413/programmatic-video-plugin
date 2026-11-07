import path from 'node:path';
import { mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { startServer, root as defaultRoot } from './server.mjs';
import { checkAndWrite, run, probe, localFile, outputFile } from './project.mjs';
import { openBrowser, loadProjectPage, captureFrame } from './browser.mjs';
import { selectRange } from './sampling.mjs';

let browser, server, encoder, encoderClosed, temporaryVideo, temporaryReport;
try {
  const started = performance.now();
  const { values, positionals } = parseArgs({
    options: {
      project: { type: 'string' },
      scene: { type: 'string' },
      start: { type: 'string' },
      duration: { type: 'string' },
      out: { type: 'string' },
      stills: { type: 'boolean' },
      'no-stills': { type: 'boolean' },
    },
  });
  if (positionals.length) throw new Error('Unexpected renderer arguments');
  if (values.stills && values['no-stills']) throw new Error('Choose --stills or --no-stills');
  if (values.stills && values.out)
    throw new Error('Use frames --out DIR for a custom still-frame directory');
  const { project, root } = await checkAndWrite(path.resolve(values.project || defaultRoot));
  const range = selectRange(project, values);
  const relativeDestination =
    values.out ||
    (range.partial
      ? `output/previews/clip-${range.firstFrame}-${range.endFrame}.mp4`
      : 'output/video.mp4');
  const destination = await outputFile(root, relativeDestination),
    out = path.dirname(destination);
  const physicalPath = async (file) => {
    try {
      return await realpath(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await realpath(path.dirname(file)), path.basename(file));
    }
  };
  const canonicalVideo = path.join(root, 'output/video.mp4');
  const normalizedPath = (file) =>
    process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const isCanonical =
    normalizedPath(await physicalPath(destination)) ===
    normalizedPath(await physicalPath(canonicalVideo));
  if (path.extname(relativeDestination).toLowerCase() !== '.mp4')
    throw new Error('Render output must be a project-relative .mp4 file');
  if (range.partial && isCanonical)
    throw new Error('A partial preview cannot replace output/video.mp4');
  const report = isCanonical ? path.join(out, 'render-report.json') : destination + '.report.json';
  const startedServer = await startServer(0, root);
  server = startedServer.server;
  browser = await openBrowser(root);
  const { page, errors } = await loadProjectPage(browser, startedServer.url, project),
    setupDone = performance.now();
  const frame = (time) => captureFrame(page, time);
  const stillDirectory = range.partial
    ? `output/previews/stills-${range.firstFrame}-${range.endFrame}`
    : 'output/stills';
  const stills = [];
  if (!values['no-stills']) {
    await outputFile(root, stillDirectory + '/placeholder');
    await mkdir(localFile(root, stillDirectory), { recursive: true });
    for (const [i, scene] of project.scenes.entries()) {
      const from = Math.max(scene.start, range.start),
        to = Math.min(scene.end, range.end, project.duration);
      if (to <= from) continue;
      for (const part of [0.15, 0.5, 0.85]) {
        const time = from + (to - from) * part,
          name = `${String(i + 1).padStart(2, '0')}-${Math.round(part * 100)}.png`,
          file = stillDirectory + '/' + name;
        await writeFile(await outputFile(root, file), await frame(time));
        stills.push({ scene: scene.id, time, file });
      }
    }
    await writeFile(
      await outputFile(
        root,
        range.partial ? stillDirectory + '/stills.json' : 'output/stills.json',
      ),
      JSON.stringify(stills, null, 2),
    );
  }
  const stillsDone = performance.now();
  if (!values.stills) {
    temporaryVideo = path.join(out, `.video-${randomUUID()}.tmp.mp4`);
    const hasAudio = project.audio !== null && project.audio !== undefined;
    const audioInput = hasAudio
      ? ['-ss', String(range.start), '-i', localFile(root, project.audio)]
      : [];
    const audioOutput = hasAudio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-an'];
    encoder = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(project.fps),
        '-c:v',
        'png',
        '-i',
        'pipe:0',
        ...audioInput,
        '-map',
        '0:v:0',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '19',
        '-pix_fmt',
        'yuv420p',
        ...audioOutput,
        '-t',
        String(range.duration),
        '-movflags',
        '+faststart',
        temporaryVideo,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
    );
    encoderClosed = new Promise((resolve) => encoder.once('close', resolve));
    let stderr = '';
    encoder.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    encoder.stdin.on('error', () => {});
    const completion = new Promise((resolve, reject) => {
      encoder.once('error', reject);
      encoder.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`)),
      );
    });
    completion.catch(() => {});
    for (let i = 0; i < range.frames; i++) {
      if (encoder.exitCode !== null) throw new Error(stderr || 'Encoder stopped early');
      const bytes = await frame((range.firstFrame + i) / project.fps);
      if (!encoder.stdin.write(bytes))
        await Promise.race([once(encoder.stdin, 'drain'), completion]);
      if (i % (project.fps * 5) === 0) console.log(`Rendering ${i}/${range.frames}`);
    }
    encoder.stdin.end();
    await completion;
    const encoded = performance.now();
    if (errors.length) throw new Error(errors.join('\n'));
    const info = probe(temporaryVideo),
      video = info.streams.find((stream) => stream.codec_type === 'video'),
      audio = info.streams.find((stream) => stream.codec_type === 'audio');
    if (
      !video ||
      Boolean(audio) !== hasAudio ||
      video.width !== project.width ||
      video.height !== project.height ||
      Number(video.nb_frames) !== range.frames ||
      Math.abs(Number(info.format.duration) - range.duration) > 1 / project.fps + 0.025
    )
      throw new Error('Exported media does not match the project');
    run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', temporaryVideo, '-f', 'null', '-']);
    const verified = performance.now(),
      seconds = (value) => Math.round(value) / 1000;
    const result = {
      duration_seconds: Number(info.format.duration),
      width: video.width,
      height: video.height,
      fps: video.r_frame_rate,
      frames: range.frames,
      has_audio: hasAudio,
      full_decode: 'passed',
      browser_errors: errors,
      kind: range.partial ? 'preview' : 'full',
      source_start_seconds: range.start,
      source_end_seconds: Math.min(range.end, project.duration),
      requested_range: [range.requestedStart, range.requestedEnd],
      stills_written: stills.length,
      timings: {
        setup_seconds: seconds(setupDone - started),
        stills_seconds: seconds(stillsDone - setupDone),
        frames_and_encode_seconds: seconds(encoded - stillsDone),
        verification_seconds: seconds(verified - encoded),
        total_seconds: seconds(verified - started),
      },
    };
    temporaryReport = path.join(out, `.render-report-${randomUUID()}.tmp`);
    await writeFile(temporaryReport, JSON.stringify(result, null, 2), { flag: 'wx' });
    if (errors.length) throw new Error(errors.join('\n'));
    await rm(report, { force: true });
    await rename(temporaryVideo, destination);
    temporaryVideo = undefined;
    await rename(temporaryReport, report);
    temporaryReport = undefined;
    console.log(`DONE ${destination}`);
  } else {
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Saved ${stills.length} stills`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  if (encoderClosed) await encoderClosed;
  if (temporaryVideo) await rm(temporaryVideo, { force: true });
  if (temporaryReport) await rm(temporaryReport, { force: true });
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
