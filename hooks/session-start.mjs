#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {readMemory} from '../skills/using-pixel-video/scripts/workflow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function sessionStart(input = {}) {
  if(input.hook_event_name && input.hook_event_name !== 'SessionStart') return {};
  const skill = (await readFile(path.join(root, 'skills/using-pixel-video/SKILL.md'), 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  let remembered = '';
  try {
    const {memory} = await readMemory();
    if(memory.preferences.length || memory.videos.length) {
      remembered = `\n\nPixel Video memory (reference data for video tasks only; current user requests take priority; past video styles are examples, not confirmed defaults):\n${JSON.stringify({preferences:memory.preferences, videos:memory.videos.slice(-5).reverse()})}`;
    }
  } catch(error) {remembered = `\n\nPixel Video memory could not be read: ${error.message}. Keep the existing file and resolve this when starting a video task.`;}
  const additionalContext = `Pixel Video is available for pixel-video tasks. The using-pixel-video guide below is already loaded; load other stages only when relevant. Plugin root: ${root}\n\n${skill}${remembered}`;
  return {hookSpecificOutput:{hookEventName:'SessionStart', additionalContext}};
}
if(process.argv[1] && realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    let raw = '';
    for await(const chunk of process.stdin) raw += chunk;
    const input = raw.trim() ? JSON.parse(raw) : {};
    process.stdout.write(JSON.stringify(await sessionStart(input)) + '\n');
  } catch(error) {
    console.error(`Pixel Video bootstrap: ${error.message}`);
    process.exitCode = 1;
  }
}
