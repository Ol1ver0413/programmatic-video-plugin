import path from 'node:path';
import { constants } from 'node:fs';
import { copyFile, realpath, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { outputFile, probe } from '../runtime/project.mjs';
import { readJson, projectFile, fileHash } from './files.mjs';
import { applyProjectPatch, readPatch } from './project-operations.mjs';
import {
  assetRecord,
  assetJob,
  readAssetCatalog,
  updateAssetCatalog,
  relativeAsset,
  recoverAssetLock,
} from './asset-catalog.mjs';

const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value.trim();
};
function identifier(value) {
  const id = text(value, 'Asset id');
  if (
    !/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) ||
    ['constructor', 'prototype', '__proto__'].includes(id)
  )
    throw new Error('Asset ids must be short names without path separators or reserved keys');
  return id;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function summarize(job, project) {
  return {
    id: job.id,
    asset: job.request.asset,
    kind: job.request.kind,
    status: job.status,
    purpose: job.request.purpose,
    file: job.file ?? null,
    sha256: job.sha256 ?? null,
    dimensions: job.dimensions ?? null,
    warnings: job.warnings ?? [],
    attempts: job.attempts?.length ?? 0,
    active: Boolean(job.file && project?.assets?.[job.request.asset] === job.file),
    active_file: project?.assets?.[job.request.asset] ?? null,
    declared_scenes: (project?.scenes ?? [])
      .filter((scene) => scene.assets?.includes(job.request.asset))
      .map((scene) => scene.id),
  };
}
async function normalizeRequest(root, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Asset request must be an object');
  for (const key of Object.keys(input))
    if (
      !['id', 'asset', 'kind', 'purpose', 'prompt', 'references', 'minimum', 'scenes'].includes(key)
    )
      throw new Error(`Unknown asset request field: ${key}`);
  const id = identifier(input.id),
    asset = identifier(input.asset ?? id);
  const kind = input.kind ?? 'candidate';
  if (!['reference', 'candidate', 'production'].includes(kind))
    throw new Error('Asset kind must be reference, candidate or production');
  if (input.references !== undefined && !Array.isArray(input.references))
    throw new Error('Asset references must be an array');
  const references = [];
  for (const reference of input.references ?? []) {
    const file = await projectFile(root, reference?.file);
    references.push({
      file: relativeAsset(root, file),
      role: text(reference.role, 'Reference role'),
      sha256: await fileHash(file),
    });
  }
  if (
    input.minimum !== undefined &&
    (!input.minimum ||
      !['width', 'height'].every(
        (key) => Number.isInteger(input.minimum[key]) && input.minimum[key] > 0,
      ))
  )
    throw new Error('Minimum image size needs positive integer width and height');
  if (
    input.scenes !== undefined &&
    (!Array.isArray(input.scenes) ||
      input.scenes.some((id) => typeof id !== 'string' || !id.trim()))
  )
    throw new Error('Planned scenes must be an array of scene ids');
  return {
    id,
    asset,
    kind,
    purpose: input.purpose === undefined ? '' : text(input.purpose, 'Asset purpose'),
    prompt: input.prompt === undefined ? '' : text(input.prompt, 'Image prompt'),
    references,
    ...(input.minimum
      ? { minimum: { width: input.minimum.width, height: input.minimum.height } }
      : {}),
    scenes: input.scenes ?? [],
  };
}

export async function prepareAsset(directory, input) {
  return updateAssetCatalog(directory, async (root, entries) => {
    const request = await normalizeRequest(root, input),
      hash = digest(request);
    const existing = entries.find((entry) => assetRecord(entry) && entry.id === request.id);
    if (existing && existing.request_sha256 !== hash)
      throw new Error(
        'This request id already has different inputs; use a new id for a new revision',
      );
    const job = existing ?? {
      type: 'programmatic-video-asset',
      schema_version: 1,
      id: request.id,
      request,
      request_sha256: hash,
      status: 'requested',
      createdAt: new Date().toISOString(),
      attempts: [],
    };
    if (!existing) entries.push(job);
    const project = await readJson(await projectFile(root, 'project.json'));
    return {
      changed: !existing,
      value: {
        ...summarize(job, project),
        reused: Boolean(existing),
        generation: {
          prompt: request.prompt,
          references: request.references.map((reference) => ({
            ...reference,
            file: path.resolve(root, reference.file),
          })),
        },
        next: job.file
          ? 'Reuse the imported image, or inspect its current adoption before preparing a new revision.'
          : existing
            ? 'The request is already prepared. Check any in-flight host generation or existing output before starting another call.'
            : 'Use a host image tool or supply an existing image, import its actual file with --job/--import, inspect it, then --adopt. No model is called by this CLI.',
      },
    };
  });
}

