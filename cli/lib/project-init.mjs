import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, copyFile, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { run } from '../runtime/project.mjs';
import { initWorkflow } from './workflow.mjs';
import { audioDuration, newFile, number } from './media.mjs';
import { readJson, saveJson } from './files.mjs';
export async function createProject(values, starter) {
  if (!values.out) throw new Error('init requires --out');
  if (values.audio && values.demo) throw new Error('Choose --audio or --demo, not both');
  if (values.duration && (values.audio || values.demo))
    throw new Error('--duration is for silent projects; audio and demo supply their own duration');
  const target = path.resolve(values.out);
  newFile(target);
  const source = values.audio ? path.resolve(values.audio) : null;
  const duration = source
    ? audioDuration(source)
    : values.demo
      ? 8
      : number(values.duration ?? '8', 'duration');
  if (duration <= 0) throw new Error('duration must be positive');
  if (values.demo) run('ffmpeg', ['-version']);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(starter, target, { recursive: true });
  await rename(path.join(target, 'gitignore'), path.join(target, '.gitignore'));
  await cp(fileURLToPath(new URL('../runtime', import.meta.url)), path.join(target, 'tools'), {
    recursive: true,
  });
  const audioName = source ? 'clip' + path.extname(source).toLowerCase() : 'demo.wav';
  const audioFile = path.join(target, 'assets/audio', audioName);
  if (source || values.demo) await mkdir(path.dirname(audioFile), { recursive: true });
  if (source) await copyFile(source, audioFile);
  else if (values.demo)
    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100:duration=8',
      '-af',
      'volume=0.06,tremolo=f=2:d=0.95',
      '-ac',
      '2',
      audioFile,
    ]);
  const project = await readJson(path.join(target, 'project.json'));
  project.title = values.title?.trim() || path.basename(target);
  project.duration = duration;
  project.audio = source || values.demo ? 'assets/audio/' + audioName : null;
  const bounds = [0, duration / 3, (duration * 2) / 3, duration];
  project.scenes.forEach((s, i) => {
    s.start = bounds[i];
    s.end = bounds[i + 1];
  });
  await saveJson(path.join(target, 'project.json'), project);
  await saveJson(
    path.join(target, 'captions.json'),
    values.demo
      ? project.scenes.map((s, i) => ({
          start: s.start,
          end: s.end,
          text: ['Run to the gate', 'Open a new way', 'Make the landing'][i],
        }))
      : [],
  );
  if (project.audio)
    await saveJson(path.join(target, 'assets/audio/source.json'), {
      kind: source ? 'user-file' : 'generated-demo-tone',
      source_file: source ? path.basename(source) : null,
      sha256: createHash('sha256')
        .update(await readFile(audioFile))
        .digest('hex'),
      duration_seconds: duration,
    });
  await initWorkflow(target, project.title);
  return `Created ${target}\nStart with brief.md and plan.md. This is an editable starter, not a content-derived storyboard. Run programmatic-video context --project "${target}" to resume.`;
}
