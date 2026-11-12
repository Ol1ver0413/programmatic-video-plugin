import { checkCues, parseJson } from '../runtime/project.mjs';
import { captionUtterances, shiftCaptions } from '../runtime/captions.mjs';

function parseLrc(text, end) {
  if (!Number.isFinite(end) || end <= 0)
    throw new Error('LRC needs a positive source end time (offset + duration, or --map)');
  const offsetTags = [...text.matchAll(/\[offset:([+-]?\d+)\]/gi)];
  const offset = offsetTags.length ? Number(offsetTags.at(-1)[1]) / 1000 : 0;
  const events = new Map();
  for (const line of text.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
    if (!stamps.length) {
      if (/^\[\d+:/.test(line)) throw new Error(`Invalid LRC timestamp: ${line.split(']')[0]}`);
      continue;
    }
    const value = line.slice(stamps.at(-1).index + stamps.at(-1)[0].length).trim();
    for (const stamp of stamps) {
      if (Number(stamp[2]) >= 60) throw new Error(`Invalid LRC timestamp: ${stamp[0]}`);
      // The LRC header advances lyric playback: a positive offset moves cues earlier.
      const at = Number(stamp[1]) * 60 + Number(stamp[2]) - offset;
      const rows = events.get(at) ?? [];
      if (value && !rows.includes(value)) rows.push(value);
      events.set(at, rows);
    }
  }
  const rows = [...events].sort((a, b) => a[0] - b[0]);
  return rows.flatMap(([start, lines], index) => {
    const stop = Math.min(rows[index + 1]?.[0] ?? end, end);
    return lines.length && stop > Math.max(0, start)
      ? [{ start: Math.max(0, start), end: stop, text: lines.join('\n') }]
      : [];
  });
}

export function parseCaptions(text, format, { end } = {}) {
  text = text.replace(/^\uFEFF/, '');
  let cues;
  if (format === '.json') cues = parseJson(text);
  else if (format === '.lrc') cues = parseLrc(text, end);
  else if (format === '.srt') {
    const time = (value) => {
      const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
      if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
        throw new Error(`Invalid SRT timestamp: ${value}`);
      return (
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
      );
    };
    cues = text
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
  } else throw new Error('Captions must be .srt, .json or .lrc');
  const errors = checkCues(cues, Number.MAX_VALUE);
  if (errors.length) throw new Error(errors.join('\n'));
  return cues;
}

export function clipCaptions(cues, offset, duration) {
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(duration) || duration <= 0)
    throw new Error('offset must be nonnegative and duration positive');
  const clipped = cues
    .filter((cue) => cue.end > offset && cue.start < offset + duration)
    .flatMap((cue) => {
      const next = structuredClone(cue);
      const rows = captionUtterances(cue);
      if (rows.length) {
        const lines = cue.text.split(/\r?\n/);
        const selected = rows
          .map((row, index) => ({
            row,
            line: lines.length === rows.length ? lines[index] : row.text,
          }))
          .filter(({ row }) => row.end > offset && row.start < offset + duration);
        if (!selected.length) return [];
        next.utterances = selected.map(({ row }) => row);
        next.speakers = [...new Set(next.utterances.map((row) => row.speaker))];
        if (!next.speakers.includes(next.speaker)) next.speaker = next.speakers[0];
        if (selected.length !== rows.length)
          next.text = selected.map(({ line }) => line).join('\n');
      }
      return [next];
    });
  return shiftCaptions(clipped, -offset).map((cue) => ({
    ...cue,
    start: Math.max(0, cue.start),
    end: Math.min(duration, cue.end),
    ...(cue.utterances
      ? {
          utterances: cue.utterances.map((row) => ({
            ...row,
            start: Math.max(0, row.start),
            end: Math.min(duration, row.end),
          })),
        }
      : {}),
  }));
}

export function alignCaptionText(cues, text) {
  const normalize = (value) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase('en')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Supplied caption text is empty');
  let cursor = 0;
  const matched = [],
    unmatched = [],
    used = new Set();
  for (const cue of cues) {
    const key = normalize(cue.text);
    const index = lines.findIndex((line, i) => i >= cursor && normalize(line) === key);
    if (!key || index < 0) unmatched.push({ start: cue.start, end: cue.end, text: cue.text });
    else {
      if (cue.utterances?.length)
        throw new Error(
          'Use corrected timed JSON for utterance text; plain text cannot assign overlapping speech',
        );
      matched.push({ ...cue, text: lines[index] });
      cursor = index + 1;
      used.add(index);
    }
  }
  return {
    cues: matched,
    unmatched,
    unused_lines: lines.flatMap((line, i) => (used.has(i) ? [] : [{ line: i + 1, text: line }])),
  };
}
