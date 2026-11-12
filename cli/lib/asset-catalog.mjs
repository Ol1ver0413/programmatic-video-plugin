import path from 'node:path';
import { open, readFile, realpath, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { outputFile, parseJson } from '../runtime/project.mjs';
import { projectFile, saveJson } from './files.mjs';

const namespace = 'programmatic_video_assets';
export const assetRecord = (entry) => entry?.type === 'programmatic-video-asset';

export async function readAssetCatalog(root) {
  let source;
  try {
    source = await readFile(await projectFile(root, 'assets/sources.json'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const document = source === undefined ? [] : parseJson(source);
  if (!document || typeof document !== 'object')
    throw new Error('Asset sources must be an array or object');
  const entries = Array.isArray(document) ? document : (document[namespace] ?? []);
  if (!Array.isArray(entries)) throw new Error('Invalid image asset catalog');
  return { document, entries, source };
}

export async function updateAssetCatalog(directory, update) {
  const root = await realpath(directory);
  await projectFile(root, 'project.json');
  const file = await outputFile(root, 'assets/sources.json');
  const lockFile = file + '.lock';
  let lock;
  try {
    lock = await open(lockFile, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Asset catalog is locked: ${lockFile}. Wait for the active operation; after an interrupted owner exits, use assets --recover-lock.`,
        { cause: error },
      );
    throw error;
  }
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        token: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
    const catalog = await readAssetCatalog(root);
    const result = await update(root, catalog.entries);
    if (result.changed) {
      let current;
      try {
        current = await readFile(file, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (current !== catalog.source)
        throw new Error('Asset sources changed during the operation; retry');
      const document = Array.isArray(catalog.document)
        ? catalog.entries
        : { ...catalog.document, [namespace]: catalog.entries };
      await saveJson(file, document);
    }
    return result.value;
  } finally {
    await lock.close();
    await rm(lockFile, { force: true });
  }
}

export function assetJob(entries, id) {
  const job = entries.find((entry) => assetRecord(entry) && entry.id === id);
  if (!job) throw new Error(`Unknown asset request: ${id}`);
  return job;
}

export const relativeAsset = (root, file) => path.relative(root, file).replaceAll('\\', '/');

export async function recoverAssetLock(directory) {
  const root = await realpath(directory);
  await projectFile(root, 'project.json');
  let file, source;
  try {
    file = await projectFile(root, 'assets/sources.json.lock');
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { recovered: false };
    throw error;
  }
  const owner = parseJson(source);
  if (
    owner.host !== hostname() ||
    !Number.isInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== 'string' ||
    !owner.token
  )
    throw new Error('Cannot verify this catalog lock owner; inspect the lock before removing it');
  let exited = false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') exited = true;
    else throw new Error('Cannot verify whether the lock owner is active', { cause: error });
  }
  if (!exited) throw new Error('The asset operation is still active; its lock cannot be recovered');
  if ((await readFile(file, 'utf8')) !== source)
    throw new Error('Catalog lock changed during recovery; retry');
  await rm(file);
  return { recovered: true, previous_pid: owner.pid };
}
