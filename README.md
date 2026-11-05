# Pixel Video

**给 UP 主制作像素风视频素材和短片的创作插件。**

和 agent 边聊想法、边看素材，确定场景与画风，再写故事脚本、分镜和计划，逐步做成可继续剪辑的视频。

适合音乐画面、口播配图、角色动作、背景和过场。支持有声或无声工程；图片生成、素材检索和语音转写使用宿主已有能力。

## 怎么工作

**脑暴与收集参考 → 写脚本和计划 → 制作与修改 → 验收和沉淀**

每条视频都有自己的项目目录，保存需求、计划、素材、工程、成片和制作记录。下次可以接着改，也能参考用户明确认可的偏好。

插件面向 **Claude Code / Codex**，包含一个入口 skill、四个创作阶段、启动 hook，以及本地 `pixel-video` CLI。

## 开始使用

准备 Node.js 20+、FFmpeg（含 ffprobe）和 Chrome / Edge 或 Playwright Chromium。

[下载源码 ZIP](https://github.com/Ol1ver0413/pixel-video-plugin/archive/refs/heads/main.zip)，或克隆后从本地安装命令：

```sh
git clone https://github.com/Ol1ver0413/pixel-video-plugin.git
cd pixel-video-plugin
npm install --global .
pixel-video --help
```

这是安装当前源码目录里的 CLI，**暂不向 npm 发布包**。

加载插件后，使用 `using-pixel-video`，告诉 agent 想做什么，也可以带上现有素材：

> 我想做一段雨夜便利店的像素画面，给口播当背景。我们先看看参考，聊聊场景。

[安装与使用说明](docs/getting-started.md) · [CLI 与工程约定](skills/using-pixel-video/references/toolkit.md)

当前是早期版本，依靠 agent 编排和检查作品；已验证本地工具与导出，双宿主完整创作体验仍在逐步验证。

## 交流

抖音号：**47421190572**
