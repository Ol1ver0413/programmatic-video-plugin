#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { run, checkAndWrite } from '../assets/starter/tools/project.mjs';
import { selectRange } from '../assets/starter/tools/sampling.mjs';
import { context, checkpoint, finish, remember, readMemory } from './workflow.mjs';
import { readJson } from './files.mjs';
import { createProject } from './project-init.mjs';
import { cutAudio, convertCaptions, number } from './media.mjs';
import { collectFrames } from './frames.mjs';

export { parseCaptions, clipCaptions } from './media.mjs';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = (values) => path.resolve(values.project || '.');
const help = `programmatic-video — editable video projects, media tools and personal memory

  init --out DIR [--title TEXT] [--audio FILE | --demo | --duration SECONDS]
  context --project DIR [--memory-dir DIR]
  checkpoint --project DIR --stage STAGE --note TEXT
  preview --project DIR [--port NUMBER]
  render --project DIR [--stills] [--scene ID | --start SECONDS --duration SECONDS] [--out FILE.mp4]
  frames --project DIR [--scene ID --samples NUMBER | --times 0.1,0.4,0.8] [--input FILE.mp4] [--out DIR]
  finish --project DIR --input REVIEW.json [--memory-dir DIR]
  memory [--memory-dir DIR]
  remember --key KEY --value TEXT --evidence TEXT --confirmed [--project DIR] [--memory-dir DIR]
  doctor
  audio --input FILE --out FILE.wav --start SECONDS --duration SECONDS
  captions --input FILE.srt|json --out FILE.json --offset SECONDS --duration SECONDS
  validate --project DIR

Stages: brainstorming, writing-plans, producing-video, finishing-video
init without audio creates a silent starter (8 seconds unless --duration is set).
Range/custom-output renders use the built-in Canvas runtime, preserving project time and skipping custom project postprocessing.
Memory: --memory-dir > PROGRAMMATIC_VIDEO_MEMORY_DIR > PIXEL_VIDEO_MEMORY_DIR > project record > ~/.pixel-video/memory
The agent authors the story, animation, review and preferences; tools execute and store records.`;

function doctor() {
  const report = { node: process.versions.node };
  let ok = Number(process.versions.node.split('.')[0]) >= 20;
  for (const executable of ['ffmpeg', 'ffprobe']) {
    try {
      report[executable] = run(executable, ['-version']).split(/\r?\n/)[0];
    } catch (error) {
      report[executable] = error.message;
      ok = false;
    }
  }
  if (!ok) process.exitCode = 1;
  return {
    ...report,
    browser: 'Use Chrome/Edge via CHROME_PATH or install Chromium in the project',
    ok,
  };
}

async function preview(values) {
  const root = projectRoot(values),
    port = values.port === undefined ? 4173 : number(values.port, 'port');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('port must be an integer from 0 to 65535');
  await checkAndWrite(root);
  const { startServer } = await import(pathToFileURL(path.join(root, 'tools/server.mjs')).href);
  const { server, url } = await startServer(port);
  console.log(url);
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
}

async function render(values) {
  const root = projectRoot(values),
    args = values.stills ? ['--stills'] : [];
  const hosted = ['scene', 'start', 'duration', 'out'].some((key) => values[key] !== undefined);
  if (hosted) {
    selectRange(await readJson(path.join(root, 'project.json')), values);
    args.push('--project', root);
    for (const key of ['scene', 'start', 'duration', 'out'])
      if (values[key] !== undefined) args.push('--' + key, values[key]);
  }
  const renderer = hosted
    ? path.join(skillDir, 'assets/starter/tools/render.mjs')
    : path.join(root, 'tools/render.mjs');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [renderer, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error('render stopped: ' + (signal || code))),
    );
  });
}

const commands = {
  doctor: { options: [], run: doctor },
  init: {
    options: ['out', 'audio', 'demo', 'title', 'duration'],
    run: (values) => createProject(values, path.join(skillDir, 'assets/starter')),
  },
  audio: { options: ['input', 'out', 'start', 'duration'], run: cutAudio },
  captions: { options: ['input', 'out', 'offset', 'duration'], run: convertCaptions },
  validate: {
    options: ['project'],
    run: async (values) => {
      const checked = await checkAndWrite(projectRoot(values));
      return {
        ok: true,
        scenes: checked.project.scenes.length,
        captions: checked.cues.length,
        warnings: checked.warnings,
      };
    },
  },
  context: {
    options: ['project', 'memory-dir'],
    project: true,
    run: (values) => context(projectRoot(values), values['memory-dir']),
  },
  checkpoint: {
    options: ['project', 'stage', 'note'],
    project: true,
    run: (values) => checkpoint(projectRoot(values), values.stage, values.note),
  },
  preview: { options: ['project', 'port'], project: true, run: preview },
  render: {
    options: ['project', 'stills', 'scene', 'start', 'duration', 'out'],
    project: true,
    run: render,
  },
  frames: {
    options: ['project', 'scene', 'times', 'samples', 'input', 'out'],
    project: true,
    run: (values) => collectFrames(projectRoot(values), values),
  },
  finish: {
    options: ['project', 'input', 'memory-dir'],
    project: true,
    run: async (values) => {
      if (!values.input) throw new Error('finish requires --input REVIEW.json');
      return finish(
        projectRoot(values),
        await readJson(path.resolve(values.input)),
        values['memory-dir'],
      );
    },
  },
  memory: { options: ['memory-dir'], run: (values) => readMemory(values['memory-dir']) },
  remember: {
    options: ['key', 'value', 'evidence', 'confirmed', 'project', 'memory-dir'],
    run: (values) =>
      remember({
        directory: values['memory-dir'],
        key: values.key,
        value: values.value,
        evidence: values.evidence,
        confirmed: values.confirmed,
        project: values.project,
      }),
  },
};

export async function main(argv = process.argv.slice(2)) {
  const booleans = new Set(['demo', 'confirmed', 'stills', 'help', 'version']);
  const names = new Set([
    ...Object.values(commands).flatMap((command) => command.options),
    ...booleans,
  ]);
  const options = Object.fromEntries(
    [...names].map((name) => [name, { type: booleans.has(name) ? 'boolean' : 'string' }]),
  );
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options });
  if (values.version) {
    console.log((await readJson(path.join(skillDir, '../../package.json'))).version);
    return;
  }
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  const name = positionals[0],
    command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command || positionals.length !== 1)
    throw new Error('Unknown command: ' + positionals.join(' '));
  for (const option of Object.keys(values))
    if (!command.options.includes(option)) throw new Error(name + ' does not accept --' + option);
  if (command.project && !values.project) throw new Error(name + ' requires --project');
  const result = await command.run(values);
  if (result !== undefined)
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
