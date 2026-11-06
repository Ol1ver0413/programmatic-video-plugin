# Programmatic Video

[![X: @YZLin151776](https://img.shields.io/badge/X-%40YZLin151776-000000?style=flat&logo=x&logoColor=white)](https://x.com/YZLin151776) [![抖音号：47421190572](https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-47421190572-FE2C55?style=flat&logo=tiktok&logoColor=white)](https://www.douyin.com/search/47421190572?type=user)

[English](README.md) | [简体中文](README.zh-CN.md)

**和 Claude Code / Codex 一起制作可编辑、由代码驱动的视频，面向 UP 主和内容创作者。**

从歌词、配音或一个想法出发，讨论脚本与分镜，先做动态小样，再逐步制作、审片和导出。Pixel animation 是一种画风，插画、动态图文和配音配画也可以沿用这套流程。

**项目仍处于早期。** 我们正在通过实际视频制作持续打磨。欢迎试用、分享反馈，也欢迎通过 Issue 或 PR 一起改进 skill 和工具。

## 怎么工作

**脑暴与收集参考 → 写脚本和计划 → 做动态小样 → 制作、审片与交付**

每条视频都有自己的工程目录，保存需求、计划、素材、场景代码、小样、成片和制作记录。下次可以接着改，也能参考已有风格与用户明确认可的偏好。

插件包含一个入口 skill、四个创作阶段、一个可复用的审片 skill、启动 hook 和本地 `programmatic-video` CLI。内置渲染目前使用 Canvas 编排图片、动画和图形，通用外部视频剪辑仍是后续扩展方向。

## 开始使用

准备 Node.js 20+、FFmpeg（含 ffprobe）和 Chrome / Edge 或 Playwright Chromium。

[下载源码 ZIP](https://github.com/Ol1ver0413/programmatic-video-plugin/archive/refs/heads/main.zip)，或从本地源码安装：

```sh
git clone https://github.com/Ol1ver0413/programmatic-video-plugin.git
cd programmatic-video-plugin
npm install --global .
programmatic-video --help
```

**暂不向 npm 发布包。** 加载插件后，使用 `using-programmatic-video`，告诉 agent 想做什么。

> 我想给这段配音做插画视频。我们先聊分镜，做个开场小样，再制作后面的部分。

[安装与迁移](docs/getting-started.md) · [CLI 与工程约定](skills/using-programmatic-video/references/toolkit.md) · [真实制作复盘](docs/production-lessons.md)

项目原名 `pixel-video-plugin`。旧的 `pixel-video` 命令和已有记忆继续兼容。

## 开源协议

项目代码采用 [MIT 协议](LICENSE)。附带字体保留各自的[原有许可证](skills/using-programmatic-video/assets/starter/assets/fonts/LICENSE.txt)。
