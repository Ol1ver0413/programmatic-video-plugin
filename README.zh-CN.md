# Programmatic Video

[![X: @YZLin151776](https://img.shields.io/badge/X-%40YZLin151776-000000?style=flat&logo=x&logoColor=white)](https://x.com/YZLin151776) [![抖音号：47421190572](https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-47421190572-FE2C55?style=flat&logo=tiktok&logoColor=white)](https://www.douyin.com/search/47421190572?type=user)

[English](README.md) | [简体中文](README.zh-CN.md)

**和 AI coding agent 一起制作可编辑的视频。**

一个面向 Codex 和 Claude Code 的开源插件：用 skill 引导创作，用视频工程保存作品，用可复用工具完成制作。把歌词、配音或想法做成像素动画、插画场景或动态图形。

**项目仍处于早期。** 我们正在边做视频边打磨。欢迎试用、提反馈，也欢迎通过 Issue 或 PR 一起改进 skill 和工具。

## 怎么工作

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/production-workflow.zh-CN.dark.svg">
  <img alt="插件完整闭环：脑暴、脚本与计划，主 agent 围绕 project.json 调用 CLI/API 制作，审片反馈后修改、交付；开发时再分析 trace、测试可复用能力，用于下一次任务。" src="docs/images/production-workflow.zh-CN.svg">
</picture>

Agent 写内容脚本，维护一份 `project.json`，调用 CLI/API 准备素材、制作动态小样并导出视频。需要时由一个 reviewer 协助检查，再根据反馈修改同一份工程。

Canvas 用可复用素材编排每一帧，FFmpeg 编码成片。修改场景代码、时间或字幕即可调整视频，不需要每一帧重新生图。

## 开始使用

准备 Node.js 20+、FFmpeg（含 ffprobe），以及 Chrome、Edge 或 Playwright Chromium。

```sh
git clone https://github.com/Ol1ver0413/programmatic-video-plugin.git
cd programmatic-video-plugin
npm install --global .
programmatic-video doctor
```

再按[安装指南](docs/getting-started.md)**将插件加载到宿主**。CLI 安装和宿主加载是两步；目前不向 npm 发布包。

从 `using-programmatic-video` 开始，告诉 agent 想做什么：

> 给这段配音做一条插画视频。我们先聊内容和分镜，做一小段动态小样，再制作后面的部分。

制作结束后，`finish` 保存本片经验和风格案例，长期偏好需要明确确认。开发时再回看 trace 和反馈，把重复工作沉淀为公共工具，测试后通过 PR 更新插件。

[安装与迁移](docs/getting-started.md) · [CLI 与工程约定](skills/using-programmatic-video/references/toolkit.md) · [制作复盘](docs/production-lessons.md) · [更新记录](CHANGELOG.md) · [贡献与发布规则](docs/releasing.md)

WorkBuddy / CodeBuddy 已有分发元数据，桌面兼容性和官方收录尚未验证，见[分发说明](docs/workbuddy.md)。

## 开源协议

[MIT](LICENSE)。附带字体保留各自的[原有许可证](templates/video/assets/fonts/LICENSE.txt)。
