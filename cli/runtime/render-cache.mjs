import path from 'node:path';
import { readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { containedFile, hashFile } from './manifest.mjs';
import { outputFile } from './project.mjs';

export async function renderKey(snapshot, spec, range) {
  const hash = createHash('sha256').update(
    JSON.stringify({
      source: snapshot.fingerprint,
      spec,
      start: range.firstFrame,
      end: range.endFrame,
    }),
  );
  for (const file of [
    'render-core.mjs',
    'render-spec.mjs',
    'render-cache.mjs',
    'browser.mjs',
    'encoded.mjs',
  ])
    hash.update(await hashFile(new URL(file, import.meta.url)));
  return hash.digest('hex');
}

export async function reuseRender(root, key, destination, report, beforePublish) {
  let index, source, sourceReport, data;
  try {
    index = JSON.parse(
      await readFile(
        await containedFile(root, `.programmatic-video/cache/renders/${key}.json`),
        'utf8',
      ),
    );
    if (index.key !== key || index.schema_version !== 1) return null;
    source = await containedFile(root, index.file);
    sourceReport = await containedFile(root, index.report);
    if (
      (await hashFile(source)) !== index.video_sha256 ||
      (await hashFile(sourceReport)) !== index.report_sha256
    )
      return null;
    data = JSON.parse(await readFile(sourceReport, 'utf8'));
    if (data.video_sha256 !== index.video_sha256 || data.render_cache_key !== key) return null;
  } catch {
    return null;
  }
  const temporary = [];
  try {
    for (const [from, to] of [
      [source, destination],
      [sourceReport, report],
    ]) {
      if (path.resolve(from) === path.resolve(to)) continue;
      const tmp = path.join(path.dirname(to), `.reuse-${randomUUID()}.tmp`);
      temporary.push([tmp, to]);
      await copyFile(from, tmp);
    }
    await beforePublish();
    for (const [tmp, to] of temporary) await rename(tmp, to);
    return data;
  } finally {
    for (const [tmp] of temporary) await rm(tmp, { force: true });
  }
}

export async function rememberRender(root, key, destination, report, data) {
  const file = await outputFile(root, `.programmatic-video/cache/renders/${key}.json`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        schema_version: 1,
        key,
        file: path.relative(root, destination).replaceAll('\\', '/'),
        report: path.relative(root, report).replaceAll('\\', '/'),
        video_sha256: data.video_sha256,
        report_sha256: await hashFile(report),
      }),
    );
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
