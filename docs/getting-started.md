# 安装、迁移与验证

## 安装源码与 CLI

从 GitHub 下载 ZIP，或克隆 programmatic-video-plugin。在源码目录运行：

```sh
npm install --global .
programmatic-video --version
programmatic-video doctor
```

包设为 private，不向 npm 发布。Node.js 最低20；音频和导出需 FFmpeg/ffprobe；作品工程安装 Playwright，浏览器用 Chrome/Edge 或 Chromium。全局 CLI 没有运行时 npm 依赖。

Windows 可使用 npm.cmd、programmatic-video.cmd。命令找不到时检查 npm 全局命令目录的 PATH。没有全局写权限可用 `npm install --global --prefix "/可写目录" .`，把对应命令目录加入 PATH；也可直接用 node scripts/programmatic-video.mjs。

## 从 Pixel Video 迁移

新包名 programmatic-video-plugin，新命令 programmatic-video；pixel-video 继续作为别名。已安装旧的全局源码包时，先 `npm uninstall --global pixel-video-plugin`，再在新源码目录全局安装，避免旧 shim 占用名称。

已有作品目录、src/tools 和个人记忆保持；升级插件不会覆盖作品工具。默认记忆目录仍是 ~/.pixel-video/memory，旧 PIXEL_VIDEO_MEMORY_DIR 继续可用，新变量 PROGRAMMATIC_VIDEO_MEMORY_DIR 优先。项目 context/finish/remember 可以沿用上次 finish 保存的自定义记忆位置。

宿主里的插件名称改为 programmatic-video，入口 skill 改为 using-programmatic-video。安装新插件后停用旧 pixel-video 插件，避免重复的 SessionStart 注入；按宿主流程审阅新 hook，不自动修改信任配置。仅更新源码或安装 CLI 不会刷新宿主插件缓存。

## 加载宿主

Claude Code 可用 `claude --plugin-dir "/absolute/path/programmatic-video-plugin"`，在会话使用 `/programmatic-video:using-programmatic-video`。阶段 skill 使用插件命名空间，避免与其他插件同名 skill 混淆。

Codex 添加本仓库的本地 marketplace（.agents/plugins/marketplace.json），安装 `programmatic-video@programmatic-video-local`，新会话使用 `$using-programmatic-video`。按本机 plugin 命令或界面操作。两种宿主共享技能与 SessionStart；完整跨宿主创作体验仍在验证中。

SessionStart 带入入口指南、已有偏好与最近5条风格案例，其余 skill 按需加载。hook 不可用时手动进入入口并运行 memory/context 即可。原生 hook 仅 SessionStart，finish 的保存逻辑是 CLI 内部完成回调。

## 跑一次本地链路

```sh
programmatic-video init --out "./projects/我的视频" --duration 6
cd "./projects/我的视频"
npm install
programmatic-video validate --project .
programmatic-video render --project . --scene gate
programmatic-video frames --project . --scene gate --samples 8
programmatic-video render --project .
programmatic-video frames --project . --input output/video.mp4 --times 0.2,2.2,4.2
programmatic-video preview --project . --port 4174
```

这是无声工具样例，正式制作需按脚本改写场景。已有音频用 init --audio；合成提示音用 --demo；两者不与 --duration 混用。缺 Chromium 时在作品目录运行 npx playwright install chromium，也可通过 CHROME_PATH 指定系统浏览器。

更多命令和限制见 [工具约定](../skills/using-programmatic-video/references/toolkit.md)。正式交付时保存 UTF-8 review-input.json，再 finish 记录实际风格、经验与明确偏好；小样和暂停只 checkpoint。

## 开发检查

仓库运行 `npm install` 安装开发依赖；`npm test` 跑命令、工作流、hook、时间范围与失败保护，`npm run format:check` 检查代码格式。Prettier 是开发依赖，不进入运行时工具链。

真实浏览器与 FFmpeg 的片段和取帧验证：`node tests/preview-smoke.mjs <已有 Playwright 的 index.mjs 路径>`。它创建并清理自己的工程，不修改该依赖所在作品。播放测试还可用 tests/smoke.mjs 与 tests/silent-smoke.mjs；特殊路径与 BOM 使用 tests/resources-smoke.mjs。

skill 用 skill-creator 的 quick_validate.py 检查。自动检查与采样不等于创作质量验收；没有搭建 eval 框架。
