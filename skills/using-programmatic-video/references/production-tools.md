# 可复用制作工具

适用于批量编辑工程、长片预演、图集准备、镜头运动与重复修改。命令仍通过 programmatic-video 调用；Node API 从 programmatic-video-plugin 导入，共用实现。图片搜索与生成使用宿主工具。

## 当前工程与批量编辑

brief.md 记录当前需求与取舍，plan.md 记录当前内容脚本/分镜，project.json 记录当前执行描述。旧方案通过归档路径引用，不把所有历史 scenes、研究原文和旧配置嵌回活动工程。progress/review 是过程记录；缓存和QA由工具维护。

```sh
programmatic-video context --project "<project>" --summary
programmatic-video project --project "<project>" --scene greeting
programmatic-video project --project "<project>" --files
programmatic-video project --project "<project>" --patch edits.json --dry-run
programmatic-video project --project "<project>" --patch edits.json
```

patch 文件是操作输入，不是第二份活动配置；也支持 --patch - 从stdin读取。示例：

```json
{
  "assets": {"guest": "assets/guest.png"},
  "scenes": [{"id": "greeting", "params": {"offsetX": 12}}]
}
```

set 更新顶层字段，assets 按键合并，scenes 按稳定id更新或新增；对象合并、数组替换。removeScenes/removeAssets 显式移除引用，不删除文件。整体在校验通过后原子保存；无效时间、缺资源、悬空引用不落盘。调整时间时同时提供受影响场景起止和必要的 set.duration，工具返回变化与邻接范围，不自动拉伸音频、字幕或任意旧动画。

--files 提供当前资源引用和目录体积，不凭简单扫描自动删除“未使用”文件。普通 context 的完整读取保持兼容，按需使用。

## 全长预演与正式输出

```sh
programmatic-video render --project "<project>" --profile draft --cache
programmatic-video render --project "<project>" --scene greeting --profile draft --cache
programmatic-video render --project "<project>" --profile final --no-stills --cache
```

draft 保持时间轴与FPS，降低大画幅输出分辨率并使用较快编码；像素画保持整数缩放。默认不额外保存每镜三张静帧，写output/previews，拒绝覆盖正式video.mp4。它检查全片结构、节奏和画面分配，细字/接触仍按需要看原规格。源project.json不改；导出报告保存原工程与实际render_spec，validate/review --report使用实际规格。

新模板为像素画暴露完整的逻辑画布 __frameCanvas：包括烧录字幕。渲染优先传输该画布，再以最近邻放大编码，减少大幅PNG传输；不支持该接口的旧工程、非像素作品沿用完整画布路径。报告记录capture_size、input_png_bytes和capture_seconds。不能从像素面积比例直接宣称等比例提速。

--cache按工程输入、执行代码、规格和范围复用完全相同的已验证导出，校验视频与报告哈希。命中返回captured_frames:0；原始报告的首次渲染耗时保持原义，本次命中耗时在命令结果中。索引在.programmatic-video/cache，引用既有视频，不再复制一整套缓存视频。输入或代码变化则重做。

若本次仍要求样帧，命中只跳过视频编码，样帧照常生成并返回stills_written；旧导出报告保留其首次运行记录。已有独立frames证据时用--no-stills避免重复取样。

## 按场景增量生成

```sh
programmatic-video render --project "<project>" --incremental --profile final
```

仅用于符合隔离约定的确定性Canvas工程，显式设置：

```json
{"rendering": {"sceneCache": "isolated"}}
```

约定：场景读取自己的参数、事件与时间；不读取其他场景的参数来决定画面，不依赖调用顺序、未登记外部文件、实时网络或未固定随机状态。不能确认时用普通render/局部小样，不自动给旧工程加该标记。

增量生成只支持完整时间线：缓存无声场景片段，再统一合成音轨；当前场景参数或其可见字幕改变时重做该段。共享代码、字体、资产等变化保守失效所有段。首次需要生成全部片段；少量局改后才有复用收益。报告列出rendered_scenes/reused_scenes/captured_frames；接缝与完整输出继续验证。字幕若烧录进画面，其变化仍需重渲相关段。

