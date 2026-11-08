import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {context, checkpoint, finish, remember, readMemory} from '../cli/lib/workflow.mjs';
import {validateProject,outputFile,checkAndWrite} from '../cli/runtime/project.mjs';

const cli = fileURLToPath(new URL('../cli/programmatic-video.mjs', import.meta.url));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
function invoke(...args) {
  return spawnSync(process.execPath, [cli, ...args], {encoding:'utf8', windowsHide:true});
}
async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'programmatic-video-workflow-'));
  t.after(async () => {
    assert.equal(path.dirname(parent), os.tmpdir());
    assert.ok(path.basename(parent).startsWith('programmatic-video-workflow-'));
    await rm(parent, {recursive:true, force:true});
  });
  const project = path.join(parent, '雨夜 便利店'), memory = path.join(parent, '个人 记忆');
  const result = invoke('init', '--out', project, '--title', '雨夜便利店', '--duration', '1');
  assert.equal(result.status, 0, result.stderr);
  return {parent, project, memory};
}

test('CLI creates a silent named project without audio and preserves an existing project', async t => {
  const f = await fixture(t), project = await json(path.join(f.project, 'project.json'));
  assert.equal(project.title, '雨夜便利店'); assert.equal(project.audio, null); assert.equal(project.duration, 1);
  assert.deepEqual((await validateProject(f.project)).errors, []);
  for(const name of ['brief.md', 'plan.md', 'progress.md', 'review.md', 'workflow.json', 'assets/sources.json']) assert.ok((await stat(path.join(f.project, name))).isFile());
  await writeFile(path.join(f.project, 'brief.md'), '用户已认可的便利店方向');
  const retry = invoke('init', '--out', f.project);
  assert.notEqual(retry.status, 0); assert.match(retry.stderr, /overwrite/);
  assert.equal(await readFile(path.join(f.project, 'brief.md'), 'utf8'), '用户已认可的便利店方向');
  assert.equal(invoke('--version').stdout.trim(), (await json(new URL('../package.json', import.meta.url))).version);
});

test('renamed CLI retains the old entry and accepts the legacy memory environment variable', async t=>{
  const f=await fixture(t),legacy=fileURLToPath(new URL('../scripts/pixel-video.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[legacy,'--version'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),invoke('--version').stdout.trim());
  const pkg=await json(new URL('../package.json',import.meta.url));
  assert.equal(pkg.bin['pixel-video'],pkg.bin['programmatic-video']);
  const environment={...process.env,PIXEL_VIDEO_MEMORY_DIR:f.memory};delete environment.PROGRAMMATIC_VIDEO_MEMORY_DIR;
  const old=spawnSync(process.execPath,[cli,'memory'],{encoding:'utf8',windowsHide:true,env:environment});
  assert.equal(old.status,0,old.stderr);assert.equal(JSON.parse(old.stdout).file,path.join(f.memory,'preferences.json'));
  environment.PROGRAMMATIC_VIDEO_MEMORY_DIR=path.join(f.parent,'preferred-memory');
  const preferred=spawnSync(process.execPath,[cli,'memory'],{encoding:'utf8',windowsHide:true,env:environment});
  assert.equal(preferred.status,0,preferred.stderr);assert.equal(JSON.parse(preferred.stdout).file,path.join(environment.PROGRAMMATIC_VIDEO_MEMORY_DIR,'preferences.json'));
});

test('context, remember and a later finish reuse the project-recorded custom memory directory',async t=>{
  const f=await fixture(t);await mkdir(path.join(f.project,'output'));
  await writeFile(path.join(f.project,'output/video.mp4'),'existing delivery');
  const review={summary:'本版交付',style:'安静插画',deliverables:['output/video.mp4']};
  await finish(f.project,review,f.memory);
  const environment={...process.env};delete environment.PROGRAMMATIC_VIDEO_MEMORY_DIR;delete environment.PIXEL_VIDEO_MEMORY_DIR;
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,env:environment});
  const resumed=call('context','--project',f.project);assert.equal(resumed.status,0,resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).memory.file,path.join(f.memory,'preferences.json'));
  const corrected=call('remember','--project',f.project,'--key','quiet-style','--value','留白','--evidence','用户明确要求','--confirmed');
  assert.equal(corrected.status,0,corrected.stderr);
  const input=path.join(f.project,'review-input.json');await writeFile(input,JSON.stringify(review));
  const retried=call('finish','--project',f.project,'--input',input);assert.equal(retried.status,0,retried.stderr);
  assert.equal((await readMemory(f.memory)).memory.preferences[0].value,'留白');
  assert.match(await readFile(path.join(f.project,'review.md'),'utf8'),/pixel-video-review:/);
});

