#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { repoRoot, run } from './version.mjs';
import { pack } from './release.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-package-check-'));
if (
  path.dirname(temporary) !== os.tmpdir() ||
  !path.basename(temporary).startsWith('programmatic-video-package-check-')
) {
  throw new Error('Unexpected package test directory');
}
try {
  const archive = await pack(repoRoot, temporary);
  run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', archive, '-C', temporary]);
  const result = run(
    process.execPath,
    [path.join(repoRoot, 'tests/package-smoke.mjs'), path.join(temporary, 'package')],
    temporary,
  );
  process.stdout.write(result.stdout);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
