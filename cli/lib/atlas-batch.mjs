import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { inspectAtlas, atlasRequestKey } from './atlas.mjs';
import { readJson, projectFile, fileHash } from './files.mjs';
import { applyProjectPatch, readPatch } from './project-operations.mjs';

export async function prepareAtlases(directory, items, { resume = false } = {}) {
  const root = await realpath(directory);
  if (!Array.isArray(items) || !items.length || items.length > 256)
    throw new Error('Atlas batch needs 1–256 items');
  const outputs = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.input !== 'string')
      throw new Error('Each atlas item needs an input');
    for (const name of [
      item.out || `output/qa/atlas-${path.parse(item.input).name}.json`,
      item.pack,
    ].filter(Boolean)) {
      if (outputs.has(name)) throw new Error(`Repeated atlas batch output: ${name}`);
      outputs.add(name);
    }
  }
  const results = [];
  for (const [index, item] of items.entries()) {
    const reportPath = item.out || `output/qa/atlas-${path.parse(item.input).name}.json`;
    try {
      let cached;
      if (resume) {
        try {
          const report = await readJson(await projectFile(root, reportPath));
          if (
            report.request_key !== (await atlasRequestKey(root, item)) ||
            (await fileHash(await projectFile(root, report.input))) !== report.sha256
          )
            throw new Error('Existing atlas belongs to different or changed inputs');
          cached = report;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (cached) {
        if (item.register)
          await applyProjectPatch(root, { assets: { [item.register]: cached.input } });
        results.push({
          report: reportPath,
          reused: true,
          frames: cached.frames.length,
          ...(item.register ? { registered: item.register } : {}),
        });
      } else results.push({ ...(await inspectAtlas(root, item)), reused: false });
    } catch (error) {
      throw new Error(
        `Atlas batch stopped at item ${index + 1}: ${error.message}. Completed reports: ${JSON.stringify(results.map((r) => r.report))}. Retry the same batch with --resume.`,
      );
    }
  }
  return {
    items: results,
    prepared: results.filter((r) => !r.reused).length,
    reused: results.filter((r) => r.reused).length,
  };
}

export async function processAtlas(directory, values) {
  if (!values.batch) {
    if (values.resume) throw new Error('atlas --resume requires --batch');
    return inspectAtlas(directory, values);
  }
  if (
    [
      'input',
      'layout',
      'columns',
      'rows',
      'out',
      'pack',
      'padding',
      'register',
      'alpha-threshold',
    ].some((key) => values[key] !== undefined)
  )
    throw new Error('Batch items contain their own input/layout/output options');
  return prepareAtlases(directory, await readPatch(directory, values.batch), {
    resume: values.resume,
  });
}
