# CLI 与工程约定

## 入口与能力范围

Node.js 20+，从源码执行 `npm install --global .` 安装 `programmatic-video`，旧的 `pixel-video` 作为命令别名保留。未全局安装时运行 `node "<plugin-root>/scripts/programmatic-video.mjs"`。插件没有运行时 npm 依赖；作品工程安装 Playwright，图像、音频处理和导出使用浏览器及 FFmpeg/ffprobe。

内置运行时是 Canvas：以 `drawScene({ctx,scene,time,local,progress,width,height,assets})` 编排图片、图形、字幕和动画。外部视频混剪、透明视频、自动语音识别/强制对齐、自动循环接缝与任意比例自动重构图未内置。更名不表示这些能力已经实现；有额外需求时先验证宿主工具方案。

## 现有命令

| 命令 | 用途 |
| --- | --- |
| init | 创建独立工程，支持 --audio、--duration 或 --demo |
| context | 读取需求、计划、进度、复盘、素材清单和相关记忆 |
| checkpoint | 保存 --stage 与 --note，重开已完成工程也用此命令 |
| audio | 按 --start、--duration 裁切音频到 --out WAV |
| captions | 将 SRT/JSON 按 --offset、--duration 转为片内字幕 JSON |
| validate | 检查配置、资产、镜头覆盖、字幕和音频，生成 check.json 与 SRT |
| preview | 启动预览服务，可用 --port；音频或独立时钟驱动播放 |
| render | 完整导出、镜头样帧或指定时间范围的动态小样 |
| frames | 按镜头或指定时刻取帧，生成带时间标注的 PNG 总览及报告 |
| finish | 保存交付小结、实际风格与明确偏好，最后标记完成 |
| memory / remember | 读取记录，或以 --evidence、--confirmed 更新明确长期偏好 |
| doctor | 检查 Node/FFmpeg/ffprobe，提示浏览器配置 |

```sh
programmatic-video init --out "./projects/我的视频" --title "我的视频" --duration 6
programmatic-video init --out "./projects/音乐短片" --audio "/path/clip.wav"
programmatic-video init --out "./projects/工具样例" --demo
programmatic-video context --project "./projects/我的视频"
programmatic-video checkpoint --project "./projects/我的视频" --stage producing-video --note "分镜已明确，下一步先验证主要动作"
```

init 不覆盖已有目录、不自动安装依赖。无声默认8秒，--duration 可改；已有音频使用其实际时长；--demo 生成8秒合成提示音。三镜样例需要按创作计划改写。在作品目录运行 `npm install`，缺浏览器时 `npx playwright install chromium`，或用 CHROME_PATH 指定系统浏览器。

## 先看动态小样与动作证据

```sh
programmatic-video render --project "<project>" --scene gate
programmatic-video render --project "<project>" --start 1 --duration 1.5 --out output/previews/action.mp4
programmatic-video frames --project "<project>" --scene gate --samples 8
programmatic-video frames --project "<project>" --times 0.16,0.32,0.50,0.68,0.82
programmatic-video frames --project "<project>" --input output/video.mp4 --times 0.2,1.2,2.2
```

scene 与 start/duration 二选一。小样保持项目的全局时间，角色动作、烧录字幕和音频从同一位置取样；输出从0秒播放，报告同时记录原时间范围与实际帧边界。范围按项目帧网格取帧，不修改 project.json、音轨或字幕时间轴。默认写 output/previews/，不能用局部小样覆盖 output/video.mp4。

范围小样，以及指定 --out 的自定义输出，由插件内置的 Canvas 采样器运行现有播放器，要求工程暴露 `window.__ready`、`window.__render(time)` 和 `#film` 画布；它们不会执行工程自定义的额外后处理。没有范围与 --out 参数的完整导出仍委派工程自己的 tools/render.mjs，旧工程不会因插件升级而被覆盖。

frames 默认从每个镜头取3个内部时刻；--samples 为每镜1–32个；--times 为最多256个明确时刻，不能与 scene/samples 混用。没有 --input 时采样当前源工程；有 --input 时由 FFmpeg 从项目内编码视频提取，时间按该输入视频的秒数解释。局部编码小样请用明确的 --times，避免把片内局部时间当成整片时间。