工程修改期间停止输出正式版本，完成后再渲染。工具检测源变化并保护旧成片；未知依赖不能假装局部缓存安全。source.dependencies 可声明src/tools之外的助手文件，纳入校验和快照。

## 图集批量准备

```sh
programmatic-video atlas --project "<project>" --input assets/poses.png --layout assets/poses-layout.json --pack assets/poses-packed.png --out assets/poses-atlas.json --register guest
programmatic-video atlas --project "<project>" --batch assets/atlas-jobs.json --resume
```

batch输入为上述选项对象的数组，不含project；每项可用input/layout/columns/rows/pack/padding/out/register。顺序处理，失败列出已完成项；--resume验证原图、layout、选项和实际输出后跳过有效结果。不同输出不要重名；变化后选新版本路径。

pack 去除透明留白，在同一参考尺度内重排区域，保留半透明边缘并同步移动挂点；polygon mask先烘焙到像素，保留原区域与polygon溯源。候选底点仍要视觉校准，不声称自动识别人手/脚或角色身份。--register仅登记图像引用，场景采用哪些资产仍由工程描述控制。

## 音频收尾与已有字幕时间

```sh
programmatic-video audio --input song.wav --start 130 --duration 100 --fade-out 1.5 --out clip.wav
programmatic-video captions --input timed.lrc --offset 130 --duration 100 --text user-lines.txt --out captions.json
```

fade-in/fade-out以秒计，合计不超过选段；原唱速度不变，source.json保留来源时间映射。--text以规范化文本顺序匹配已有时间戳，保留用户提供的实际文字，报告未使用行；重复句逐次消耗，不合并成一条。匹配不全则报出未匹配时间和文本，不写错误字幕。译文、遮挡写法或改词需提供已确认的对应输入；它不转写、不猜逐字时间，也不自动下载歌词。

## 镜头、事件与动作API

新工程drawing.js导出sceneClock、eventAge、actionAt、cameraAt、cameraPoint、withCamera。模板自动应用scene.params.camera，字幕在镜头变换外绘制。camera可为{x,y,zoom,rotation}，也可为带time的局部时间关键帧数组；每帧完整描述相机状态，默认平滑插值，ease:"linear"为线性。

```js
const age = eventAge(scene, 'impact', time); // scene.events.impact 是片段内秒数
const phase = actionAt(local, { prepare: 0, contact: 0.6, release: 0.7, end: 1.2 });
const camera = cameraAt(local, scene.params.camera, { width, height });
```

动作准备/接触/恢复的时长仍由创作决定。人物、道具、背景和接触点共用镜头坐标；cameraPoint可将挂点转换到屏幕或反向定位。withCamera的viewport可附depth做分层视差。持续在场的角色可改变站位、景别和参与方式；是否必须全程可见按本片要求，不固定在左侧角落。

## 共享取帧证据

```sh
programmatic-video frames --project "<project>" --input output/video.mp4 --report output/render-report.json --times 1,2,3 --cache --width 960
```

--cache按输入哈希、取样时间、宽度及采样器复用。PNG内容按哈希集中在output/qa/.frames，任务frames.json引用真实文件；制作与审片共享已有总览和帧，按需补缺口。--width为最大宽度，不放大原图；细节有疑问时取全尺寸。--resume仍只恢复同一请求，不能拿新源冒充原证据。

报告记录captured_frames/reused_frames，来源、时间与分辨率仍可追踪。损坏帧重建；历史QA引用的blob属于有效证据，不因它在共享目录就随意清空。可重建索引在.programmatic-video/cache，自动整理不删除正式源、成片或有效证据。

## JS接口

```js
import { applyProjectPatch, renderProject, prepareAtlases } from 'programmatic-video-plugin';
await applyProjectPatch(root, { scenes: [{ id: 'greeting', params: { offsetX: 12 } }] });
await renderProject(root, { scene: 'greeting', profile: 'draft', cache: true });
```

API用于本地脚本复用，CLI使用相同实现；不包含模型服务、通用agent调度或eval框架。四种实际制作配方见[制作工作流](../../producing-video/references/production-workflows.md)。
