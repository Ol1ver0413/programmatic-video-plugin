import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateProject, outputFile, probe, run } from '../runtime/project.mjs';
import { readTimeMapping } from '../runtime/timing.mjs';
import { readJson, saveJson, projectFile, fileHash } from './files.mjs';
import { newFile, auditAudio } from './media.mjs';
import { parseCaptions, clipCaptions } from './captions.mjs';
import { readExport } from './project-export.mjs';

const fpsValue = (value) => {
  const [a, b = '1'] = String(value).split('/');
  return Number(a) / Number(b);
};
const normalizedCues = (cues) =>
  cues.map((cue) => ({
    start_ms: Math.round(cue.start * 1000),
    end_ms: Math.round(cue.end * 1000),
    text: cue.text.replaceAll('\r\n', '\n'),
  }));

export async function validateMedia(directory, values) {
  const root = await realpath(directory);
  const relativeReport =
    values.out ||
    `output/qa/media-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}.json`;
  const reportFile = await outputFile(root, relativeReport);
  if (path.extname(reportFile).toLowerCase() !== '.json')
    throw new Error('Media report must be .json');
  newFile(reportFile);
  const report = {
    ok: false,
    kind: 'encoded-media-check',
    input: values.input,
    checks: {},
    errors: [],
    limitation:
      'Verifies encoded media and supplied subtitle sidecars. It does not read burned-in text, judge motion or establish user acceptance.',
  };
  try {
    if (values.report && values.map) throw new Error('Choose --report or --map');
    let project, cues, exported;
    if (values.report) {
      exported = await readExport(root, values.input, values.report);
      if (exported.binding !== 'exported')
        throw new Error('Media checks need a bound export report');
      project = exported.snapshot.project;
      if (exported.render_spec) {
        const { width, height, fps } = exported.render_spec;
        if (![width, height, fps].every((n) => Number.isInteger(n) && n > 0) || fps !== project.fps)
          throw new Error('Export has an invalid render specification');
        project = { ...project, width, height };
      }
      cues = exported.snapshot.captions;
      report.export_binding = {
        video_sha256: exported.video_sha256,
        source_matches_current: exported.source_matches_current,
        warnings: exported.warnings,
      };
    } else {
      const checked = await validateProject(root, { probeAudio: false });
      if (checked.errors.length) throw new Error(checked.errors.join('\n'));
      ({ project, cues } = checked);
    }
    const input = await projectFile(root, values.input);
    const mapping = values.map
      ? readTimeMapping(await readJson(await projectFile(root, values.map)))
      : exported?.time_mapping
        ? readTimeMapping(exported.time_mapping)
        : null;
    if (
      mapping &&
      (mapping.output_start_seconds !== 0 ||
        mapping.source_end_seconds > project.duration + 1 / project.fps + 1e-7)
    )
      throw new Error(
        'Encoded clip mapping must start at output zero and fit the project timeline',
      );
    const frames = mapping
      ? Math.round((mapping.source_end_seconds - mapping.source_start_seconds) * project.fps)
      : Math.ceil(project.duration * project.fps - 1e-7);
    if (
      frames <= 0 ||
      (mapping &&
        Math.abs(
          frames / project.fps - (mapping.source_end_seconds - mapping.source_start_seconds),
        ) > 1e-6)
    )
      throw new Error('Encoded clip mapping must align to the project frame grid');
    const info = probe(input),
      video = info.streams.find((stream) => stream.codec_type === 'video'),
      audio = info.streams.find((stream) => stream.codec_type === 'audio');
    if (!video) throw new Error('Input has no video stream');
    let actualFrames = Number(video.nb_frames);
    if (!Number.isFinite(actualFrames)) {
      const counted = JSON.parse(
        run('ffprobe', [
          '-v',
          'error',
          '-count_frames',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=nb_read_frames',
          '-of',
          'json',
          input,
        ]),
      );
      actualFrames = Number(counted.streams[0]?.nb_read_frames);
    }
    const duration = Number(info.format.duration),
      fps = fpsValue(video.r_frame_rate);
    const expected = {
      width: project.width,
      height: project.height,
      fps: project.fps,
      frames,
      duration_seconds: frames / project.fps,
      has_audio: project.audio != null,
    };
    const actual = {
      width: video.width,
      height: video.height,
      fps,
      frames: actualFrames,
      duration_seconds: duration,
      has_audio: Boolean(audio),
    };
    report.expected = expected;
    report.actual = actual;
    if (mapping) report.time_mapping = mapping;
    for (const key of ['width', 'height', 'frames', 'has_audio'])
      if (actual[key] !== expected[key])
        report.errors.push(`Media ${key}: expected ${expected[key]}, got ${actual[key]}`);
    if (!Number.isFinite(fps) || Math.abs(fps - expected.fps) > 1e-6)
      report.errors.push(`Media fps: expected ${expected.fps}, got ${fps}`);
    if (
      !Number.isFinite(duration) ||
      Math.abs(duration - expected.duration_seconds) > 1 / project.fps + 0.025
    )
      report.errors.push('Media duration differs from the selected frame range');
    run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', input, '-f', 'null', '-']);
    report.checks.full_decode = 'passed';
    report.input_sha256 = await fileHash(input);
    if (values['reference-audio']) {
      const threshold = Number(values['min-correlation'] ?? 0.98);
      if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1)
        throw new Error('min-correlation must be from -1 to 1');
      const reference = await projectFile(root, values['reference-audio']);
      const evidence = auditAudio({ mode: 'verify', input, reference });
      report.checks.audio = { ...evidence, min_correlation: threshold };
      if (evidence.correlation < threshold)
        report.errors.push('Audio correlation is below the selected threshold');
      if (Math.abs(evidence.duration_difference_seconds) > 1 / project.fps + 0.025)
        report.errors.push('Audio reference and encoded soundtrack have different durations');
    } else if (values['min-correlation'] !== undefined)
      throw new Error('min-correlation requires --reference-audio');
    const captionFile =
      values['captions-file'] ??
      (!mapping && !exported && project.captions != null ? 'output/captions.srt' : null);
    if (values['reference-captions'] && !captionFile)
      throw new Error('A partial clip needs --captions-file when checking reference captions');
    if (captionFile) {
      const file = await projectFile(root, captionFile);
      const actualCues = parseCaptions(
        await readFile(file, 'utf8'),
        path.extname(file).toLowerCase(),
        { end: expected.duration_seconds },
      );
      const expectedCues = mapping
        ? clipCaptions(
            cues,
            mapping.source_start_seconds,
            mapping.source_end_seconds - mapping.source_start_seconds,
          )
        : cues;
      const matches = (a, b) =>
        JSON.stringify(normalizedCues(a)) === JSON.stringify(normalizedCues(b));
      report.checks.captions = {
        file: captionFile,
        sha256: await fileHash(file),
        count: actualCues.length,
        matches_project: matches(actualCues, expectedCues),
        method: 'Cue text and millisecond timing; sidecar only',
      };
      if (!report.checks.captions.matches_project)
        report.errors.push('Caption sidecar differs from the selected project cues');
      if (values['reference-captions']) {
        const reference = await projectFile(root, values['reference-captions']);
        const baseline = parseCaptions(
          await readFile(reference, 'utf8'),
          path.extname(reference).toLowerCase(),
          { end: expected.duration_seconds },
        );
        report.checks.captions.matches_reference = matches(actualCues, baseline);
        report.checks.captions.reference_sha256 = await fileHash(reference);
        report.checks.captions.byte_identical_to_reference =
          report.checks.captions.sha256 === report.checks.captions.reference_sha256;
        if (!report.checks.captions.matches_reference)
          report.errors.push('Caption sidecar differs from the supplied reference');
      }
    } else
      report.checks.captions = {
        checked: false,
        reason:
          mapping || exported
            ? 'Supply --captions-file to check a version-specific sidecar'
            : 'Project has no caption sidecar requirement',
      };
  } catch (error) {
    report.errors.push(error.message);
  }
  report.ok = report.errors.length === 0;
  await saveJson(reportFile, report);
  return {
    ok: report.ok,
    report: path.relative(root, reportFile).replaceAll('\\', '/'),
    errors: report.errors,
    checks: Object.keys(report.checks),
  };
}
