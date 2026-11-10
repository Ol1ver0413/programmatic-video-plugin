import { probe, run } from './project.mjs';

export function verifyEncoded(file, { width, height, fps, frames, duration, hasAudio }) {
  const info = probe(file),
    video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  const [numerator, denominator = '1'] = String(video?.r_frame_rate).split('/');
  const actualFps = Number(numerator) / Number(denominator);
  if (
    !video ||
    Boolean(audio) !== hasAudio ||
    video.width !== width ||
    video.height !== height ||
    Number(video.nb_frames) !== frames ||
    !Number.isFinite(actualFps) ||
    Math.abs(actualFps - fps) > 1e-6 ||
    !Number.isFinite(Number(info.format.duration)) ||
    Math.abs(Number(info.format.duration) - duration) > 1 / fps + 0.025
  )
    throw new Error('Exported media does not match the project');
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
  return { info, video, audio };
}
