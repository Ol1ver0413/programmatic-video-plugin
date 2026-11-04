# 工具与工程约定

## CLI

脚本不依赖 npm 包，需要 Node.js 20+。音频操作和导出需要 FFmpeg/FFprobe；导出还需要 Chrome/Edge 或 Playwright 自带的 Chromium。图片生成与 ASR 由宿主提供，本包没有内置提供商或密钥。

```sh
node "<skill-dir>/scripts/pixel-video.mjs" doctor
node "<skill-dir>/scripts/pixel-video.mjs" audio --input "/path/song.mp3" --start 38.88 --duration 45 --out "/work/clip.wav"
node "<skill-dir>/scripts/pixel-video.mjs" init --audio "/work/clip.wav" --out "/work/my-video"
node "<skill-dir>/scripts/pixel-video.mjs" captions --input "/path/song.srt" --offset 38.88 --duration 45 --out "/work/my-video/captions-aligned.json"
node "<skill-dir>/scripts/pixel-video.mjs" validate --project "/work/my-video"
```

`audio` 写无损 WAV 和相邻 `.source.json` 选段记录，不自动添加淡入淡出。`init` 不覆盖已有目录，不运行 npm，也不会复制整个原始歌曲目录。`captions` 接受 SRT 或 `[{start,end,text}]` JSON；`offset` 是输入时间轴中片头所在的秒数。结果裁到 `[0,duration]`；如不想保留边界处的半句，先调整选段或编辑字幕。它不转写、不生成未听到的歌词。转换后将 `project.json` 的 `captions` 改为 `captions-aligned.json`；转换器不会覆盖已经存在的字幕文件。

## 可编辑工程

```text
project.json          镜头、资源路径、音频、尺寸、帧率
captions.json         逐句起止秒数和文字
src/player.js        播放、字幕、资源加载
src/scenes.js        具体镜头和动作，按作品修改
src/drawing.js       图集裁切、挂点、进度等绘制辅助
assets/              音频、生成图、参考和提示词
tools/               预览服务器、静帧、导出、验证
output/              MP4、SRT、静帧和检查报告
```

`project.json` 的时间全是片内秒数；`scenes` 连续覆盖 `[0,duration]`。`width/height` 是输出尺寸，`logicalWidth/logicalHeight` 是像素画布尺寸，两者保持相同比例和整数缩放。竖屏可以用 1080×1920、逻辑 360×640。

`assets` 是名字到本地相对路径的映射，例如 `{"city":"assets/art/city.png"}`；`src/scenes.js` 的 `drawScene` 接收已载入的图片。项目内文件与输出按路径校验，不包含其他人的绝对电脑路径。

`drawScene` 接口：

```js
export function drawScene({ctx, scene, time, local, progress, width, height, assets}) {
  // ctx 在低分辨率画布上绘制。time 为全片秒数，local 为本镜秒数。
  // 根据 scene.id 编排本作品的动作，不调用音频播放来决定状态。
}
```

`src/drawing.js` 提供 `makeAtlas(image, columns, rows)` 与 `drawAtlas(ctx, atlas, frame, {x,y,height,anchor,flip,rotation})`。`height` 是图集统一参考高度的绘制高度；`anchor` 是当前帧在**完整源图中的** `[x,y]` 坐标，返回它在世界中的位置。用于在空白吊坠处画准确数字，或让道具跟随手掌。alpha 会与已有透明度相乘。

修改画布和底部字幕区域时注意留空间，避免把角色脚底或球落地画进字幕。字体通过工程内的 Fusion Pixel 文件加载，许可随文件保留。

## 命令与输出

进入新工程，运行 `npm install` 后：

- `npm run dev`：本地预览，默认端口 4173，可用 `PORT` 改端口。
- `npm run check`：检查镜头覆盖、字幕区间和资源，再生成独立 SRT。
- `npm run stills`：每镜 3 个检查帧，写入 `output/stills/`。
- `npm run render`：导出 `output/video.mp4` 和 `output/render-report.json`。

渲染器使用 `window.__ready`、`window.__render(seconds)`、`canvas#film`。通过 `CHROME_PATH` 指定系统浏览器；没有系统浏览器时可在工程里运行 `npx playwright install chromium`。依赖只安装到工程里，插件本身不需要 npm 安装。
