// CLI lifecycle hook. Called by `finish` after validating its delivery and review;
// this is not a host event registered in hooks.json.
import {upsertPreference} from '../skills/using-pixel-video/scripts/preferences.mjs';

export function videoFinished({memory, project, title, review, reviewHash, completedAt}) {
  let next = structuredClone(memory);
  const previousVideo = next.videos.find(item => item.project === project);
  // Retrying an old delivery must not undo preferences updated since that delivery.
  if(previousVideo?.reviewHash === reviewHash) return next;
  for(const {key, value, evidence} of review.preferences) {
    next = upsertPreference(next, {key, value, evidence, sourceProject:title, updatedAt:completedAt});
  }
  const video = {project, title, style:review.style, lessons:review.lessons,
    feedback:review.feedback, reviewHash, updatedAt:completedAt};
  next.videos = next.videos.filter(item => item.project !== project).concat(video);
  return next;
}
