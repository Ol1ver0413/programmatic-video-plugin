import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { validateProject } from '../runtime/project.mjs';
import { projectInputs, snapshotProject } from '../runtime/manifest.mjs';
import { fileHash, projectFile, readJson } from './files.mjs';

export async function readExport(directory, input, reportPath) {
  const root = await realpath(directory),
    video = await projectFile(root, input);
  const sha256 = await fileHash(video);
  const inputPath = path.relative(root, video).replaceAll('\\', '/');
  const canonical =
    (process.platform === 'win32' ? inputPath.toLowerCase() : inputPath) === 'output/video.mp4';
  const candidate =
    reportPath ?? (canonical ? 'output/render-report.json' : input + '.report.json');
  let report, reportFile;
  try {
    reportFile = await projectFile(root, candidate);
    report = await readJson(reportFile);
  } catch (error) {
    if (reportPath || error.code !== 'ENOENT') throw error;
  }
  const bound = report?.video_sha256 !== undefined;
  if (bound && report.video_sha256 !== sha256)
    throw new Error('Video and export report do not match; select the report for this exact video');
  let snapshot = bound ? report.project_snapshot : null;
  if (
    bound &&
    (snapshot?.schema_version !== 1 || !snapshot.project || !Array.isArray(snapshot.inputs))
  )
    throw new Error('Export report is missing its project snapshot');
  if (!snapshot) {
    const current = await validateProject(root, { probeAudio: false });
    if (current.errors.length) throw new Error(current.errors.join('\n'));
    snapshot = await snapshotProject(root, current.project, current.cues);
  }
  let currentMatches = false,
    currentError;
  try {
    const current = await readJson(path.join(root, 'project.json'));
    currentMatches = (await projectInputs(root, current)).fingerprint === snapshot.fingerprint;
  } catch (error) {
    currentError = error.message;
  }
  return {
    root,
    input,
    video_sha256: sha256,
    binding: bound ? 'exported' : 'unverified',
    snapshot,
    time_mapping: report?.time_mapping ?? null,
    export_report: reportFile ? { file: candidate, sha256: await fileHash(reportFile) } : null,
    source_matches_current: bound && currentMatches,
    warnings: [
      ...(!bound
        ? ['Legacy media has no bound snapshot; current project metadata is provisional']
        : []),
      ...(bound && !currentMatches ? ['Current project differs from the exported version'] : []),
      ...(currentError ? [currentError] : []),
    ],
  };
}
