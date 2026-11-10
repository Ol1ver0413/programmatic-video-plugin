import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { localFile, parseJson } from './project.mjs';

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export async function containedFile(root, relative) {
  const file = await realpath(localFile(root, relative)),
    rel = path.relative(root, file);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error('Input leaves project');
  if (!(await stat(file)).isFile()) throw new Error(`Expected a file: ${relative}`);
  return file;
}

export async function projectInputs(root, project, { includeText = false } = {}) {
  const sources = new Set(
    (project.scenes ?? [])
      .flatMap((scene) => [scene.source?.file, ...(scene.source?.dependencies ?? [])])
      .filter(Boolean),
  );
  const names = new Set(
    [
      'project.json',
      project.audio,
      project.captions,
      project.font,
      ...Object.values(project.assets ?? {}),
      ...sources,
    ].filter(Boolean),
  );
  for (const optional of ['index.html', 'package.json', 'package-lock.json']) {
    try {
      await stat(localFile(root, optional));
      names.add(optional);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(localFile(root, directory), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const relative = directory + '/' + entry.name;
      if (entry.isDirectory()) await visit(relative);
      else names.add(relative);
    }
  }
  await visit('src');
  await visit('tools');
  const inputs = [];
  for (const relative of [...names].sort()) {
    const file = await containedFile(root, relative),
      size = (await stat(file)).size;
    const item = { file: relative, sha256: await hashFile(file), size };
    if (
      includeText &&
      size <= 2_000_000 &&
      (/^(src|tools)\//.test(relative) ||
        sources.has(relative) ||
        ['project.json', 'index.html'].includes(relative)) &&
      /\.(m?js|cjs|json|html|css)$/i.test(relative)
    )
      item.text = await readFile(file, 'utf8');
    inputs.push(item);
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(inputs.map(({ file, sha256 }) => ({ file, sha256 }))))
    .digest('hex');
  return { fingerprint, inputs };
}

export async function snapshotProject(root, project, captions) {
  if (
    JSON.stringify(parseJson(await readFile(localFile(root, 'project.json'), 'utf8'))) !==
    JSON.stringify(project)
  )
    throw new Error('Project description changed before snapshotting');
  if (
    project.captions != null &&
    JSON.stringify(
      parseJson(await readFile(await containedFile(root, project.captions), 'utf8')),
    ) !== JSON.stringify(captions)
  )
    throw new Error('Project captions changed before snapshotting');
  return {
    schema_version: 1,
    project: structuredClone(project),
    captions: structuredClone(captions),
    ...(await projectInputs(root, project, { includeText: true })),
  };
}
