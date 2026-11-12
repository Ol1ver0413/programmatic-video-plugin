import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { run, probe } from '../runtime/project.mjs';
import { saveJson, readJson, fileHash } from './files.mjs';
import { timeMapping, readTimeMapping } from '../runtime/timing.mjs';
import { shiftCaptions } from '../runtime/captions.mjs';
import { parseCaptions, clipCaptions, alignCaptionText } from './captions.mjs';
export { parseCaptions, clipCaptions } from './captions.mjs';
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

export async function cutAudio(v) {
  if (!v.input || !v.out) throw new Error('audio requires --input and --out');
  const start = number(v.start ?? '0', 'start'),
    duration = number(v.duration, 'duration');
  if (start < 0 || duration <= 0)
    throw new Error('start must be nonnegative and duration positive');
  const fadeIn = number(v['fade-in'] ?? 0, 'fade-in'),
    fadeOut = number(v['fade-out'] ?? 0, 'fade-out');
  if (fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration)
    throw new Error('Audio fades must be nonnegative and together fit the clip');
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
    ...(fadeIn || fadeOut
      ? [
          '-af',
          [
            fadeIn ? `afade=t=in:st=0:d=${fadeIn}` : '',
            fadeOut ? `afade=t=out:st=${duration - fadeOut}:d=${fadeOut}` : '',
          ]
            .filter(Boolean)
            .join(','),
        ]
      : []),
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
    source_sha256: await fileHash(input),
    start_seconds: start,
    duration_seconds: duration,
    verified_duration_seconds: actual,
    time_mapping: timeMapping(start, start + duration),
    edits: { fade_in_seconds: fadeIn, fade_out_seconds: fadeOut, speed: 1 },
  });
  return out;
}

export async function convertCaptions(values) {
  if (!values.input || !values.out) throw new Error('captions requires --input and --out');
  const out = path.resolve(values.out);
  newFile(out);
  const input = path.resolve(values.input);
  if (values.map && (values.offset !== undefined || values.duration !== undefined))
    throw new Error('Choose --map or --offset/--duration');
  const mapping = values.map
    ? readTimeMapping(await readJson(path.resolve(values.map)))
    : timeMapping(
        number(values.offset ?? '0', 'offset'),
        number(values.offset ?? '0', 'offset') + number(values.duration, 'duration'),
      );
  let cues = shiftCaptions(
    clipCaptions(
      parseCaptions(await readFile(input, 'utf8'), path.extname(input).toLowerCase(), {
        end: mapping.source_end_seconds,
      }),
      mapping.source_start_seconds,
      mapping.source_end_seconds - mapping.source_start_seconds,
    ),
    mapping.output_start_seconds,
  );
  let alignment;
  if (values.text) {
    alignment = alignCaptionText(cues, await readFile(path.resolve(values.text), 'utf8'));
    if (alignment.unmatched.length)
      throw new Error(
        `Supplied text does not match timed rows: ${JSON.stringify(alignment.unmatched)}. Provide corrected timed input; no caption output written.`,
      );
    cues = alignment.cues;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await saveJson(out, cues);
  return {
    file: out,
    captions: cues.length,
    time_mapping: mapping,
    ...(alignment
      ? {
          alignment: {
            matched: cues.length,
            unused_text_lines: alignment.unused_lines,
            method:
              'Ordered normalized text matching against existing timestamps; not speech alignment',
          },
        }
      : {}),
  };
}

export function auditAudio(values) {
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

export function processAudio(values) {
  if (!values.mode || values.mode === 'cut') {
    if (['reference', 'windows', 'sample-rate'].some((name) => values[name] !== undefined))
      throw new Error('reference, windows and sample-rate require audio --mode locate or verify');
    return cutAudio(values);
  }
  if (!['locate', 'verify'].includes(values.mode))
    throw new Error('Audio mode must be cut, locate or verify');
  if (['start', 'fade-in', 'fade-out'].some((key) => values[key] !== undefined))
    throw new Error('start and fades apply only to audio cut mode');
  if (!values.out) throw new Error('Audio evidence requires --out REPORT.json');
  return auditAudio(values);
}
