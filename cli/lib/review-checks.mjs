export const commonChecks = [
  [
    'media',
    'Validate encoded dimensions, timing, frames, audio presence and full decoding.',
    'cli',
  ],
  [
    'content',
    'Compare visible events and progression with the brief and reviewed scope; assess purposeful versus accidental repetition, information gaps and setup/payoff. Intentional quiet or static content is valid.',
    'visual',
  ],
  [
    'composition',
    'Check framing, unintended cuts, occlusion, text readability and safe areas.',
    'visual',
  ],
  [
    'continuity',
    'Check identity, proportions, object state and neighboring scene transitions where present.',
    'visual',
  ],
  [
    'motion',
    'Where motion is intended, inspect action phases, contact and registration; intentional stillness is valid.',
    'visual',
  ],
  [
    'sound-captions',
    'Where present, check audio/caption content, timing and burned-in text separately from sidecars.',
    'multimodal',
  ],
].map(([id, text, method]) => ({ id: 'common:' + id, kind: 'common', text, method }));

export function reviewRequirements(project, sceneIds) {
  return (project.review?.requirements ?? []).filter(
    (item) => !item.scenes?.length || item.scenes.some((id) => sceneIds.includes(id)),
  );
}

export function reviewChecks(project, sceneIds) {
  return [
    ...commonChecks,
    ...reviewRequirements(project, sceneIds).map((item) => ({
      ...item,
      id: 'user:' + item.id,
      kind: 'user',
      method: 'requirement',
    })),
  ];
}