test('output paths cannot create directories through a symlink outside the project',async t=>{
  const f=await fixture(t),outside=path.join(f.parent,'outside');await mkdir(outside);
  await symlink(outside,path.join(f.project,'linked-output'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(outputFile(f.project,'linked-output/nested/frames.json'),/leaves project/);
  await assert.rejects(stat(path.join(outside,'nested')),{code:'ENOENT'});
  await symlink(outside,path.join(f.project,'output'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(checkAndWrite(f.project),/leaves project/);
  await assert.rejects(stat(path.join(outside,'check.json')),{code:'ENOENT'});
});

test('CLI entry works through the directory link created by a local npm install', async t => {
  const f = await fixture(t), linked = path.join(f.parent, '安装 命令');
  const repo = path.dirname(path.dirname(cli));
  await symlink(repo, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [path.join(linked, 'cli/programmatic-video.mjs'), '--help'], {encoding:'utf8', windowsHide:true});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /programmatic-video —/);
});

test('preview CLI serves the selected project on an available port and exits cleanly', async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [cli, 'preview', '--project', f.project, '--port', '0'], {stdio:['ignore', 'pipe', 'pipe'], windowsHide:true});
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  t.after(async () => {
    if(child.exitCode === null) {const closed = once(child, 'close'); child.kill(); await closed;}
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`preview startup timed out: ${stderr}`)), 10000);
    child.stdout.on('data', chunk => {const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if(match) {clearTimeout(timer); resolve(match[0]);}});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', code => {clearTimeout(timer); reject(new Error(`preview exited ${code}: ${stderr}`));});
  });
  const response = await fetch(`${url}/project.json`);
  assert.equal(response.status, 200); assert.equal((await response.json()).title, '雨夜便利店');
  assert.equal((await fetch(`${url}/index.html`)).status, 200);
  assert.equal(stderr, '');
});

test('render CLI lets the project renderer validate once and forwards stills mode', async t => {
  const f=await fixture(t);
  await writeFile(path.join(f.project,'tools/render.mjs'),`
    import assert from 'node:assert/strict';
    import {stat} from 'node:fs/promises';
    import {fileURLToPath} from 'node:url';
    import {checkAndWrite} from './project.mjs';
    // A CLI preflight would already have written this report before delegation.
    await assert.rejects(stat(new URL('../output/check.json',import.meta.url)),{code:'ENOENT'});
    assert.ok(process.argv.includes('--stills'));
    await checkAndWrite(fileURLToPath(new URL('../',import.meta.url)));
    console.log('project renderer validated');
  `);
  const result=invoke('render','--project',f.project,'--stills');
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/project renderer validated/);
  assert.equal((await json(path.join(f.project,'output/check.json'))).ok,true);
});

test('read-only context and checkpoints restore authored decisions without creating memory', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.project, 'plan.md'), '三镜，保留口播留白');
  const record = await checkpoint(f.project, 'producing-video', '第一镜完成，下一步做雨棚灯光');
  assert.equal(record.stage, 'producing-video');
  const saved = await context(f.project, f.memory);
  assert.equal(saved.documents['plan.md'], '三镜，保留口播留白');
  assert.match(saved.documents['progress.md'], /下一步做雨棚灯光/);
  assert.equal(saved.workflow.status, 'in_progress');
  assert.deepEqual(saved.memory.preferences, []);
  assert.deepEqual(saved.memory.videos, []);
  await assert.rejects(stat(f.memory), {code:'ENOENT'});
  await assert.rejects(checkpoint(f.project, 'unknown', 'note'), /stage/);
  await assert.rejects(checkpoint(f.project, 'brainstorming', ''), /note/);
});

