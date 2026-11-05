#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {main} from '../skills/using-pixel-video/scripts/pixel-video.mjs';

export {main, parseCaptions, clipCaptions} from '../skills/using-pixel-video/scripts/pixel-video.mjs';
if(process.argv[1] && realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