frames 输出各帧 PNG、带时间标注的 contact-sheet.png 和 frames.json。默认新建独立检查目录；--out 必须是项目内相对目录且为空。报告区分 Canvas 源工程与编码视频证据，不自动判定自然动作或用户满意。PNG 总览也需要项目的 Playwright 和浏览器。

## 音频、字幕与输出

```sh
programmatic-video audio --input "/path/song.mp3" --start 99.94 --duration 30.56 --out "/work/clip.wav"
programmatic-video captions --input "/path/song.srt" --offset 99.94 --duration 30.56 --out "/work/captions.json"
programmatic-video render --project "<project>" --stills
programmatic-video render --project "<project>"
```

audio 输出 WAV 和相邻 .source.json；captions 接受 SRT 或 [{start,end,text}] JSON，筛选、平移并裁到片内范围，均拒绝覆盖已有文件。把工程配置指向生成文件。CLI 不生成歌词或逐字语音时间戳。

audio:null 表示无声；captions:null，或它指向内容为 [] 的 JSON 文件，表示无字幕。burnCaptions:false 输出干净画面，同时保留独立 SRT。范围小样中的烧录字幕仍按全片时间取用；output/captions.srt 是全片字幕，需要单独小样 SRT 时再用 captions 裁取。

H.264/yuv420p MP4 导出检查尺寸、时长、帧数、音轨并完整解码。新渲染器先编码和验证临时文件，再替换输出；报告记录浏览器准备、样帧、绘制与编码、验证耗时。失败保护已存在的视频；多文件发布不是断电级事务。

## 可编辑工程

brief.md 保存意图与确认，plan.md 保存脚本、分镜及验证顺序；progress.md/workflow.json 保存阶段与进度；review.md 保存各版交付与反馈；assets/sources.json 登记来源与采用情况。src/ 是作品代码，tools/ 是随工程复制的工具，output/ 保存成片、小样、字幕和报告。

project.json 使用片内秒数，主镜头连续覆盖全片。默认示例是像素动画，pixelArt:true 使用整数统一缩放与最近邻采样；非像素画面可设 pixelArt:false，选择合适字体与逻辑分辨率，支持非整数统一缩放和平滑采样。切换比例仍需重新构图，不能靠拉伸。

绘图辅助提供 makeAtlas 和 drawAtlas；统一参考高度控制人物缩放，源坐标挂点经裁切、翻转和旋转一起变换。语义、动作设计与审美判断由 agent 完成。

## 收尾与记忆兼容

finish 输入 summary、deliverables、style、feedback、lessons、preferences，详见 [finishing-video](../../finishing-video/SKILL.md)。它检查文件与记录，不代替渲染或看片。相同结果可重试；个人记忆保存失败不标记完成。本次临时反馈和实际风格不自动成为永久偏好。

新版本兼容旧的 pixel-video 命令、PIXEL_VIDEO_MEMORY_DIR、默认 ~/.pixel-video/memory/preferences.json 和既有复盘标记，不搬动私人数据。新环境变量为 PROGRAMMATIC_VIDEO_MEMORY_DIR。

项目命令读取/更新记忆的位置优先级：显式 --memory-dir > 新环境变量 > 旧环境变量 > 工程上次 finish 的 memory.file 所在目录 > 旧默认目录。独立 memory 与 SessionStart 没有当前工程，使用显式目录/环境变量/默认位置。context 和只读 memory 不创建目录。

同一项目再次交付更新该工程的风格案例，长期偏好变更保留 history。记忆当前适合单写入者，多进程同时更新共享文件仍可能丢更新；独立审片角色不写共享记忆。

## 代码职责

scripts/programmatic-video.mjs 是命令入口；skill scripts 内的同名文件只做参数、路由和工具调用。media.mjs 处理音频字幕，project-init.mjs 建工程，workflow.mjs 管理进度与收尾，files.mjs 保存 JSON，frames.mjs 收集视觉证据。模板 tools 内的 project/browser/sampling/server/render 分别负责验证与路径、浏览器、时间选择、预览服务和导出；故事和动作继续留在作品场景代码中。