test('finish requires real in-project deliverables, is retryable, and reopening preserves review history', async t => {
  const f = await fixture(t), summary = {summary:'完成雨夜小样', style:'冷色雨夜、暖色店灯、固定镜头', feedback:['灯光方向符合预期'], lessons:['先看关键帧'], deliverables:['output/video.mp4']};
  await assert.rejects(finish(f.project, summary, f.memory), {code:'ENOENT'});
  await assert.rejects(finish(f.project, {...summary, deliverables:['../outside.mp4']}, f.memory), /leaves project/);
  await mkdir(path.join(f.project, 'output'));
  await writeFile(path.join(f.project, 'output/video.mp4'), 'test deliverable — not a media-validation assertion');
  await finish(f.project, summary, f.memory);
  const first = await readFile(path.join(f.project, 'review.md'), 'utf8');
  await finish(f.project, summary, f.memory);
  assert.equal(await readFile(path.join(f.project, 'review.md'), 'utf8'), first);
  assert.equal((await context(f.project, f.memory)).workflow.status, 'completed');
  await checkpoint(f.project, 'producing-video', '仅修改第二镜的灯光');
  assert.equal((await context(f.project, f.memory)).workflow.status, 'in_progress');
  assert.equal(await readFile(path.join(f.project, 'review.md'), 'utf8'), first);
  await finish(f.project, {...summary, summary:'修改第二镜后再次交付', style:'冷色雨夜、暖色店灯、第二镜增加反光'}, f.memory);
  assert.match(await readFile(path.join(f.project, 'review.md'), 'utf8'), /修改第二镜后再次交付/);
  const remembered = (await readMemory(f.memory)).memory;
  assert.equal(remembered.videos.length, 1);
  assert.equal(remembered.videos[0].style, '冷色雨夜、暖色店灯、第二镜增加反光');
  assert.deepEqual(remembered.preferences, []);
});

test('long-term preferences require evidence and a completed source project, and can be corrected across projects', async t => {
  const f = await fixture(t), preference = {directory:f.memory, project:f.project, key:'captions', value:'简洁字幕', evidence:'以后字幕都保持这样'};
  await assert.rejects(remember(preference), /confirmed/);
  await assert.rejects(remember({...preference, confirmed:true, evidence:''}), /evidence/);
  await assert.rejects(remember({...preference, confirmed:true}), /Finish/);
  await writeFile(path.join(f.project, 'delivery.txt'), 'actual project delivery');
  await finish(f.project, {summary:'完成', style:'安静雨夜、简洁字幕', deliverables:['delivery.txt']}, f.memory);
  await remember({...preference, confirmed:true});
  await remember({...preference, confirmed:true});
  assert.equal((await readMemory(f.memory)).memory.history.length, 1);
  const saved = await context(f.project, f.memory);
  assert.equal(saved.memory.preferences[0].value, '简洁字幕');
  assert.equal(saved.memory.preferences[0].sourceProject, '雨夜便利店');
  await remember({...preference, confirmed:true, value:'独立字幕，不烧录', evidence:'以后只给我独立字幕'});
  const {memory} = await readMemory(f.memory);
  assert.equal(memory.preferences.length, 1);
  assert.equal(memory.preferences[0].value, '独立字幕，不烧录');
  assert.equal(memory.history[1].previousValue, '简洁字幕');
  const nextProject = path.join(f.parent, '下一条');
  assert.equal(invoke('init', '--out', nextProject).status, 0);
  assert.equal((await context(nextProject, f.memory)).memory.preferences[0].value, '独立字幕，不烧录');
});

