// Pure caption metadata: usable by Node tools and browser scene code.
const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());

export function captionUtterances(cue) {
  if (!cue) return [];
  if (cue.speaker !== undefined && !nonempty(cue.speaker))
    throw new Error('Caption speaker must be nonempty text');
  if (
    cue.speakers !== undefined &&
    (!Array.isArray(cue.speakers) || cue.speakers.some((name) => !nonempty(name)))
  )
    throw new Error('Caption speakers must be an array of names');
  if (cue.utterances === undefined) return [];
  if (!Array.isArray(cue.utterances) || !cue.utterances.length)
    throw new Error('Caption utterances must be a nonempty array');
  const lines = typeof cue.text === 'string' ? cue.text.split(/\r?\n/) : [];
  if (lines.length !== cue.utterances.length && cue.utterances.some((row) => !nonempty(row?.text)))
    throw new Error('Caption utterances need explicit text or one matching caption line each');
  let previous = -Infinity;
  return cue.utterances.map((row, index) => {
    if (
      !row ||
      !nonempty(row.speaker) ||
      !Number.isFinite(row.start) ||
      !Number.isFinite(row.end) ||
      row.start < cue.start - 1e-6 ||
      row.end > cue.end + 1e-6 ||
      row.end <= row.start ||
      row.start < previous
    )
      throw new Error('Caption utterance needs a speaker and ordered times inside its cue');
    const text = row.text ?? lines[index];
    if (!nonempty(text)) throw new Error('Caption utterance text must be nonempty');
    previous = row.start;
    return {
      ...structuredClone(row),
      text: row.text === undefined ? text.replace(/^\s*-\s+/, '') : text,
    };
  });
}

export function captionRowsAt(cue, time) {
  if (!Number.isFinite(time)) throw new Error('Caption time must be finite');
  if (!cue || time < cue.start || time >= cue.end) return [];
  const rows = captionUtterances(cue);
  return (rows.length ? rows : [cue]).map((row) => ({
    speaker: row.speaker,
    text: row.text,
    start: row.start,
    end: row.end,
    visible: time >= row.start,
    active: time >= row.start && time < row.end,
  }));
}

export function shiftCaptions(cues, seconds) {
  if (!Array.isArray(cues) || !Number.isFinite(seconds))
    throw new Error('Caption shifting needs an array and a finite offset');
  return cues.map((cue) => ({
    ...structuredClone(cue),
    start: cue.start + seconds,
    end: cue.end + seconds,
    ...(cue.utterances
      ? {
          utterances: cue.utterances.map((row) => ({
            ...structuredClone(row),
            start: row.start + seconds,
            end: row.end + seconds,
          })),
        }
      : {}),
  }));
}
