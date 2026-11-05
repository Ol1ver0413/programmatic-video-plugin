import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkAndWrite} from './project.mjs';
try{
  const r=await checkAndWrite(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  console.log(JSON.stringify({ok:true,scenes:r.project.scenes.length,captions:r.cues.length,warnings:r.warnings},null,2));
}catch(error){console.error(error.message);process.exitCode=1}