test('legacy projects gain workflow files without replacing authored documents or the media timeline', async t => {
  const f = await fixture(t), before = await readFile(path.join(f.project, 'project.json'), 'utf8');
  for(const name of ['workflow.json', 'progress.md', 'review.md']) await rm(path.join(f.project, name));
  await writeFile(path.join(f.project, 'brief.md'), '沿用已选音频、角色和字幕');
  assert.equal((await context(f.project, f.memory)).workflow, null);
  await checkpoint(f.project, 'producing-video', '恢复旧工程');
  assert.equal(await readFile(path.join(f.project, 'project.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.project, 'brief.md'), 'utf8'), '沿用已选音频、角色和字幕');
});

test('malformed memory is reported and never silently overwritten', async t => {
  const f = await fixture(t);
  await mkdir(f.memory); await writeFile(path.join(f.memory, 'preferences.json'), '{broken');
  await assert.rejects(remember({directory:f.memory, key:'style', value:'pixel', evidence:'明确表达', confirmed:true}), SyntaxError);
  assert.equal(await readFile(path.join(f.memory, 'preferences.json'), 'utf8'), '{broken');
});

test('existing falsy memory records are rejected and preserved by reads, remember and finish', async t => {
  const f=await fixture(t), file=path.join(f.memory,'preferences.json');
  await mkdir(f.memory);
  await writeFile(path.join(f.project,'delivery.txt'),'delivery fixture');
  for(const contents of ['null','false','0','""']) {
    await writeFile(file,contents);
    await assert.rejects(readMemory(f.memory), /Unsupported memory record/);
    assert.notEqual(invoke('memory','--memory-dir',f.memory).status,0);
    await assert.rejects(remember({directory:f.memory,key:'style',value:'pixel',evidence:'explicit',confirmed:true}), /Unsupported memory record/);
    await assert.rejects(finish(f.project,{summary:'done',style:'pixel',deliverables:['delivery.txt']},f.memory), /Unsupported memory record/);
    assert.equal(await readFile(file,'utf8'),contents);
    assert.equal((await json(path.join(f.project,'workflow.json'))).status,'in_progress');
  }
});

test('BOM project and workflow records can resume, checkpoint and finish', async t => {
  const f=await fixture(t);
  for(const name of ['project.json','workflow.json']) {
    const file=path.join(f.project,name);await writeFile(file,'\uFEFF'+await readFile(file,'utf8'));
  }
  assert.equal((await context(f.project,f.memory)).workflow.status,'in_progress');
  await checkpoint(f.project,'producing-video','BOM project restored');
  await writeFile(path.join(f.project,'delivery.txt'),'delivery fixture');
  assert.equal((await finish(f.project,{summary:'done',style:'pixel',deliverables:['delivery.txt']},f.memory)).status,'completed');
});

test('an unchanged preference still requires a completed source project', async t => {
  const f=await fixture(t), preference={directory:f.memory,key:'style',value:'pixel',evidence:'explicit',confirmed:true};
  await remember(preference);
  await assert.rejects(remember({...preference,project:f.project}), /Finish/);
  assert.equal((await readMemory(f.memory)).memory.history.length,1);
});

test('demo init checks FFmpeg before copying and can retry the same target', async t => {
  const f=await fixture(t), target=path.join(f.parent,'demo'), emptyPath=path.join(f.parent,'empty-path');
  await mkdir(emptyPath);
  const result=spawnSync(process.execPath,[cli,'init','--out',target,'--demo'],{encoding:'utf8',windowsHide:true,env:{...process.env,PATH:emptyPath}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/ffmpeg/i);
  await assert.rejects(stat(target),{code:'ENOENT'});
  if(spawnSync('ffmpeg',['-version'],{windowsHide:true}).status===0) {
    const retry=invoke('init','--out',target,'--demo');assert.equal(retry.status,0,retry.stderr);
  }
});

test('finish rejects deliverables that link outside the project', async t => {
  const f = await fixture(t), outside = path.join(f.parent, 'outside');
  await mkdir(outside);
  // This fixture owns both paths; only its sources record is removed, not user data.
  await rm(path.join(f.project, 'assets/sources.json'));
  const linked = path.join(f.project, 'external');
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(outside, 'secret.txt'), 'external');
  await assert.rejects(finish(f.project, {summary:'no', deliverables:['external/secret.txt']}, f.memory), /leaves project/);
});

test('finish CLI saves style and confirmed preferences, then a new session and project recall them', async t => {
  const f = await fixture(t), inputFile = path.join(f.project, 'review-input.json');
  const review = {
    summary:'完成可交付版本；此测试只验证记录流程，不验证媒体', deliverables:['delivery.txt'],
    style:'低饱和冷色、固定镜头、慢节奏、小字幕', lessons:['先定关键帧再补动作'], feedback:['字幕大小符合预期'],
    preferences:[{key:'subtitle-style', value:'字幕小一些，留出主体', evidence:'以后我的视频字幕都小一点', confirmed:true}]
  };
  await writeFile(path.join(f.project, 'delivery.txt'), 'delivery fixture');
  // Windows-authored JSON may have a BOM.
  await writeFile(inputFile, '\uFEFF' + JSON.stringify(review));
  const args = ['finish', '--project', f.project, '--input', inputFile, '--memory-dir', f.memory];
  const result = invoke(...args);
  assert.equal(result.status, 0, result.stderr);
  const completed = JSON.parse(result.stdout), memoryFile = path.join(f.memory, 'preferences.json');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.memory.file, memoryFile);
  assert.equal(completed.memory.reviewHash, completed.lastReviewHash);
  const firstMemory = await readFile(memoryFile, 'utf8');
  const saved = JSON.parse(firstMemory);
  assert.equal(saved.videos.length, 1);
  assert.equal(saved.videos[0].style, review.style);
  assert.equal(saved.videos[0].reviewHash, completed.lastReviewHash);
  assert.equal(saved.preferences[0].value, review.preferences[0].value);
  assert.equal(saved.preferences[0].evidence, review.preferences[0].evidence);
  assert.equal(saved.history.length, 1);
  assert.match(await readFile(path.join(f.project, 'review.md'), 'utf8'), /低饱和冷色/);
  assert.equal(invoke(...args).status, 0);
  assert.equal(await readFile(memoryFile, 'utf8'), firstMemory);

  const hook = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url));
  const restarted = spawnSync(process.execPath, [hook], {
    input:JSON.stringify({hook_event_name:'SessionStart', source:'startup'}), encoding:'utf8', windowsHide:true,
    env:{...process.env, PROGRAMMATIC_VIDEO_MEMORY_DIR:f.memory}
  });
  assert.equal(restarted.status, 0, restarted.stderr);
  const guide = JSON.parse(restarted.stdout).hookSpecificOutput.additionalContext;
  assert.ok(guide.includes(review.style));
  assert.ok(guide.includes(review.preferences[0].value));

  const nextProject = path.join(f.parent, '下一条 视频');
  assert.equal(invoke('init', '--out', nextProject).status, 0);
  const recalled = invoke('context', '--project', nextProject, '--memory-dir', f.memory);
  assert.equal(recalled.status, 0, recalled.stderr);
  const next = JSON.parse(recalled.stdout);
  assert.equal(next.workflow.status, 'in_progress');
  assert.equal(next.memory.videos[0].style, review.style);
  assert.equal(next.memory.preferences[0].value, review.preferences[0].value);
  assert.equal(await readFile(memoryFile, 'utf8'), firstMemory);

  // A late retry of the old delivery must not undo a newer user preference.
  await remember({directory:f.memory, project:f.project, key:'subtitle-style', value:'只交独立字幕', evidence:'以后都给独立字幕', confirmed:true});
  assert.equal(invoke(...args).status, 0);
  assert.equal((await readMemory(f.memory)).memory.preferences[0].value, '只交独立字幕');
  assert.equal((await readMemory(f.memory)).memory.history.length, 2);
});

