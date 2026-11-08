import { readJson, saveJson } from './files.mjs';
export { saveJson } from './files.mjs';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir, appendFile, realpath, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localFile, parseJson } from '../runtime/project.mjs';
import { videoFinished } from '../../hooks/video-finished.mjs';
import { upsertPreference } from './preferences.mjs';

export const stages = ['brainstorming', 'writing-plans', 'producing-video', 'finishing-video'];
const stamp = () => new Date().toISOString();
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty text`);
  return value.trim();
};
async function optional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function projectRoot(directory) {
  const root = await realpath(directory);
  const contents = await projectDocument(root, 'project.json');
  if (contents === null || !parseJson(contents))
    throw new Error('Not a video project: project.json is missing');
  return root;
}
async function projectDocument(root, name) {
  const file = localFile(root, name);
  try {
    await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const actual = await realpath(file),
    relative = path.relative(root, actual);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error(`Document leaves project: ${name}`);
  return readFile(actual, 'utf8');
}
async function workflow(root) {
  const contents = await projectDocument(root, 'workflow.json');
  const record = contents === null ? null : parseJson(contents);
  if (
    record &&
    (record.schemaVersion !== 1 ||
      !stages.includes(record.stage) ||
      !['in_progress', 'completed'].includes(record.status))
  )
    throw new Error('Unsupported workflow record');
  return record;
}
export async function initWorkflow(directory, title) {
  const root = await projectRoot(directory),
    name = text(title, 'title');
  const templates = {
    'brief.md': `# ${name}

## 创作意图
记录用途、观众、内容或音频范围、时长与画幅，以及希望传达的意思和观看感受。

## 场景与风格
写清本片的画风、主体身份或信息依据、叙事/解释方式与节奏。涉及隐喻、人物指代或夸张时，记录采用的解释与尺度；硬要求和可调整方案分开。

## 素材与缺口
用户素材、找到的参考和生成素材在 assets/sources.json 登记，区分参考与成片资产。写清已采用的版本、缺少什么，以及先验证哪些资产；不要把候选当成已采用。

