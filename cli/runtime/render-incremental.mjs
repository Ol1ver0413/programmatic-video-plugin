import path from 'node:path';
import { writeFile, rename, rm, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { renderProject } from './render-core.mjs';
import { renderSpec } from './render-spec.mjs';
import { selectRange } from './sampling.mjs';
import { checkAndWrite, outputFile, localFile, run } from './project.mjs';
import { snapshotProject, projectInputs, hashFile } from './manifest.mjs';
import { timeMapping } from './timing.mjs';
import { verifyEncoded } from './encoded.mjs';

// Opt-in contract: __render(time) is deterministic, and a scene cannot read another
// scene's parameters/events. Shared files/assets conservatively affect every scene.
export async function renderIncremental(directory, values = {}) {
  if (['scene', 'start', 'duration', 'stills'].some((key) => values[key] !== undefined))
    throw new Error(
      'Incremental assembly renders the full timeline; use normal render for partial previews',
    );
  const started = performance.now();
  const { root, project, cues } = await checkAndWrite(directory);
  if (project.rendering?.sceneCache !== 'isolated')
    throw new Error(
      'Incremental rendering requires rendering.sceneCache="isolated" and scene-local deterministic code',
    );
  const spec = renderSpec(project, values),
    snapshot = await snapshotProject(root, project, cues);
  const range = selectRange(project);
  const relative =
    values.out ||
    (spec.profile === 'draft' ? 'output/previews/draft-incremental.mp4' : 'output/video.mp4');
  if (path.extname(relative).toLowerCase() !== '.mp4')
    throw new Error('Render output must be .mp4');
  const destination = await outputFile(root, relative);
  const normalize = (file) =>
    process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  let canonical = path.join(root, 'output/video.mp4');
  try {
    canonical = await realpath(canonical);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let target = destination;
  try {
    target = await realpath(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const isCanonical = normalize(target) === normalize(canonical);
  if (spec.profile === 'draft' && isCanonical)
    throw new Error('Draft renders cannot replace output/video.mp4');
  const report = isCanonical
    ? path.join(root, 'output/render-report.json')
    : destination + '.report.json';
  const shared = snapshot.inputs
    .filter((item) => !['project.json', project.audio, project.captions].includes(item.file))
    .map(({ file, sha256 }) => ({ file, sha256 }));
  const globals = structuredClone(project);
  delete globals.scenes;
  delete globals.audio;
  delete globals.captions;
  const code = await Promise.all(
    ['render-incremental.mjs', 'render-core.mjs', 'render-spec.mjs', 'browser.mjs'].map((name) =>
      hashFile(new URL(name, import.meta.url)),
    ),
  );
  const segments = [];
  let temporaryVideo, temporaryReport, list;
  try {
    for (const scene of project.scenes) {
      const selected = selectRange(project, { scene: scene.id });
      const visibleCues =
        project.burnCaptions === false
          ? []
          : cues.filter((cue) => cue.end > selected.start && cue.start < selected.end);
      const key = createHash('sha256')
        .update(
          JSON.stringify({
            scene,
            globals,
            shared,
            spec,
            code,
            cues: visibleCues,
            range: [selected.firstFrame, selected.endFrame],
          }),
        )
        .digest('hex');
      const file = `.programmatic-video/cache/segments/${key}.mp4`;
      const result = await renderProject(root, {
        scene: scene.id,
        profile: spec.profile,
        out: file,
        'no-stills': true,
        cache: true,
        videoOnly: true,
        cacheKey: key,
        expectedFingerprint: snapshot.fingerprint,
      });
      segments.push({
        scene: scene.id,
        file,
        frames: selected.frames,
        cache_hit: result.cache_hit,
        captured_frames: result.captured_frames,
      });
    }
    if ((await projectInputs(root, project)).fingerprint !== snapshot.fingerprint)
      throw new Error('Project inputs changed during incremental render');
    list = path.join(path.dirname(destination), `.concat-${randomUUID()}.txt`);
    temporaryVideo = path.join(path.dirname(destination), `.video-${randomUUID()}.tmp.mp4`);
    temporaryReport = path.join(path.dirname(destination), `.report-${randomUUID()}.tmp`);
    await writeFile(
      list,
      segments
        .map(
          (segment) =>
            `file '${localFile(root, segment.file).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`,
        )
        .join('\n'),
    );
    const audio = project.audio ? ['-i', localFile(root, project.audio)] : [];
    run('ffmpeg', [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      ...audio,
      '-map',
      '0:v:0',
      ...(project.audio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-c:v',
      'copy',
      '-video_track_timescale',
      String(project.fps * 1000),
      '-t',
      String(range.duration),
      '-movflags',
      '+faststart',
      temporaryVideo,
    ]);
    const hasAudio = Boolean(project.audio);
    const { info, video } = verifyEncoded(temporaryVideo, {
      width: spec.width,
      height: spec.height,
      fps: project.fps,
      frames: range.frames,
      duration: range.duration,
      hasAudio,
    });
    if ((await projectInputs(root, project)).fingerprint !== snapshot.fingerprint)
      throw new Error('Project inputs changed during incremental assembly');
    const timings = { total_seconds: (performance.now() - started) / 1000 };
    const captured = segments.reduce((sum, segment) => sum + segment.captured_frames, 0);
    const data = {
      video_sha256: await hashFile(temporaryVideo),
      project_snapshot: snapshot,
      render_spec: spec,
      kind: 'full',
      duration_seconds: Number(info.format.duration),
      width: spec.width,
      height: spec.height,
      fps: video.r_frame_rate,
      frames: range.frames,
      has_audio: hasAudio,
      full_decode: 'passed',
      browser_errors: [],
      time_mapping: timeMapping(0, range.end),
      source_start_seconds: 0,
      source_end_seconds: range.end,
      captured_frames: captured,
      segments,
      timings,
    };
    await writeFile(temporaryReport, JSON.stringify(data, null, 2));
    await rename(temporaryVideo, destination);
    temporaryVideo = undefined;
    await rename(temporaryReport, report);
    temporaryReport = undefined;
    return {
      file: relative,
      report: path.relative(root, report).replaceAll('\\', '/'),
      render_spec: spec,
      frames: range.frames,
      captured_frames: captured,
      reused_scenes: segments.filter((s) => s.cache_hit).map((s) => s.scene),
      rendered_scenes: segments.filter((s) => !s.cache_hit).map((s) => s.scene),
      timings,
    };
  } finally {
    for (const file of [temporaryVideo, temporaryReport, list].filter(Boolean))
      await rm(file, { force: true });
  }
}
