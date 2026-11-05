// CLI lifecycle hook. Called by `finish` after validating its delivery and review;
// this is not a host event registered in hooks.json.
export function videoFinished({memory, project, title, review, reviewHash, completedAt}) {
  const next = structuredClone(memory);
  const previousVideo = next.videos.find(item => item.project === project);
  // Retrying an old delivery must not undo preferences updated since that delivery.
  if(previousVideo?.reviewHash === reviewHash) return next;
  for(const {key, value, evidence} of review.preferences) {
    const previous = next.preferences.find(item => item.key === key);
    if(previous?.value === value && previous?.evidence === evidence) continue;
    const preference = {key, value, evidence, sourceProject:title, updatedAt:completedAt};
    next.preferences = next.preferences.filter(item => item.key !== key).concat(preference);
    next.history.push({...preference, previousValue:previous?.value || null});
  }
  const video = {project, title, style:review.style, lessons:review.lessons,
    feedback:review.feedback, reviewHash, updatedAt:completedAt};
  next.videos = next.videos.filter(item => item.project !== project).concat(video);
  return next;
}
