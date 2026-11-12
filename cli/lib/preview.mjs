import path from 'node:path';
import { readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { outputFile, probe } from '../runtime/project.mjs';
import { readJson, projectFile } from './files.mjs';

const marker = '<!-- programmatic-video:encoded-preview -->';
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

export async function prepareVideoPreview(
  directory,
  { input, compare, out = 'output/previews/viewer.html' } = {},
) {
  if (!input) throw new Error('Encoded preview requires --input VIDEO');
  if (path.extname(out).toLowerCase() !== '.html')
    throw new Error('Preview output must be an HTML page');
  const root = await realpath(directory),
    project = await readJson(await projectFile(root, 'project.json'));
  const destination = await outputFile(root, out);
  let previous;
  try {
    previous = await readFile(destination, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous !== undefined && !previous.startsWith(marker))
    throw new Error('Preview output exists and is not tool-managed; choose another --out path');
  const videos = [];
  for (const file of [input, compare].filter(Boolean)) {
    const actual = await projectFile(root, file),
      info = probe(actual),
      video = info.streams.find((stream) => stream.codec_type === 'video');
    if (
      !video ||
      !Number.isFinite(Number(info.format.duration)) ||
      Number(info.format.duration) <= 0
    )
      throw new Error('Preview input must be a playable video');
    videos.push({
      input: file,
      width: video.width,
      height: video.height,
      duration: Number(info.format.duration),
      href: path
        .relative(path.dirname(destination), actual)
        .split(path.sep)
        .map(encodeURIComponent)
        .join('/'),
    });
  }
  const cards = videos
    .map(
      (video, index) =>
        `<section><h2>${index ? 'Comparison' : 'Current video'}</h2><video controls playsinline preload="metadata"${index ? ' muted' : ''} src="${escapeHtml(video.href)}"></video><p class="metadata">${video.width} × ${video.height} · ${video.duration.toFixed(2)} s</p><a href="${escapeHtml(video.href)}" download>Download ${escapeHtml(path.basename(video.input))}</a></section>`,
    )
    .join('\n');
  const template = await readFile(new URL('../../templates/preview.html', import.meta.url), 'utf8');
  const substitutions = {
    __TITLE__: escapeHtml(project.title || 'Video preview'),
    __VIDEOS__: cards,
    __COMPARE__:
      videos.length > 1
        ? '<button id="play-together" type="button">Play both from start</button>'
        : '',
  };
  const html =
    marker +
    '\n' +
    template.replace(/__TITLE__|__VIDEOS__|__COMPARE__/g, (key) => substitutions[key]);
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    if (previous !== html) {
      await writeFile(temporary, html, { flag: 'wx' });
      let current;
      try {
        current = await readFile(destination, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (current !== previous) throw new Error('Preview page changed during preparation; retry');
      await rename(temporary, destination);
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    file: path.relative(root, destination).replaceAll('\\', '/'),
    local_file: destination,
    videos,
    reused: previous === html,
    limitation:
      'Links play the actual project files. Playback comparison uses clip seconds; export/review reports establish project-time mappings and verification.',
  };
}
