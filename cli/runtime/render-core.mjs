import path from 'node:path';
import { mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startServer } from './server.mjs';
import { checkAndWrite, localFile, outputFile } from './project.mjs';
import { openBrowser, loadProjectPage, captureFrame } from './browser.mjs';
import { selectRange } from './sampling.mjs';
import { timeMapping } from './timing.mjs';
import { snapshotProject, projectInputs, hashFile } from './manifest.mjs';
import { renderSpec } from './render-spec.mjs';
import { renderKey, reuseRender, rememberRender } from './render-cache.mjs';
import { verifyEncoded } from './encoded.mjs';

export async function renderProject(directory, values = {}) {
  let browser, server, encoder, encoderClosed, temporaryVideo, temporaryReport;
  try {
    const started = performance.now();
    if (values.stills && values['no-stills']) throw new Error('Choose --stills or --no-stills');
    if (values.stills && values.out)
      throw new Error('Use frames --out DIR for a custom still-frame directory');
    const { project, root, cues } = await checkAndWrite(directory);
    const spec = renderSpec(project, values);
    if (values.nativeFrames === false) spec.native_capture = false;
    const range = selectRange(project, values);
    const relativeDestination =
      values.out ||
      (spec.profile === 'draft'
        ? `output/previews/draft-${range.firstFrame}-${range.endFrame}.mp4`
        : range.partial
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
    if (spec.profile === 'draft' && isCanonical)
      throw new Error('Draft renders cannot replace output/video.mp4');
    const report = isCanonical
      ? path.join(out, 'render-report.json')
      : destination + '.report.json';
    const snapshot = values.stills ? null : await snapshotProject(root, project, cues);
    if (values.expectedFingerprint && snapshot?.fingerprint !== values.expectedFingerprint)
      throw new Error('Project inputs changed before rendering this segment');
    if (values.videoOnly) spec.has_audio = false;
    const cacheKey = snapshot
      ? (values.cacheKey ?? (await renderKey(snapshot, spec, range)))
      : null;
    const writeStills = !values['no-stills'] && (values.stills || spec.profile !== 'draft');
    const lookupCache = async (stillsWritten = 0, browserErrors = []) => {
      const cached = await reuseRender(root, cacheKey, destination, report, async () => {
        if (browserErrors.length) throw new Error(browserErrors.join('\n'));
        if ((await projectInputs(root, project)).fingerprint !== snapshot.fingerprint)
          throw new Error('Project inputs changed during cache lookup');
      });
      return cached
        ? {
            file: relativeDestination,
            report: path.relative(root, report).replaceAll('\\', '/'),
            render_spec: spec,
            frames: range.frames,
            captured_frames: 0,
            cache_hit: true,
            stills_written: stillsWritten,
            timings: { total_seconds: (performance.now() - started) / 1000 },
          }
        : null;
    };
    if (values.cache && !values.stills && !writeStills) {
      const cached = await lookupCache();
      if (cached) return cached;
    }
    const startedServer = await startServer(0, root);
    server = startedServer.server;
    browser = await openBrowser(root);
    const effectiveProject = {
      ...project,
      width: spec.width,
      height: spec.height,
      ...(values.videoOnly ? { audio: null } : {}),
    };
    const { page, errors } = await loadProjectPage(
        browser,
        startedServer.url,
        effectiveProject,
        values.videoOnly || spec.width !== project.width || spec.height !== project.height
          ? { projectOverride: effectiveProject }
          : undefined,
      ),
      setupDone = performance.now();
    const nativeSize =
      project.pixelArt !== false && values.nativeFrames !== false
        ? await page.evaluate(() =>
            window.__frameCanvas
              ? { width: window.__frameCanvas.width, height: window.__frameCanvas.height }
              : null,
          )
        : null;
    let captureMilliseconds = 0,
      inputBytes = 0;
    const frame = async (time) => {
      const begin = performance.now();
      const bytes = await captureFrame(page, time, { native: Boolean(nativeSize) });
      captureMilliseconds += performance.now() - begin;
      inputBytes += bytes.length;
      return bytes;
    };
    const stillDirectory = range.partial
      ? `output/previews/stills-${range.firstFrame}-${range.endFrame}`
      : 'output/stills';
    const stills = [];
    if (writeStills) {
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
          await writeFile(await outputFile(root, file), await captureFrame(page, time));
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
    if (values.cache && !values.stills && writeStills) {
      const cached = await lookupCache(stills.length, errors);
      if (cached) return cached;
    }
    if (!values.stills) {
      temporaryVideo = path.join(out, `.video-${randomUUID()}.tmp.mp4`);
      const hasAudio = !values.videoOnly && project.audio !== null && project.audio !== undefined;
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
          spec.preset,
          '-crf',
          String(spec.crf),
          '-pix_fmt',
          'yuv420p',
          ...(nativeSize
            ? ['-vf', `scale=${spec.width}:${spec.height}:flags=neighbor,format=rgb24`]
            : []),
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
        if (i % (project.fps * 5) === 0) console.error(`Rendering ${i}/${range.frames}`);
      }
      encoder.stdin.end();
      await completion;
      const encoded = performance.now();
      if (errors.length) throw new Error(errors.join('\n'));
      const { info, video } = verifyEncoded(temporaryVideo, {
        width: spec.width,
        height: spec.height,
        fps: project.fps,
        frames: range.frames,
        duration: range.duration,
        hasAudio,
      });
      const verified = performance.now(),
        seconds = (value) => Math.round(value) / 1000;
      if ((await projectInputs(root, project)).fingerprint !== snapshot.fingerprint)
        throw new Error('Project inputs changed during rendering; existing delivery preserved');
      const result = {
        video_sha256: await hashFile(temporaryVideo),
        project_snapshot: snapshot,
        render_spec: spec,
        render_cache_key: cacheKey,
        captured_frames: range.frames,
        capture_size: nativeSize || { width: spec.width, height: spec.height },
        input_png_bytes: inputBytes,
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
        time_mapping: timeMapping(range.start, range.end),
        stills_written: stills.length,
        timings: {
          setup_seconds: seconds(setupDone - started),
          stills_seconds: seconds(stillsDone - setupDone),
          frames_and_encode_seconds: seconds(encoded - stillsDone),
          capture_seconds: seconds(captureMilliseconds),
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
      if (values.cache)
        try {
          await rememberRender(root, cacheKey, destination, report, result);
        } catch (error) {
          console.error(`Video exported; optional render cache unavailable: ${error.message}`);
        }
      return {
        file: relativeDestination,
        report: path.relative(root, report).replaceAll('\\', '/'),
        render_spec: spec,
        frames: range.frames,
        captured_frames: range.frames,
        cache_hit: false,
        timings: result.timings,
      };
    } else {
      if (errors.length) throw new Error(errors.join('\n'));
      return { stills_written: stills.length, directory: stillDirectory };
    }
  } catch (error) {
    throw error;
  } finally {
    if (encoder && encoder.exitCode === null) encoder.kill();
    if (encoderClosed) await encoderClosed;
    if (temporaryVideo) await rm(temporaryVideo, { force: true });
    if (temporaryReport) await rm(temporaryReport, { force: true });
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