## 已确认与待讨论
区分用户确认、agent 建议与待验证项，保留会改变制作决定的原话或修改原因。有内容雏形直接在 plan.md 继续，不另写脑暴稿。
`,
    'plan.md':
      '# 内容脚本与制作计划\n\n## 故事、动作或解释过程\n先用几行文字串起观众会看到并理解的过程，再排分镜。这是内容脚本，不是代码。人物叙事写事件与反应，讲解写建立、比较与结论；氛围素材写情绪与有意的变化或停留。\n\n## 分镜\n按需记录：片内时间、对应内容及原意、可见事件/信息变化、主体关系与结果、构图、声音/字幕、关键资产。镜头与字幕共用时间轴，不强求一句一镜；先有事件，再决定姿态和资产。\n\n## 制作顺序与检查\n先验证最容易返工的一段：说明小样的目标、最少资产与输出路径；小样审查后再扩展其余场景。列出可复用资产、依赖与最终交付。检查产物集中到 output/qa/，动态小样放 output/previews/。\n',
    'progress.md':
      '# 制作进度\n\n完成一段工作或中断前，用 programmatic-video checkpoint 记录当前阶段、已完成内容和下一步。\n',
    'review.md':
      '# 看片反馈与制作小结\n\n完成后用 programmatic-video finish 保存交付物、用户反馈和经验，并自动沉淀本片风格与有依据的长期偏好。\n',
  };
  for (const [name, content] of Object.entries(templates)) {
    try {
      await writeFile(path.join(root, name), content, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await projectDocument(root, name);
    }
  }
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const assetsRoot = await realpath(path.join(root, 'assets'));
  const assetsRelative = path.relative(root, assetsRoot);
  if (
    assetsRelative === '..' ||
    assetsRelative.startsWith('..' + path.sep) ||
    path.isAbsolute(assetsRelative)
  )
    throw new Error('Assets directory leaves project');
  await projectDocument(root, 'assets/sources.json');
  try {
    await writeFile(path.join(root, 'assets/sources.json'), '[]\n', { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const existing = await workflow(root);
  if (!existing) {
    const now = stamp();
    await saveJson(path.join(root, 'workflow.json'), {
      schemaVersion: 1,
      title: name,
      stage: 'brainstorming',
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    });
  }
  return root;
}
export function memoryDirectory(directory) {
  return path.resolve(
    directory ||
      process.env.PROGRAMMATIC_VIDEO_MEMORY_DIR ||
      process.env.PIXEL_VIDEO_MEMORY_DIR ||
      path.join(os.homedir(), '.pixel-video', 'memory'),
  );
}
function projectMemory(record, directory) {
  return (
    directory ||
    process.env.PROGRAMMATIC_VIDEO_MEMORY_DIR ||
    process.env.PIXEL_VIDEO_MEMORY_DIR ||
    (record?.memory?.file ? path.dirname(record.memory.file) : undefined)
  );
}
export async function readMemory(directory) {
  const root = memoryDirectory(directory),
    file = path.join(root, 'preferences.json');
  const contents = await optional(file);
  const memory =
    contents === null ? { schemaVersion: 1, preferences: [], history: [] } : parseJson(contents);
  if (
    !memory ||
    memory.schemaVersion !== 1 ||
    !Array.isArray(memory.preferences) ||
    !Array.isArray(memory.history)
  )
    throw new Error('Unsupported memory record');
  memory.videos ??= [];
  if (!Array.isArray(memory.videos)) throw new Error('Unsupported video memory record');
  for (const item of memory.preferences) {
    for (const name of ['key', 'value', 'evidence']) text(item?.[name], `memory ${name}`);
  }
  for (const item of memory.videos) {
    for (const name of ['project', 'title', 'style', 'reviewHash'])
      text(item?.[name], `video memory ${name}`);
  }
  return { file, memory };
}
export async function context(directory, memoryDir) {
  const root = await projectRoot(directory),
    record = await workflow(root);
  const documents = {};
  for (const name of ['brief.md', 'plan.md', 'progress.md', 'review.md', 'assets/sources.json'])
    documents[name] = await projectDocument(root, name);
  const { file, memory } = await readMemory(projectMemory(record, memoryDir));
  return {
    project: root,
    workflow: record,
    documents,
    memory: { file, preferences: memory.preferences, videos: memory.videos.slice(-5).reverse() },
  };
}
export async function checkpoint(directory, stage, note) {
  if (!stages.includes(stage)) throw new Error(`stage must be one of: ${stages.join(', ')}`);
  const message = text(note, 'note'),
    root = await projectRoot(directory);
  const project = await readJson(path.join(root, 'project.json'));
  await initWorkflow(root, project.title || path.basename(root));
  const record = await workflow(root),
    now = stamp();
  await appendFile(path.join(root, 'progress.md'), `\n## ${now} · ${stage}\n\n${message}\n`);
  Object.assign(record, { stage, status: 'in_progress', updatedAt: now });
  delete record.completedAt;
  await saveJson(path.join(root, 'workflow.json'), record);
  return record;
}
export async function finish(directory, input, memoryDir) {
  const root = await projectRoot(directory),
    summary = text(input?.summary, 'summary');
  const strings = (name) => {
    if (input[name] !== undefined && !Array.isArray(input[name]))
      throw new Error(`${name} must be an array`);
    return (input[name] || []).map((value) => text(value, name));
  };
  const feedback = strings('feedback'),
    lessons = strings('lessons'),
    deliverables = strings('deliverables');
  if (!deliverables.length) throw new Error('finish requires at least one actual deliverable');
  for (const relative of deliverables) {
    const actual = await realpath(localFile(root, relative)),
      rel = path.relative(root, actual);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
      throw new Error(`Deliverable leaves project: ${relative}`);
    const info = await stat(actual);
    if (!info.isFile() || info.size === 0)
      throw new Error(`Deliverable is empty or not a file: ${relative}`);
  }
  const style = text(
    input.style,
    'style: describe the delivered video so the next project can reference it',
  );
  if (input.preferences !== undefined && !Array.isArray(input.preferences))
    throw new Error('preferences must be an array');
  const preferences = (input.preferences || []).map((item) => {
    if (item?.confirmed !== true)
      throw new Error('A long-term preference requires confirmed: true and actual user evidence');
    return {
      key: text(item.key, 'preference key'),
      value: text(item.value, 'preference value'),
      evidence: text(item.evidence, 'preference evidence'),
    };
  });
  if (new Set(preferences.map((item) => item.key)).size !== preferences.length)
    throw new Error('Duplicate preference keys in review');
  const review = { summary, feedback, lessons, deliverables, style, preferences };
  const digest = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  // Fail before marking the project complete if its shared memory cannot be read.
  const previous = await workflow(root);
  const { file, memory } = await readMemory(projectMemory(previous, memoryDir));
  const project = await readJson(path.join(root, 'project.json'));
  await initWorkflow(root, project.title || path.basename(root));
  const record = await workflow(root);
  const repeated = record.status === 'completed' && record.lastReviewHash === digest;
  const now = repeated ? record.completedAt : stamp();
  const nextMemory = videoFinished({
    memory,
    project: root,
    title: record.title,
    review,
    reviewHash: digest,
    completedAt: now,
  });
  await mkdir(path.dirname(file), { recursive: true });
  if (JSON.stringify(nextMemory) !== JSON.stringify(memory)) await saveJson(file, nextMemory);
  const list = (values) => (values.length ? values.map((v) => `- ${v}`).join('\n') : '尚无记录');
  const marker = `<!-- pixel-video-review:${digest} -->`;
  // A retry after a partial I/O failure must not append the same review twice.
  if (!(await projectDocument(root, 'review.md')).includes(marker)) {
    await appendFile(
      path.join(root, 'review.md'),
      `\n${marker}\n## ${now}\n\n${summary}\n\n### 交付物\n${list(deliverables)}\n\n### 本片风格（供下次参考）\n${style}\n\n### 用户反馈\n${list(feedback)}\n\n### 本次经验\n${list(lessons)}\n\n### 长期偏好\n${preferences.length ? list(preferences.map((item) => `${item.key}: ${item.value}（依据：${item.evidence}）`)) : '本次没有新的明确长期偏好；已保留本片风格供参考。'}\n`,
    );
  }
  if (!(await projectDocument(root, 'progress.md')).includes(marker)) {
    await appendFile(
      path.join(root, 'progress.md'),
      `\n${marker}\n## ${now} · finishing-video\n\n已交付：${deliverables.join('、')}\n制作小结见 review.md，本片风格与明确偏好已写入个人 memory。\n`,
    );
  }
  Object.assign(record, {
    stage: 'finishing-video',
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    lastReviewHash: digest,
    memory: { file, reviewHash: digest, recordedAt: now },
  });
  await saveJson(path.join(root, 'workflow.json'), record);
  return record;
}
export async function remember({ directory, key, value, evidence, confirmed, project }) {
  if (!confirmed)
    throw new Error(
      'Use --confirmed only for a preference the user explicitly expressed or approved',
    );
  key = text(key, 'key');
  value = text(value, 'value');
  evidence = text(evidence, 'evidence');
  let sourceProject = null,
    record;
  if (project) {
    const root = await projectRoot(project);
    record = await workflow(root);
    if (record?.status !== 'completed')
      throw new Error('Finish the project before promoting its feedback to long-term memory');
    sourceProject = record.title;
  }
  const { file, memory } = await readMemory(projectMemory(record, directory));
  const preference = { key, value, evidence, sourceProject, updatedAt: stamp() };
  const next = upsertPreference(memory, preference);
  if (next === memory)
    return { file, preference: memory.preferences.find((item) => item.key === key) };
  await mkdir(path.dirname(file), { recursive: true });
  await saveJson(file, next);
  return { file, preference };
}
