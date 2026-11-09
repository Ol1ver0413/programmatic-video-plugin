# 可复用媒体工具链

agent 的固定操作统一从 `programmatic-video` CLI 调用。按需要读取本页；作品专属动作仍在场景代码中编排，通用处理不再每片另写检查脚本。

## 时间映射接续字幕与取帧

```sh
programmatic-video audio --input song.m4a --start 71.1 --duration 26 --out clip.wav
programmatic-video captions --input words.lrc --map clip.wav.source.json --out captions.json
programmatic-video render --project "<project>" --scene action --out output/previews/action.mp4
programmatic-video frames --project "<project>" --input output/previews/action.mp4 --map output/previews/action.mp4.report.json --scene action --samples 8
programmatic-video captions --input "<project>/captions.json" --map "<project>/output/previews/action.mp4.report.json" --out "<project>/output/previews/action-captions.json"
```

音频 `.source.json`、新渲染器的 `.report.json` 都有 time_mapping：source_start_seconds/source_end_seconds 是输入区间，output_start_seconds/output_end_seconds 是输出区间，单位为秒。目前保持原速。渲染映射使用实际帧边界，不要用近似的请求起点重新手算。

captions 的 --map 与 --offset/--duration 二选一；接受 SRT、cue JSON、LRC，输出 cue JSON 与简短结果。LRC 多时间标签会展开，同一时刻不同文本保留为多行，不自动删除翻译。带时间的空行可终止前句，末句在选段终点截断。LRC 的 [offset:毫秒] 正值提前、负值延后，按播放时钟补偿解释（对照 [lrc-file-parser 实现](https://github.com/lyswhut/lrc-file-parser/blob/master/src/index.ts)）；与 CLI --offset 选段起点不同。工具不生成文字或逐字对齐。

frames --input 默认按该 MP4 自身秒数解释 --times；加 --map 后，--times 或 --scene 使用项目时间，报告保留 time_requested 和 time_input。旧渲染器未写映射时，用片段内时间，或提供同字段的显式 JSON；不能声称旧工程已自动得到新报告。

## 图集校准与动画消费

```sh
programmatic-video atlas --project "<project>" --input assets/poses.png --columns 2 --rows 1 --out output/qa/poses-candidate.json
programmatic-video atlas --project "<project>" --input assets/poses.png --layout src/poses-layout.json --out src/poses-atlas.json
```

先核对候选区域和源图；需要修正时填写 layout，再调用同一 CLI。例如：

```json
{
  "columns": 2,
  "rows": 1,
  "reference_height": 200,
  "frames": [
    {"region": [0, 0, 300, 400], "anchor": [150, 380], "anchors": {"hand": [210, 170]}},
    {"polygon": [[310, 0], [620, 0], [620, 400], [310, 400]], "anchor": [470, 380]}
  ]
}
```

数值仅示意，须在真实源图内。frames 数量与 columns×rows 一致。region 为 `[x,y,width,height]`，polygon、anchor、anchors 均是源图绝对坐标；polygon 可与包含它的 region 一起提供。reference_height 为共享参考尺度，避免按每姿态包围框独立缩放。

输出 schema_version:1，含源图/哈希、尺寸、区域、alpha 框、候选/显式 anchor、命名 anchors 和 reference_height。boundary_occupancy 和 CLI 的 boundary_frames 提示矩形边缘存在不透明像素；正常贴边也可能触发，需视觉核对。显式配置不代表用户验收，也不能补回源图缺失的衣袖等像素。

新工程的公共绘制实现随初始化复制到 tools/sprites.mjs，由 src/drawing.js 导出；render 调用场景时复用。接入代码：

```js
import { createAtlas, drawSprite, frameAt, valueAt } from './drawing.js';
const metadata = await fetch('src/poses-atlas.json').then(r => r.json());
// 以下在 drawScene 中，图片由工程 assets 提供：
const atlas = createAtlas(assets.actor, metadata);
const pose = frameAt(local, [[0, 0], [0.4, 1]]);
const actor = drawSprite(ctx, atlas, pose, {
  x: valueAt(local, [[0, 100], [1, 160]]), y: 300, height: 220
});
// 仅在当前姿态确有该命名挂点时读取：
const hand = actor?.point('hand');
```

每帧挂点可以不同；画面与挂点共用缩放、翻转、旋转。换源图后重新核对哈希与坐标，运行时校验尺寸。旧 makeAtlas/drawAtlas 保留；已有项目不自动覆盖，迁入公共实现先局部回归。

## 抽帧分页与恢复

```sh
programmatic-video frames --project "<project>" --input output/video.mp4 --times 0.2,0.5,0.8 --out output/qa/action-v1
programmatic-video frames --project "<project>" --input output/video.mp4 --times 0.2,0.5,0.8 --out output/qa/action-v1 --resume
```

PNG 保留原分辨率，提取后立即更新 frames.json。总览只传缩略图，每页最多16张；首张 contact-sheet.png，后续 contact-sheet-002.png 等，结果包含全部 contactSheets。进度写 stderr，stdout 为最终结构化结果。每页拼图有30秒期限，失败/取消保留已有证据。

--resume 要求原 --out，复核源哈希、时间、映射和 PNG 哈希，只补缺失帧、重建联系图。换素材、代码或时间后用新目录。Canvas 指纹覆盖 index.html、src、tools、项目声明的音频/字幕/字体/资产、依赖清单及当前取帧实现；额外动态读取的文件须登记或改用新目录。若只失败在拼图，不必重抽 PNG。

## 编码成片与修改回归

```sh
programmatic-video validate --project "<project>" --input output/video.mp4
programmatic-video validate --project "<project>" --input output/video.mp4 --reference-audio assets/audio/clip.wav --reference-captions output/versions/v1/captions.srt --out output/qa/media-v2.json
programmatic-video validate --project "<project>" --input output/previews/action.mp4 --map output/previews/action.mp4.report.json --captions-file output/previews/action-captions.json
```

--input 检查编码文件尺寸、帧率、帧数、时长、音轨及完整解码，期望来自 project 或场景时间映射。该路径不重写导出字幕。

--reference-audio 是已选好、从0秒对应本视频的音轨，可先用 audio 裁切；不会在整曲里自动搜索。此检查复用 Python+NumPy，同时核对时长差。min-correlation 默认0.98，可按录音条件设置；相关度不代表创作验收。

完整成片默认比较 output/captions.srt 与项目 cue 的文字和毫秒时序；--captions-file 可选 JSON/SRT/LRC。小样须明确提供裁好的 sidecar，否则报告标注未检查。--reference-captions 另比较上一版文字/时间，并报告字节是否一致。此工具不读取视频里烧录的文字，仍需观看编码画面。

检查结果写项目内 QA JSON，失败保留 errors 并返回非零。默认新建报告，--out 拒绝覆盖；不要让后续成功命令掩盖失败。源播放器继续用 validate --playback，两个模式分别运行。
