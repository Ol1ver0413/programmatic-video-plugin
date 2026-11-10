import path from 'node:path';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { outputFile } from '../runtime/project.mjs';
import { projectFile, fileHash, saveJson } from './files.mjs';

export class FrameCache {
  constructor(root, signature) {
    this.root = root;
    this.signature = signature;
    this.entries = {};
  }
  key(time) {
    return createHash('sha256')
      .update(JSON.stringify({ ...this.signature, time }))
      .digest('hex');
  }
  async load() {
    try {
      this.entries =
        JSON.parse(
          await readFile(
            await projectFile(this.root, '.programmatic-video/cache/frames.json'),
            'utf8',
          ),
        ).entries ?? {};
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return this;
  }
  async get(key) {
    const item = this.entries[key];
    if (!item) return null;
    try {
      const file = await projectFile(this.root, item.file);
      if ((await fileHash(file)) === item.sha256) return { ...item, key };
    } catch {
      /* Missing/corrupt evidence is re-extracted. */
    }
    delete this.entries[key];
    return null;
  }
  async put(key, bytes) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const relative = `output/qa/.frames/${sha256}.png`;
    const file = await outputFile(this.root, relative);
    let valid = false;
    try {
      valid = (await fileHash(file)) === sha256;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!valid) {
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, bytes);
        await rename(tmp, file);
      } finally {
        await rm(tmp, { force: true });
      }
    }
    return (this.entries[key] = { file: relative, sha256 });
  }
  async save() {
    const file = await outputFile(this.root, '.programmatic-video/cache/frames.json');
    let current = {};
    try {
      current = JSON.parse(await readFile(file, 'utf8')).entries ?? {};
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await saveJson(file, { schema_version: 1, entries: { ...current, ...this.entries } });
  }
  relativeFile(out, item) {
    return path.relative(out, path.join(this.root, item.file)).replaceAll('\\', '/');
  }
}
