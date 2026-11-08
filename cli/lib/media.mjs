import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { run, probe, checkCues, parseJson } from '../runtime/project.mjs';
import { saveJson } from './files.mjs';
export const number = (value, name) => {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
export function newFile(file) {
  if (existsSync(file)) throw new Error(`Will not overwrite ${file}`);
}
export function audioDuration(file) {
  const info = probe(file);
  if (!info.streams.some((s) => s.codec_type === 'audio'))
    throw new Error('Input has no audio stream');
  const d = Number(info.format.duration);
  if (!Number.isFinite(d) || d <= 0) throw new Error('Cannot determine audio duration');
  return d;
}

export function parseCaptions(text, format) {
  let cues;
  if (format === '.json') cues = parseJson(text);
  else if (format === '.srt') {
    const time = (s) => {
      const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(s.trim());
      if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
        throw new Error(`Invalid SRT timestamp: ${s}`);
      return (
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
      );
    };
    cues = text
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n\s*\r?\n/)
      .filter(Boolean)
      .map((block) => {
        const lines = block.split(/\r?\n/);
        if (/^\d+$/.test(lines[0].trim())) lines.shift();
        const range = lines.shift().split(/\s+-->\s+/);
        if (range.length !== 2) throw new Error('Invalid SRT cue');
        return { start: time(range[0]), end: time(range[1]), text: lines.join('\n') };
      });
  } else throw new Error('Captions must be .srt or .json');
  const errors = checkCues(cues, Number.MAX_VALUE);
  if (errors.length) throw new Error(errors.join('\n'));
  return cues;
}
export function clipCaptions(cues, offset, duration) {
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(duration) || duration <= 0)
    throw new Error('offset must be nonnegative and duration positive');
  return cues
    .filter((c) => c.end > offset && c.start < offset + duration)
    .map((c) => ({
      start: Math.max(0, c.start - offset),
      end: Math.min(duration, c.end - offset),
      text: c.text,
    }));
}
export async function cutAudio(v) {
  if (!v.input || !v.out) throw new Error('audio requires --input and --out');
  const start = number(v.start ?? '0', 'start'),
    duration = number(v.duration, 'duration');
  if (start < 0 || duration <= 0)
    throw new Error('start must be nonnegative and duration positive');
  const input = path.resolve(v.input),
    out = path.resolve(v.out);
  newFile(out);
  newFile(out + '.source.json');
  if (path.extname(out).toLowerCase() !== '.wav')
    throw new Error(
      'Use a .wav output to preserve the selected audio without another lossy encoding',
    );
  if (start + duration > audioDuration(input) + 0.025)
    throw new Error('Selected interval exceeds the audio duration');
  await mkdir(path.dirname(out), { recursive: true });
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(start),
    '-i',
    input,
    '-t',
    String(duration),
    '-vn',
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  const actual = audioDuration(out);
  if (Math.abs(actual - duration) > 0.025)
    throw new Error('Output duration differs from the requested clip');
  await saveJson(out + '.source.json', {
    source_file: path.basename(input),
    source_sha256: createHash('sha256')
      .update(await readFile(input))
      .digest('hex'),
    start_seconds: start,
    duration_seconds: duration,
    verified_duration_seconds: actual,
  });
  return out;
}

export async function convertCaptions(values) {
  if (!values.input || !values.out) throw new Error('captions requires --input and --out');
  const out = path.resolve(values.out);
  newFile(out);
  const input = path.resolve(values.input);
  const cues = clipCaptions(
    parseCaptions(await readFile(input, 'utf8'), path.extname(input).toLowerCase()),
    number(values.offset ?? '0', 'offset'),
    number(values.duration, 'duration'),
  );
  await mkdir(path.dirname(out), { recursive: true });
  await saveJson(out, cues);
  return `Wrote ${cues.length} captions to ${out}`;
}

export function processAudio(values) {
  if (!values.mode || values.mode === 'cut') {
    if (['reference', 'windows', 'sample-rate'].some((name) => values[name] !== undefined))
      throw new Error('reference, windows and sample-rate require audio --mode locate or verify');
    return cutAudio(values);
  }
  if (!['locate', 'verify'].includes(values.mode))
    throw new Error('Audio mode must be cut, locate or verify');
  if (values.start !== undefined) throw new Error('start applies only to audio cut mode');
  const args = [];
  for (const name of ['mode', 'input', 'reference', 'out', 'windows', 'duration', 'sample-rate'])
    if (values[name] !== undefined) args.push('--' + name, values[name]);
  return JSON.parse(
    run(process.env.PROGRAMMATIC_VIDEO_PYTHON || 'python', [
      fileURLToPath(new URL('./audio-audit.py', import.meta.url)),
      ...args,
    ]),
  );
}
