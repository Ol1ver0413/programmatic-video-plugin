// The callers validate user evidence and source-project completion before promotion.
export function upsertPreference(memory, preference) {
  const previous = memory.preferences.find((item) => item.key === preference.key);
  if (previous?.value === preference.value && previous?.evidence === preference.evidence)
    return memory;
  return {
    ...memory,
    preferences: memory.preferences
      .filter((item) => item.key !== preference.key)
      .concat(preference),
    history: memory.history.concat({ ...preference, previousValue: previous?.value || null }),
  };
}
