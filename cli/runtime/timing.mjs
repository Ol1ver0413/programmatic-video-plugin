export function timeMapping(sourceStart, sourceEnd, outputStart = 0) {
  if (
    ![sourceStart, sourceEnd, outputStart].every(Number.isFinite) ||
    sourceStart < 0 ||
    sourceEnd <= sourceStart ||
    outputStart < 0
  )
    throw new Error('Time mapping needs nonnegative starts and a positive source interval');
  return {
    source_start_seconds: sourceStart,
    source_end_seconds: sourceEnd,
    output_start_seconds: outputStart,
    output_end_seconds: outputStart + sourceEnd - sourceStart,
  };
}

export function readTimeMapping(record) {
  const value = record?.time_mapping ?? record;
  const mapping = timeMapping(
    value?.source_start_seconds,
    value?.source_end_seconds,
    value?.output_start_seconds ?? 0,
  );
  if (
    value.output_end_seconds !== undefined &&
    (!Number.isFinite(value.output_end_seconds) ||
      Math.abs(value.output_end_seconds - mapping.output_end_seconds) > 1e-7)
  )
    throw new Error('Time mapping must preserve duration; retimed media needs a separate mapping');
  return mapping;
}

export function mapTime(seconds, mapping) {
  if (!Number.isFinite(seconds)) throw new Error('Time must be finite');
  return seconds - mapping.source_start_seconds + mapping.output_start_seconds;
}
