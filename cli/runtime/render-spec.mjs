export function renderSpec(project, { profile = 'final' } = {}) {
  if (!['draft', 'final'].includes(profile))
    throw new Error('Render profile must be draft or final');
  let scale = project.width / project.logicalWidth;
  if (profile === 'draft' && project.width > 960) {
    if (project.pixelArt !== false) {
      scale = Math.max(1, Math.floor(960 / project.logicalWidth));
      if ((project.logicalWidth * scale) % 2 || (project.logicalHeight * scale) % 2) scale++;
    } else {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const divisor = gcd(project.width, project.height);
      const unitW = project.width / divisor,
        unitH = project.height / divisor;
      let units = Math.max(1, Math.floor(960 / unitW));
      if ((unitW * units) % 2 || (unitH * units) % 2) units--;
      scale = (Math.max(2, units) * unitW) / project.logicalWidth;
    }
    scale = Math.min(project.width / project.logicalWidth, scale);
  }
  return {
    profile,
    width: Math.round(project.logicalWidth * scale),
    height: Math.round(project.logicalHeight * scale),
    fps: project.fps,
    preset: profile === 'draft' ? 'veryfast' : 'medium',
    crf: profile === 'draft' ? 25 : 19,
  };
}
