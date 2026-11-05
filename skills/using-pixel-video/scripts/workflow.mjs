import path from 'node:path';
import os from 'node:os';
import {readFile, writeFile, mkdir, rename, appendFile, realpath, stat, lstat, rm} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import {localFile} from '../assets/starter/tools/project.mjs';
import {videoFinished} from '../../../hooks/video-finished.mjs';

export const stages = ['brainstorming', 'writing-plans', 'producing-video', 'finishing-video'];
const stamp = () => new Date().toISOString();
const text = (value, name) => {
  if(typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty text`);
  return value.trim();
};
async function optional(file) {
  try {return await readFile(file, 'utf8');} catch(error) {if(error.code === 'ENOENT') return null; throw error;}
}
async function readJson(file) {
  const value = await optional(file);
  return value === null ? null : JSON.parse(value.replace(/^\uFEFF/, ''));
}
export async function saveJson(file, value) {
  // A failed write cannot truncate the previous record.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
    await rename(temporary, file);
  } finally {await rm(temporary, {force:true});}
}
async function projectRoot(directory) {
  const root = await realpath(directory);
  const contents = await projectDocument(root, 'project.json');
  if(contents === null || !JSON.parse(contents)) throw new Error('Not a video project: project.json is missing');
  return root;
}
async function projectDocument(root, name) {
  const file = localFile(root, name);
  try {await lstat(file);} catch(error) {if(error.code === 'ENOENT') return null; throw error;}
  const actual = await realpath(file), relative = path.relative(root, actual);
  if(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Document leaves project: ${name}`);
  return readFile(actual, 'utf8');
}
async function workflow(root) {
  await projectDocument(root, 'workflow.json');
  const record = await readJson(path.join(root, 'workflow.json'));
  if(record && (record.schemaVersion !== 1 || !stages.includes(record.stage) || !['in_progress', 'completed'].includes(record.status))) throw new Error('Unsupported workflow record');
  return record;
}
export async function initWorkflow(directory, title) {
  const root = await projectRoot(directory), name = text(title, 'title');
  const templates = {
    'brief.md': `# ${name}\n\n## 创作意图\n记录用途、观众、希望传达的内容，以及本次明确的约束。\n\n## 场景与风格\n边讨论边收集参考，记录选中的方向、理由和用户反馈。\n\n## 素材与缺口\n用户素材、找到的参考和生成素材都在 assets/sources.json 中登记；标明哪些只是参考、哪些可用于成片。\n\n## 已确认与待讨论\n区分用户确认的内容和 agent 的建议。\n`,
    'plan.md': '# 故事脚本与制作计划\n\n## 故事或动作过程\n根据已确认的意图编写；短动作素材写清动作过程即可。\n\n## 分镜\n每镜记录时间、画面、动作、声音或字幕，以及需要的素材。\n\n## 制作顺序与检查\n列出素材缺口、依赖关系、预览节点与交付物。\n',
    'progress.md': '# 制作进度\n\n完成一段工作或中断前，用 pixel-video checkpoint 记录当前阶段、已完成内容和下一步。\n',
    'review.md': '# 看片反馈与制作小结\n\n完成后用 pixel-video finish 保存交付物、用户反馈和经验，并自动沉淀本片风格与有依据的长期偏好。\n'
  };
  for(const [name, content] of Object.entries(templates)) {
    try {await writeFile(path.join(root, name), content, {flag:'wx'});} catch(error) {if(error.code !== 'EEXIST') throw error; await projectDocument(root, name);}
  }
  await mkdir(path.join(root, 'assets'), {recursive:true});
  const assetsRoot = await realpath(path.join(root, 'assets'));
  const assetsRelative = path.relative(root, assetsRoot);
  if(assetsRelative === '..' || assetsRelative.startsWith('..' + path.sep) || path.isAbsolute(assetsRelative)) throw new Error('Assets directory leaves project');
  await projectDocument(root, 'assets/sources.json');
  try {await writeFile(path.join(root, 'assets/sources.json'), '[]\n', {flag:'wx'});} catch(error) {if(error.code !== 'EEXIST') throw error;}
  const existing = await workflow(root);
  if(!existing) {
    const now = stamp();
    await saveJson(path.join(root, 'workflow.json'), {schemaVersion:1, title:name, stage:'brainstorming', status:'in_progress', createdAt:now, updatedAt:now});
  }
  return root;
}
export function memoryDirectory(directory) {
  return path.resolve(directory || process.env.PIXEL_VIDEO_MEMORY_DIR || path.join(os.homedir(), '.pixel-video', 'memory'));
}
export async function readMemory(directory) {
  const root = memoryDirectory(directory), file = path.join(root, 'preferences.json');
  const memory = await readJson(file) || {schemaVersion:1, preferences:[], history:[]};
  if(memory.schemaVersion !== 1 || !Array.isArray(memory.preferences) || !Array.isArray(memory.history)) throw new Error('Unsupported memory record');
  memory.videos ??= [];
  if(!Array.isArray(memory.videos)) throw new Error('Unsupported video memory record');
  for(const item of memory.preferences) {
    for(const name of ['key', 'value', 'evidence']) text(item?.[name], `memory ${name}`);
  }
  for(const item of memory.videos) {
    for(const name of ['project', 'title', 'style', 'reviewHash']) text(item?.[name], `video memory ${name}`);
  }
  return {file, memory};
}
export async function context(directory, memoryDir) {
  const root = await projectRoot(directory), record = await workflow(root);
  const documents = {};
  for(const name of ['brief.md', 'plan.md', 'progress.md', 'review.md', 'assets/sources.json']) documents[name] = await projectDocument(root, name);
  const {file, memory} = await readMemory(memoryDir);
  return {project:root, workflow:record, documents, memory:{file, preferences:memory.preferences, videos:memory.videos.slice(-5).reverse()}};
}
export async function checkpoint(directory, stage, note) {
  if(!stages.includes(stage)) throw new Error(`stage must be one of: ${stages.join(', ')}`);
  const message = text(note, 'note'), root = await projectRoot(directory);
  const project = await readJson(path.join(root, 'project.json'));
  await initWorkflow(root, project.title || path.basename(root));
  const record = await workflow(root), now = stamp();
  await appendFile(path.join(root, 'progress.md'), `\n## ${now} · ${stage}\n\n${message}\n`);
  Object.assign(record, {stage, status:'in_progress', updatedAt:now});
  delete record.completedAt;
  await saveJson(path.join(root, 'workflow.json'), record);
  return record;
}
export async function finish(directory, input, memoryDir) {
  const root = await projectRoot(directory), summary = text(input?.summary, 'summary');
  const strings = name => {
    if(input[name] !== undefined && !Array.isArray(input[name])) throw new Error(`${name} must be an array`);
    return (input[name] || []).map(value => text(value, name));
  };
  const feedback = strings('feedback'), lessons = strings('lessons'), deliverables = strings('deliverables');
  if(!deliverables.length) throw new Error('finish requires at least one actual deliverable');
  for(const relative of deliverables) {
    const actual = await realpath(localFile(root, relative)), rel = path.relative(root, actual);
    if(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`Deliverable leaves project: ${relative}`);
    const info = await stat(actual);
    if(!info.isFile() || info.size === 0) throw new Error(`Deliverable is empty or not a file: ${relative}`);
  }
  const style = text(input.style, 'style: describe the delivered video so the next project can reference it');
  if(input.preferences !== undefined && !Array.isArray(input.preferences)) throw new Error('preferences must be an array');
  const preferences = (input.preferences || []).map(item => {
    if(item?.confirmed !== true) throw new Error('A long-term preference requires confirmed: true and actual user evidence');
    return {key:text(item.key, 'preference key'), value:text(item.value, 'preference value'), evidence:text(item.evidence, 'preference evidence')};
  });
  if(new Set(preferences.map(item => item.key)).size !== preferences.length) throw new Error('Duplicate preference keys in review');
  const review = {summary, feedback, lessons, deliverables, style, preferences};
  const digest = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  // Fail before marking the project complete if its shared memory cannot be read.
  const {file, memory} = await readMemory(memoryDir);
  const project = await readJson(path.join(root, 'project.json'));
  await initWorkflow(root, project.title || path.basename(root));
  const record = await workflow(root);
  const repeated = record.status === 'completed' && record.lastReviewHash === digest;
  const now = repeated ? record.completedAt : stamp();
  const nextMemory = videoFinished({memory, project:root, title:record.title, review, reviewHash:digest, completedAt:now});
  await mkdir(path.dirname(file), {recursive:true});
  if(JSON.stringify(nextMemory) !== JSON.stringify(memory)) await saveJson(file, nextMemory);
  const list = values => values.length ? values.map(v => `- ${v}`).join('\n') : '尚无记录';
  const marker = `<!-- pixel-video-review:${digest} -->`;
  // A retry after a partial I/O failure must not append the same review twice.
  if(!(await projectDocument(root, 'review.md')).includes(marker)) {
    await appendFile(path.join(root, 'review.md'), `\n${marker}\n## ${now}\n\n${summary}\n\n### 交付物\n${list(deliverables)}\n\n### 本片风格（供下次参考）\n${style}\n\n### 用户反馈\n${list(feedback)}\n\n### 本次经验\n${list(lessons)}\n\n### 长期偏好\n${preferences.length ? list(preferences.map(item => `${item.key}: ${item.value}（依据：${item.evidence}）`)) : '本次没有新的明确长期偏好；已保留本片风格供参考。'}\n`);
  }
  if(!(await projectDocument(root, 'progress.md')).includes(marker)) {
    await appendFile(path.join(root, 'progress.md'), `\n${marker}\n## ${now} · finishing-video\n\n已交付：${deliverables.join('、')}\n制作小结见 review.md，本片风格与明确偏好已写入个人 memory。\n`);
  }
  Object.assign(record, {stage:'finishing-video', status:'completed', completedAt:now, updatedAt:now, lastReviewHash:digest,
    memory:{file, reviewHash:digest, recordedAt:now}});
  await saveJson(path.join(root, 'workflow.json'), record);
  return record;
}
export async function remember({directory, key, value, evidence, confirmed, project}) {
  if(!confirmed) throw new Error('Use --confirmed only for a preference the user explicitly expressed or approved');
  key = text(key, 'key'); value = text(value, 'value'); evidence = text(evidence, 'evidence');
  const {file, memory} = await readMemory(directory);
  const previous = memory.preferences.find(item => item.key === key);
  if(previous?.value === value && previous?.evidence === evidence) return {file, preference:previous};
  let sourceProject = null;
  if(project) {
    const root = await projectRoot(project), record = await workflow(root);
    if(record?.status !== 'completed') throw new Error('Finish the project before promoting its feedback to long-term memory');
    sourceProject = record.title;
  }
  const preference = {key, value, evidence, sourceProject, updatedAt:stamp()};
  memory.preferences = memory.preferences.filter(item => item.key !== key).concat(preference);
  memory.history.push({...preference, previousValue:previous?.value || null});
  await mkdir(path.dirname(file), {recursive:true});
  await saveJson(file, memory);
  return {file, preference};
}
