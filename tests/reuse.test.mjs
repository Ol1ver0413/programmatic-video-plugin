import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { inspectPixels } from '../cli/lib/atlas.mjs';
import { run } from '../cli/runtime/project.mjs';

const cli = fileURLToPath(new URL('../cli/programmatic-video.mjs', import.meta.url));
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
const available = ['ffmpeg', 'ffprobe'].every((exe) => spawnSync(exe, ['-version'], { windowsHide: true }).status === 0);
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-reuse-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('programmatic-video-reuse-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('atlas evidence supports uneven image grids, empty cells and opaque styles without inventing feet', () => {
  const pixels = Buffer.alloc(5 * 3 * 4);
  pixels[(1 * 5 + 1) * 4 + 3] = 255;
  const result = inspectPixels(pixels, 5, 3, 2, 1);
  assert.deepEqual(result.frames[0].box, [1, 1, 1, 1]);
  assert.deepEqual(result.frames[0].anchor, [1, 1]);
  assert.deepEqual(result.frames[1].cell, [2, 0, 3, 3]);
  assert.equal(result.frames[1].empty, true);
  assert.match(result.limitation, /not detected feet/);
  assert.equal(inspectPixels(Buffer.alloc(16, 255), 2, 2, 1, 1).alpha_clear_fraction, 0);
  assert.throws(() => inspectPixels(pixels, 5, 3, NaN, 1), /positive integer/);
});

test('atlas CLI reads real alpha pixels and preserves an existing report', { skip: !available }, async (t) => {
  const root = await directory(t);
  await mkdir(path.join(root, 'assets'));
  const pixels = Buffer.alloc(8 * 4 * 4);
  for (const [x, y] of [[1, 1], [2, 2], [5, 0], [6, 3]]) pixels[(y * 8 + x) * 4 + 3] = 255;
  await writeFile(path.join(root, 'pixels.rgba'), pixels);
  run('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '8x4', '-i', path.join(root, 'pixels.rgba'), '-frames:v', '1', path.join(root, 'assets/sheet.png')]);
  const result = invoke('atlas', '--project', root, '--input', 'assets/sheet.png', '--columns', '2', '--rows', '1');
  assert.equal(result.status, 0, result.stderr);
  const report = path.join(root, JSON.parse(result.stdout).report);
  const bytes = await readFile(report);
  const metadata = JSON.parse(bytes);
  assert.deepEqual(metadata.frames.map((frame) => frame.box), [[1, 1, 2, 2], [5, 0, 2, 4]]);
  assert.equal(metadata.alpha_clear_fraction, 28 / 32);
  assert.equal(invoke('atlas', '--project', root, '--input', 'assets/sheet.png', '--columns', '2', '--rows', '1').status, 1);
  assert.deepEqual(await readFile(report), bytes);
});

const python = process.env.PROGRAMMATIC_VIDEO_PYTHON || 'python';
const numpy = spawnSync(python, ['-c', 'import numpy'], { windowsHide: true }).status === 0;
test('audio locate finds a known excerpt; verify exposes partial coverage and refuses silent evidence', { skip: !available || !numpy }, async (t) => {
  const root = await directory(t);
  const raw = Buffer.alloc(4 * 8000 * 2);
  let seed = 127;
  for (let i = 0; i < raw.length / 2; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; raw.writeInt16LE((seed % 20001) - 10000, i * 2); }
  await writeFile(path.join(root, 'noise.pcm'), raw);
  const source = path.join(root, 'source.wav'), excerpt = path.join(root, 'excerpt.wav');
  run('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', '8000', '-ac', '1', '-i', path.join(root, 'noise.pcm'), source]);
  run('ffmpeg', ['-v', 'error', '-ss', '1', '-i', source, '-t', '1.5', '-c:a', 'pcm_s16le', excerpt]);
  const out = path.join(root, 'match.json');
  let result = invoke('audio', '--mode', 'locate', '--input', source, '--reference', excerpt, '--out', out, '--duration', '0.4');
  assert.equal(result.status, 0, result.stderr);
  let evidence = JSON.parse(result.stdout);
  assert.ok(Math.abs(evidence.candidate_origin_seconds - 1) < 1 / 8000);
  assert.ok(evidence.matches.every((match) => match.correlation > 0.999));
  assert.equal(invoke('audio', '--mode', 'locate', '--input', source, '--reference', excerpt, '--out', out).status, 1);
  result = invoke('audio', '--mode', 'verify', '--input', excerpt, '--reference', excerpt, '--out', path.join(root, 'verify.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).correlation > 0.999);
  result = invoke('audio', '--mode', 'verify', '--input', excerpt, '--reference', source, '--out', path.join(root, 'coverage.json'));
  evidence = JSON.parse(result.stdout);
  assert.equal(evidence.reference_coverage, 1.5 / 4);
  assert.match(evidence.limitation, /not word/);
  const silent = path.join(root, 'silent.wav');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', silent]);
  assert.equal(invoke('audio', '--mode', 'verify', '--input', silent, '--reference', silent, '--out', path.join(root, 'silent.json')).status, 1);
  assert.equal(invoke('audio', '--mode', 'locate', '--input', silent, '--reference', excerpt, '--duration', '0.4', '--out', path.join(root, 'silent-locate.json')).status, 1);
  assert.equal(invoke('audio', '--mode', 'verify', '--input', excerpt, '--reference', excerpt, '--out', path.join(root, 'wrong.wav')).status, 1);
});