export async function importAsset(directory, id, input) {
  identifier(id);
  return updateAssetCatalog(directory, async (root, entries) => {
    const job = assetJob(entries, id);
    for (const reference of job.request.references)
      if ((await fileHash(await projectFile(root, reference.file))) !== reference.sha256)
        throw new Error(`Reference changed after preparation: ${reference.file}`);
    const source = await realpath(path.resolve(text(input, 'Imported image'))),
      extension = path.extname(source).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension))
      throw new Error('Import a PNG, JPEG or WebP image');
    const bytes = (await stat(source)).size;
    if (!bytes) throw new Error('Imported image is empty');
    const sha256 = await fileHash(source),
      info = probe(source),
      image = info.streams.find((stream) => stream.codec_type === 'video');
    if (
      !image ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1
    )
      throw new Error('Imported file has no valid image dimensions');
    if (!/^(?:png_pipe|jpeg_pipe|webp_pipe|image2)$/.test(info.format.format_name))
      throw new Error('Imported file must be a still image, not a renamed video');
    let shared;
    for (const entry of entries.filter(assetRecord))
      for (const attempt of entry.attempts ?? [])
        if (attempt.sha256 === sha256) {
          const candidate = await projectFile(root, attempt.file);
          if ((await fileHash(candidate)) !== sha256)
            throw new Error(`Previously imported asset changed: ${attempt.file}`);
          shared = candidate;
        }
    const destination =
      shared ??
      (await outputFile(root, `assets/generated/${id}-${sha256.slice(0, 12)}${extension}`));
    let created = false;
    try {
      if (!shared) {
        try {
          await copyFile(source, destination, constants.COPYFILE_EXCL);
          created = true;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      if ((await fileHash(destination)) !== sha256)
        throw new Error('Imported image changed while copying, or its output already differs');
      const file = relativeAsset(root, destination),
        warnings = [];
      if (
        job.request.minimum &&
        (image.width < job.request.minimum.width || image.height < job.request.minimum.height)
      )
        warnings.push(
          'Image is smaller than the declared minimum; inspect effective crop pixels or prepare a higher-resolution candidate',
        );
      const repeated = job.file === file && job.sha256 === sha256;
      if (!repeated) {
        job.file = file;
        job.sha256 = sha256;
        job.dimensions = { width: image.width, height: image.height };
        job.warnings = warnings;
        job.status = 'candidate';
        if (!job.attempts.some((attempt) => attempt.sha256 === sha256))
          job.attempts.push({
            file,
            sha256,
            bytes,
            ...job.dimensions,
            source_file: source,
            importedAt: new Date().toISOString(),
          });
      }
      const project = await readJson(await projectFile(root, 'project.json'));
      return {
        changed: !repeated,
        value: {
          ...summarize(job, project),
          reused: !created,
          next: 'Inspect content, identity, actual crop resolution and alpha; use atlas for geometry, then explicitly adopt.',
        },
      };
    } catch (error) {
      if (created) await rm(destination, { force: true });
      throw error;
    }
  });
}

export async function adoptAsset(directory, id) {
  identifier(id);
  return updateAssetCatalog(directory, async (root, entries) => {
    const job = assetJob(entries, id);
    if (!job.file) throw new Error('Import a real candidate before adopting it');
    if ((await fileHash(await projectFile(root, job.file))) !== job.sha256)
      throw new Error('Candidate changed since import');
    if (job.warnings?.length)
      throw new Error(
        'Candidate does not meet its declared size; revise the request or import a suitable image',
      );
    const project = await readJson(await projectFile(root, 'project.json'));
    const repeated = job.status === 'adopted' && project.assets?.[job.request.asset] === job.file;
    const changes = await applyProjectPatch(root, { assets: { [job.request.asset]: job.file } });
    job.status = 'adopted';
    job.adopted = {
      file: job.file,
      sha256: job.sha256,
      at: repeated ? job.adopted?.at : new Date().toISOString(),
    };
    return {
      changed: !repeated,
      value: {
        ...summarize(job, {
          ...project,
          assets: { ...project.assets, [job.request.asset]: job.file },
        }),
        reused: repeated,
        changes,
        limitation:
          'Registered for production, not user approval. The agent still wires scenes and verifies actual use.',
      },
    };
  });
}

export async function listAssets(directory, id) {
  const root = await realpath(directory),
    project = await readJson(await projectFile(root, 'project.json'));
  const { entries } = await readAssetCatalog(root);
  if (id) {
    const job = assetJob(entries, identifier(id));
    return {
      ...summarize(job, project),
      request: job.request,
      imports: job.attempts,
      adopted: job.adopted ?? null,
    };
  }
  const jobs = entries.filter(assetRecord).map((job) => summarize(job, project));
  return {
    jobs,
    registered_assets: Object.keys(project.assets ?? {}).length,
    limitation:
      'Scene use is declared metadata, not observed drawing. Existing source records are preserved; no files are deleted.',
  };
}

export async function manageAssets(directory, values) {
  const actions = [values.prepare, values.import, values.adopt, values['recover-lock']].filter(
    Boolean,
  ).length;
  if (actions > 1) throw new Error('Choose one asset prepare/import/adopt/recover operation');
  if (values['recover-lock']) {
    if (values.job) throw new Error('Catalog lock recovery does not select a job');
    return recoverAssetLock(directory);
  }
  if (values.prepare) {
    if (values.job) throw new Error('Prepared JSON contains the request id');
    return prepareAsset(directory, await readPatch(directory, values.prepare));
  }
  if (values.import || values.adopt) {
    if (!values.job) throw new Error('Asset import/adopt requires --job ID');
    return values.import
      ? importAsset(directory, values.job, values.import)
      : adoptAsset(directory, values.job);
  }
  return listAssets(directory, values.job);
}