test('incomplete review and memory errors leave the project unfinished and retry succeeds', async t => {
  const f = await fixture(t), reviewFile = path.join(f.project, 'review.md');
  const before = await readFile(reviewFile, 'utf8');
  await writeFile(path.join(f.project, 'delivery.txt'), 'delivery fixture');
  const review = {summary:'交付测试', style:'雨夜、暖灯、无字幕', deliverables:['delivery.txt']};
  await assert.rejects(finish(f.project, {...review, style:''}, f.memory), /style/);
  await assert.rejects(finish(f.project, {...review, preferences:[{key:'style', value:'雨夜', evidence:'agent 的猜测'}]}, f.memory), /confirmed/);
  await assert.rejects(finish(f.project, {...review, preferences:[{key:'style', value:'雨夜', evidence:'', confirmed:true}]}, f.memory), /evidence/);
  await assert.rejects(stat(f.memory), {code:'ENOENT'});

  await mkdir(f.memory);
  const memoryFile = path.join(f.memory, 'preferences.json');
  await writeFile(memoryFile, '{broken');
  await assert.rejects(finish(f.project, review, f.memory), SyntaxError);
  assert.equal((await json(path.join(f.project, 'workflow.json'))).status, 'in_progress');
  assert.equal(await readFile(reviewFile, 'utf8'), before);
  assert.equal(await readFile(memoryFile, 'utf8'), '{broken');
  const blockedDirectory = path.join(f.parent, 'not-a-directory');
  await writeFile(blockedDirectory, 'blocks memory storage');
  await assert.rejects(finish(f.project, review, blockedDirectory));
  assert.equal((await json(path.join(f.project, 'workflow.json'))).status, 'in_progress');

  // Existing 0.2.0 preferences gain video memories without losing their history.
  await writeFile(memoryFile, JSON.stringify({schemaVersion:1, preferences:[], history:[]}));
  await finish(f.project, review, f.memory);
  const memory = (await readMemory(f.memory)).memory;
  assert.equal(memory.videos[0].style, review.style);
  assert.deepEqual(memory.preferences, []);
  assert.equal((await json(path.join(f.project, 'workflow.json'))).status, 'completed');
});
