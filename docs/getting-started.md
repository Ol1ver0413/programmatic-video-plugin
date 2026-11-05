# 安装与使用

## 源码与命令

从 GitHub 的 Code → Download ZIP 下载解压，或使用 README 中的 git clone。在源码根目录运行：

```sh
npm install --global .
pixel-video --version
pixel-video doctor
```

命令安装自当前源码目录，包设置为 private，不向 npm 发布。无需运行 `npm install pixel-video`。Node.js 最低 20；建议当前 LTS。音频处理和导出需 FFmpeg/FFprobe。浏览器使用 Chrome/Edge，或作品工程里的 Playwright Chromium。

Windows 若 PowerShell 不允许运行 npm.ps1 或 pixel-video.ps1，使用 `npm.cmd`、`pixel-video.cmd`。命令找不到时确认 npm 的全局命令目录在 PATH 内并重新打开终端。可用 `npm uninstall --global pixel-video-plugin` 移除命令。

工具没有运行时 npm 依赖；全局安装只注册本地 CLI。权限受限时可用 `npm install --global --prefix "/可写的工具目录" .`，自行把该目录（Windows）或其 bin 子目录（macOS/Linux）加入 PATH。安装目录需保留；在源码目录执行 git pull 后再次安装以更新。ZIP 用户重新下载解压并安装，作品和个人记忆放在另外目录。

## 加载到宿主

Claude Code 本地试用，路径替换为源码目录：

```sh
claude --plugin-dir "/absolute/path/pixel-video-plugin"
```

在会话中使用 `/pixel-video:using-pixel-video`，或直接描述想做的像素视频。阶段 skill 也可按插件命名空间调用，避免与别的插件里的 brainstorming、writing-plans 混淆。

Codex 在插件管理中添加本仓库提供的本地 marketplace（`.agents/plugins/marketplace.json`），安装 `pixel-video@pixel-video-local`；按本机版本的 plugin 命令或界面操作。在新会话使用 `$using-pixel-video`，并选择本插件的阶段 skills。

两边包含同一份 SessionStart hook：启动、恢复、clear、compact 或 fork 时注入入口指南、已有偏好与最近五条作品的风格，其他阶段按需加载。Codex 需在 `/hooks` 或设置中审阅并信任插件 hook，安装插件本身不自动批准 hook；更新 hook 后可能需要重新审阅。CLI 安装不会替你修改宿主配置或信任设置。hook 不可用时，手动调用入口 skill 并运行 `pixel-video memory` 仍可工作。

清单和脚本检查不能替代宿主实测；当前尚未在 Claude Code 与 Codex 中分别完成安装到创作交付的全流程验收。接入依据：[Claude Code hooks](https://code.claude.com/docs/en/hooks)、[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)与 [Codex hooks](https://learn.chatgpt.com/docs/hooks)。

## 跑一次本地工具链

新建独立工程后，在该工程中安装 Playwright 渲染依赖：

```sh
pixel-video init --out "./projects/我的视频" --title "我的视频" --duration 6
cd "./projects/我的视频"
npm install
pixel-video validate --project .
pixel-video render --project . --stills
pixel-video render --project .
pixel-video preview --project . --port 4174
```

这是无声样例工程。正式制作让 agent 按 brief.md、plan.md 改写 src/scenes.js；已有音频用 init 的 `--audio`，带合成提示音的工具样例用 `--demo`。这三种初始化方式不混用。缺浏览器时在作品目录运行 `npx playwright install chromium`，也可通过 CHROME_PATH 指定浏览器。

工程里保留 brief.md、plan.md、progress.md、review.md 与素材来源。`pixel-video context --project .` 可恢复项目，`pixel-video --help` 查看完整参数。更多说明见 [CLI 与工程约定](../skills/using-pixel-video/references/toolkit.md)。

正式交付时 agent 会调用 `pixel-video finish`，自动保存本片风格、经验及有依据的偏好，再标记完成。默认保存在 `~/.pixel-video/memory/preferences.json`，下次脑暴读取参考；也可配置 `PIXEL_VIDEO_MEMORY_DIR`。这一步由 CLI 的完成回调执行，小样导出和暂停用 `checkpoint`，不会触发沉淀。

## 开发验证

仓库根目录运行 `npm test`；已创建并安装依赖的有声 demo 可运行 `node tests/smoke.mjs <project>`。无声预览检查使用 `node tests/silent-smoke.mjs <project>`。测试中指定独立 memory 目录，不改个人偏好。

skill 使用 skill-creator 的 quick_validate.py 检查；Claude 插件使用 `claude plugin validate . --strict` 检查。静态验证证明文件与接口有效，创作质量仍需看实际视频。
