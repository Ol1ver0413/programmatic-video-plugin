import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, realpath, stat, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateProject, outputFile, probe } from '../runtime/project.mjs';
import { selectTimes } from '../runtime/sampling.mjs';
import { readTimeMapping, mapTime } from '../runtime/timing.mjs';
import { startServer } from '../runtime/server.mjs';
import { openBrowser, loadProjectPage, captureFrame } from '../runtime/browser.mjs';
import { readJson, saveJson, fileHash, projectFile } from './files.mjs';
import { makeSheets } from './frame-sheets.mjs';
import { projectInputs } from '../runtime/manifest.mjs';
import { readExport } from './project-export.mjs';
import { FrameCache } from './frame-cache.mjs';

async function canvasFingerprint(root, project) {
  const inputs = await projectInputs(root, project);
  const hash = createHash('sha256');
  hash.update(inputs.fingerprint);
  for (const file of [import.meta.url, new URL('../runtime/browser.mjs', import.meta.url)])
    hash.update(await fileHash(fileURLToPath(file)));
  return { sha256: hash.digest('hex'), tracked_inputs: inputs.inputs.map((item) => item.file) };
}

export async function collectFrames(directory, options = {}) {
  const root = await realpath(directory),
    started = performance.now();
  const width = options.width === undefined ? undefined : Number(options.width);
  if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 16384))
    throw new Error('Sample width must be an integer from 1 to 16384');
  if (options.resume && !options.out)
    throw new Error('--resume requires the original --out directory');
  if (options.map && !options.input) throw new Error('--map applies to encoded --input samples');
  if (options.report && (!options.input || options.map))
    throw new Error('--report needs encoded --input and cannot be combined with --map');
  let project, exported;
  if (options.report) {
    exported = await readExport(root, options.input, options.report);
    if (exported.binding !== 'exported')
      throw new Error('Frame sampling needs a bound export report');
    project = exported.snapshot.project;
  } else if (options.input) project = await readJson(path.join(root, 'project.json'));
  else {
    const checked = await validateProject(root, { probeAudio: false });
    if (checked.errors.length) throw new Error(checked.errors.join('\n'));
    project = checked.project;
  }
  const mapping = options.map
    ? readTimeMapping(await readJson(await projectFile(root, options.map)))
    : exported?.time_mapping
      ? readTimeMapping(exported.time_mapping)
      : null;
  let input, source, inputDuration;
  if (options.input) {
    input = await projectFile(root, options.input);
    const info = probe(input),
      video = info.streams.find((stream) => stream.codec_type === 'video');
    inputDuration = Number(info.format.duration);
    if (!video || !Number.isFinite(inputDuration) || inputDuration <= 0)
      throw new Error('Input must be a video with a readable duration');
    const attributes = await stat(input);
    source = {
      file: options.input,
      size: attributes.size,
      modified_at: attributes.mtime.toISOString(),
      sha256: await fileHash(input),
    };
  } else source = { file: 'project.json', ...(await canvasFingerprint(root, project)) };
  if (
    input &&
    !mapping &&
    options.times === undefined &&
    Math.abs(inputDuration - project.duration) > 1 / project.fps + 0.025
  )
    throw new Error(
      'Encoded clip length differs from the project; use --map or explicit input-video --times',
    );
  let times = selectTimes(
    input && options.times !== undefined && !mapping
      ? { ...project, duration: inputDuration }
      : project,
    options,
  );
  const inputTime = (time) => (mapping ? mapTime(time, mapping) : time);
  const fits = (time) =>
    (!mapping || (time >= mapping.source_start_seconds && time < mapping.source_end_seconds)) &&
    inputTime(time) >= 0 &&
    inputTime(time) < inputDuration;
  if (input) {
    if (mapping && options.times === undefined) times = times.filter(fits);
    if (!times.length || times.some((time) => !fits(time)))
      throw new Error(
        'Sample times must be inside the encoded video; use --map for project times or --times in input-video seconds',
      );
  }
  const relativeOutput =
    options.out ||
    `output/qa/frames-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
  const reportFile = await outputFile(root, relativeOutput + '/frames.json'),
    out = path.dirname(reportFile);
  const kind = input ? 'encoded-video-samples' : 'canvas-runtime-samples';
  const timeBasis = input && !mapping ? 'input-video-seconds' : 'project-seconds';
  const plan = {
    kind,
    time_basis: timeBasis,
    source_sha256: source.sha256,
    times,
    time_mapping: mapping,
    ...(width !== undefined ? { width } : {}),
    ...(options.cache ? { shared_cache: true } : {}),
  };
  const cache = options.cache
    ? await new FrameCache(root, {
        kind,
        source: source.sha256,
        width: width ?? null,
        sampling: project.pixelArt === false ? 'smooth' : 'nearest',
        sampler: await fileHash(fileURLToPath(import.meta.url)),
      }).load()
    : null;
  let previous;
  if (options.resume) {
    previous = await readJson(reportFile);
    if (JSON.stringify(previous.plan) !== JSON.stringify(plan))
      throw new Error(
        'Cannot resume: source, requested times or time mapping changed; choose a new --out',
      );
  } else if ((await readdir(out)).length)
    throw new Error(
      'Frame output directory must be empty; choose a new --out directory or --resume',
    );
  const state = {
    schema_version: 1,
    kind,
    time_basis: timeBasis,
    source,
    ...(mapping ? { time_mapping: mapping } : {}),
    plan,
    status: 'extracting',
    limitation:
      'Samples and image differences do not establish natural motion, full-frame coverage or user acceptance.',
    browser_errors: [],
    frames: [],
    captured_frames: 0,
    reused_frames: 0,
    contact_sheets: [],
  };
  let browser,
    server,
    errors = [],
    cancelled = false;
  const interrupt = () => {
    cancelled = true;
  };
  const checkCancelled = () => {
    if (cancelled || options.signal?.aborted)
      throw new Error('Frame collection cancelled; use --resume to continue');
  };
  const persist = async () => {
    state.sample_count = state.frames.length;
    state.unique_sample_images = new Set(state.frames.map((frame) => frame.sha256)).size;
    state.elapsed_seconds = Math.round(performance.now() - started) / 1000;
    await saveJson(reportFile, state);
  };
  process.once('SIGINT', interrupt);
  try {
    for (const record of previous?.frames ?? []) {
      const index = times.indexOf(record.time_requested);
      if (
        index < 0 ||
        (record.cache_key
          ? !cache ||
            record.cache_key !==
              cache.key(input ? inputTime(record.time_requested) : record.time_requested)
          : record.file !== `${String(index + 1).padStart(3, '0')}.png`)
      )
        throw new Error('Resume manifest contains an unexpected frame');
      try {
        const cached = await projectFile(root, relativeOutput + '/' + record.file);
        if ((await fileHash(cached)) !== record.sha256)
          throw new Error('Cached frame changed; choose a new --out');
        state.frames.push(record);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await persist();
    let page;
    for (const [index, time] of times.entries()) {
      checkCancelled();
      let file = `${String(index + 1).padStart(3, '0')}.png`;
      if (state.frames.some((frame) => frame.time_requested === time)) continue;
      const key = cache?.key(input ? inputTime(time) : time);
      let cached = key ? await cache.get(key) : null;
      let bytes;
      if (cached) state.reused_frames++;
      else if (input) {
        const captured = spawnSync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(inputTime(time)),
            '-i',
            input,
            '-frames:v',
            '1',
            '-f',
            'image2pipe',
            '-c:v',
            'png',
            ...(width
              ? [
                  '-vf',
                  `scale=w=min(iw\\,${width}):h=-1:flags=${project.pixelArt === false ? 'bicubic' : 'neighbor'}`,
                ]
              : []),
            'pipe:1',
          ],
          { windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
        );
        if (captured.error || captured.status !== 0 || !captured.stdout?.length)
          throw new Error(
            captured.error?.message ||
              captured.stderr?.toString() ||
              'Encoded frame extraction failed',
          );
        bytes = captured.stdout;
      } else {
        if (!page) {
          const startedServer = await startServer(0, root);
          server = startedServer.server;
          browser = await openBrowser(root);
          ({ page, errors } = await loadProjectPage(browser, startedServer.url, project));
        }
        bytes = await captureFrame(page, time, { width });
      }
      if (!cached) {
        state.captured_frames++;
        if (cache) cached = await cache.put(key, bytes);
        else await writeFile(await outputFile(root, relativeOutput + '/' + file), bytes);
      }
      if (cached) file = cache.relativeFile(out, cached);
      state.frames.push({
        file,
        time_requested: time,
        ...(mapping ? { time_input: inputTime(time) } : {}),
        ...(input && !mapping
          ? {}
          : {
              scene_from_project: project.scenes.find(
                (scene) => time >= scene.start && time < scene.end,
              )?.id,
            }),
        sha256: cached?.sha256 ?? createHash('sha256').update(bytes).digest('hex'),
        ...(key ? { cache_key: key } : {}),
      });
      state.frames.sort((a, b) => a.time_requested - b.time_requested);
      await persist();
      console.error(`Frames: ${state.frames.length}/${times.length} extracted`);
    }
    checkCancelled();
    if (
      input
        ? (await fileHash(input)) !== source.sha256
        : (await canvasFingerprint(root, project)).sha256 !== source.sha256
    )
      throw new Error('Frame source changed during collection; collect a new version');
    if (errors.length) throw new Error(errors.join('\n'));
    if (cache) await cache.save();
    state.status = 'assembling';
    await persist();
    if (!browser) browser = await openBrowser(root);
    page ??= await browser.newPage({ viewport: { width: 640, height: 360 } });
    await makeSheets(
      page,
      root,
      relativeOutput,
      state.frames,
      async (pages) => {
        state.contact_sheets = [...pages];
        await persist();
        console.error(`Frames: contact-sheet page ${pages.length}/${Math.ceil(times.length / 16)}`);
      },
      checkCancelled,
    );
    checkCancelled();
    if (errors.length) throw new Error(errors.join('\n'));
    state.status = 'complete';
    await persist();
    return {
      directory: out,
      contactSheet: path.join(out, 'contact-sheet.png'),
      contactSheets: state.contact_sheets.map((file) => path.join(out, file)),
      report: reportFile,
      samples: state.frames.length,
      kind,
      captured_frames: state.captured_frames,
      reused_frames: state.reused_frames,
    };
  } catch (error) {
    if (state.sample_count !== undefined) {
      state.status = cancelled || options.signal?.aborted ? 'cancelled' : 'failed';
      state.error = error.message;
      state.browser_errors = errors;
      await persist();
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
