import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCaptions } from '../cli/lib/captions.mjs';
import { inspectPixels } from '../cli/lib/atlas.mjs';
import { createAtlas, drawSprite, frameAt, valueAt } from '../cli/runtime/sprites.mjs';
import { timeMapping, readTimeMapping, mapTime } from '../cli/runtime/timing.mjs';
import { run, toSrt } from '../cli/runtime/project.mjs';

const cli = fileURLToPath(new URL('../cli/programmatic-video.mjs', import.meta.url));
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
const available = ['ffmpeg', 'ffprobe'].every((exe) => spawnSync(exe, ['-version'], { windowsHide: true }).status === 0);
const numpy = spawnSync(process.env.PROGRAMMATIC_VIDEO_PYTHON || 'python', ['-c', 'import numpy'], { windowsHide: true }).status === 0;
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-pipeline-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('programmatic-video-pipeline-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('LRC keeps repeated timestamps and translations, respects blank gaps and source offsets', () => {
  const cues = parseCaptions('[ar:test]\n[offset:+500]\n[00:00.20]crossing\n[00:01.00][00:03.00]repeat\n[00:01.00]translation\n[00:02.00]\n[00:05.00]outside', '.lrc', { end: 4 });
  assert.deepEqual(cues, [
    { start: 0, end: .5, text: 'crossing' },
    { start: .5, end: 1.5, text: 'repeat\ntranslation' },
    { start: 2.5, end: 4, text: 'repeat' },
  ]);
  assert.throws(() => parseCaptions('[00:01]last', '.lrc'), /source end/);
  assert.throws(() => parseCaptions('[00:61]bad', '.lrc', { end: 70 }), /timestamp/);
  assert.throws(() => parseCaptions('[00:xx]bad', '.lrc', { end: 3 }), /timestamp/);
  assert.deepEqual(parseCaptions('[offset:-500]\n[00:01.00]delayed\n[00:02.00]', '.lrc', { end: 3 }),
    [{ start: 1.5, end: 2.5, text: 'delayed' }]);
});

test('time mappings preserve clip origins and reject retiming or invalid intervals', () => {
  const source = timeMapping(71.1, 97.1);
  assert.ok(Math.abs(mapTime(80.2, source) - 9.1) < 1e-10);
  const sample = timeMapping(9.1, 12.83);
  assert.ok(Math.abs(mapTime(mapTime(80.2, source), sample)) < 1e-10);
  assert.deepEqual(readTimeMapping({ time_mapping: sample }), sample);
  assert.throws(() => readTimeMapping({ ...sample, output_end_seconds: 9 }), /preserve duration/);
  assert.throws(() => timeMapping(-1, 2), /nonnegative/);
  assert.throws(() => timeMapping(1, 1), /positive/);
});

test('explicit uneven/polygon atlas regions preserve the shared origin through flipped rotation', () => {
  const pixels = Buffer.alloc(8 * 4 * 4);
  for (const [x, y] of [[1, 1], [2, 2], [3, 3], [6, 1], [7, 2]]) pixels[(y * 8 + x) * 4 + 3] = 255;
  const metadata = inspectPixels(pixels, 8, 4, 2, 1, 180, { reference_height: 2, frames: [
    { region: [0, 0, 3, 4], anchor: [1, 3], anchors: { hand: [2, 1] } },
    { polygon: [[5, 0], [8, 0], [8, 4], [5, 4]], anchor: [6, 3] },
  ] });
  assert.deepEqual(metadata.frames[0].box, [1, 1, 2, 2]);
  assert.equal(metadata.frames[0].boundary_occupancy.right, 1);
  assert.equal(metadata.frames[0].anchor_origin, 'explicit');
  assert.deepEqual(metadata.frames[1].region, [5, 0, 3, 4]);
  const calls = [], ctx = { globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    drawImage(...args) { calls.push(args); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {} };
  const atlas = createAtlas({ width: 8, height: 4 }, metadata);
  const actor = drawSprite(ctx, atlas, 0, { x: 10, y: 20, height: 4, flip: true, rotation: Math.PI / 2 });
  assert.ok(Math.abs(actor.point('hand').x - 14) < 1e-10);
  assert.ok(Math.abs(actor.point('hand').y - 18) < 1e-10);
  assert.deepEqual(actor.point([1, 3]), { x: 10, y: 20 });
  assert.deepEqual(calls[0].slice(1), [0, 0, 3, 4, -1, -3, 3, 4]);
  assert.throws(() => actor.point('unknown'), /source point/);
  assert.throws(() => createAtlas({ width: 9, height: 4 }, metadata), /dimensions/);
  assert.throws(() => inspectPixels(pixels, 8, 4, 2, 1, 180, { frames: [{}] }), /grid count/);
  assert.throws(() => inspectPixels(pixels, 8, 4, 1, 1, 180, { frames: [{ region: [7, 0, 2, 4] }] }), /inside/);
});

test('pose selection and key-value interpolation are deterministic at boundaries', () => {
  assert.equal(frameAt(.16, [[0, 2], [.16, 5], [.5, 3]]), 5);
  assert.equal(frameAt(-1, [[0, 2], [.16, 5]]), 2);
  assert.equal(valueAt(.5, [[0, 0], [1, 10]]), 5);
  assert.equal(valueAt(3, [[0, 0], [1, 10]]), 10);
  assert.throws(() => valueAt(1, [[0, 0], [0, 2]]), /increasing/);
});

test('captions CLI consumes reusable audio/sample maps and preserves existing output', async (t) => {
  const root = await directory(t), source = path.join(root, 'words.lrc'),
    mapping = path.join(root, 'sample.report.json'), out = path.join(root, 'captions.json');
  await writeFile(source, '[00:00.00]before\n[00:01.00]first\n[00:02.00]second\n[00:03.00]after');
  await writeFile(mapping, JSON.stringify({ time_mapping: timeMapping(1.5, 2.5) }));
  const result = invoke('captions', '--input', source, '--map', mapping, '--out', out);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), [
    { start: 0, end: .5, text: 'first' }, { start: .5, end: 1, text: 'second' },
  ]);
  assert.equal(invoke('captions', '--input', source, '--map', mapping, '--duration', '1', '--out', path.join(root, 'conflict.json')).status, 1);
  assert.equal(invoke('captions', '--input', source, '--map', mapping, '--out', out).status, 1);
});

test('encoded media checks detect wrong specs, changed sidecars and short audio references without rewriting exports',
  { skip: !available || !numpy }, async (t) => {
    const root = await directory(t); await mkdir(path.join(root, 'output'));
    const reference = path.join(root, 'tone.wav'), video = path.join(root, 'output/video.mp4');
    run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', reference]);
    run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=8:d=1',
      '-i', reference, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', video]);
    const cues = [{ start: .1, end: .9, text: 'test' }];
    const project = { width: 32, height: 32, logicalWidth: 32, logicalHeight: 32,
      fps: 8, duration: 1, audio: 'tone.wav', captions: 'captions.json', assets: {},
      scenes: [{ id: 'one', start: 0, end: 1 }] };
    const config = path.join(root, 'project.json'), captions = path.join(root, 'output/captions.srt');
    await writeFile(config, JSON.stringify(project));
    await writeFile(path.join(root, 'captions.json'), JSON.stringify(cues));
    await writeFile(captions, toSrt(cues));
    await writeFile(path.join(root, 'baseline.srt'), toSrt(cues));
    const bytes = await readFile(video);
    const check = (...extra) => invoke('validate', '--project', root, '--input', 'output/video.mp4', ...extra);
    let result = check('--reference-audio', 'tone.wav', '--reference-captions', 'baseline.srt');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    let report = JSON.parse(await readFile(path.join(root, JSON.parse(result.stdout).report), 'utf8'));
    assert.equal(report.checks.captions.byte_identical_to_reference, true);
    assert.ok(report.checks.audio.correlation > .98);
    project.width = project.height = 64; await writeFile(config, JSON.stringify(project));
    result = check(); assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error) => error.includes('width')));
    project.width = project.height = 32; await writeFile(config, JSON.stringify(project));
    await writeFile(captions, toSrt([{ ...cues[0], text: 'changed' }]));
    result = check(); assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error) => error.includes('Caption')));
    assert.match(await readFile(captions, 'utf8'), /changed/);
    await writeFile(captions, toSrt(cues));
    run('ffmpeg', ['-v', 'error', '-i', reference, '-t', '0.1', path.join(root, 'short.wav')]);
    result = check('--reference-audio', 'short.wav'); assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error) => error.includes('durations')));
    assert.deepEqual(await readFile(video), bytes);
    const packets = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_packets', '-show_entries', 'packet=pos,size,flags', '-of', 'json', video])).packets;
    const packet = packets.find((item) => !item.flags.includes('K') && Number(item.size) > 6);
    assert.ok(packet, 'Fixture must contain a non-key packet');
    const damaged = Buffer.from(bytes), at = Number(packet.pos), size = Number(packet.size);
    damaged.fill(255, at + 5, at + size);
    await writeFile(path.join(root, 'output/damaged.mp4'), damaged);
    const damagedResult = invoke('validate', '--project', root, '--input', 'output/damaged.mp4');
    assert.equal(damagedResult.status, 1, damagedResult.stdout + damagedResult.stderr);
    assert.equal(check('--playback').status, 1);
  });
