---
name: using-pixel-video
description: 在用户要制作、续做或修改像素风视频与剪辑素材时使用，帮助选择创作阶段、恢复作品工程并使用个人偏好。
---

# Using Pixel Video

这是 Pixel Video 插件的入口指南。仅在像素视频相关任务中进入下面的流程；明确受委派执行某项任务的子 agent 直接完成任务，无需重新发起脑暴。

## 从哪里开始

先识别新作品、续做工程还是局部修改。新作品先运行 `pixel-video memory`，参考相关偏好和以往作品风格；已有项目运行 `pixel-video context --project "<project>"`，读需求、计划、进度和记忆，从当前阶段继续。已有的音频、人物和字幕沿用用户已认可的版本。上下文压缩后也从项目记录恢复。

按需要调用或读取同一插件里的阶段 skill。若宿主没有原生 skill 工具，读取下面链接的 SKILL.md 即可：

| 阶段 | 何时使用 |
| --- | --- |
| [brainstorming](../brainstorming/SKILL.md) | 边聊想法边看用户素材、找参考，对齐场景和风格 |
| [writing-plans](../writing-plans/SKILL.md) | 方向明确后写故事或动作脚本、分镜和制作计划 |
| [producing-video](../producing-video/SKILL.md) | 按计划补素材、编排动画、预览和修改 |
| [finishing-video](../finishing-video/SKILL.md) | 验收交付、记录反馈与经验、更新明确的长期偏好 |

流程的轻重由作品决定：五秒动作可以很快对齐，完整短片再展开。用户已提供清楚脚本时直接据此计划；只改一镜时保留其他内容。只讨论想法时继续讨论，按用户节奏推进。

## 工程、工具与记忆

- 一条视频一个用户可写的项目目录，需求、脚本、素材、工程、成片、进度和复盘放在一起。插件安装目录保持只读。
- 工具入口是 `pixel-video`。未安装命令时，可用 `node "<plugin-root>/scripts/pixel-video.mjs"`；`<plugin-root>` 为此 SKILL.md 上两级目录。详细命令见 [toolkit](references/toolkit.md)。
- `memory/context` 只读个人记忆。`--memory-dir` 或 `PIXEL_VIDEO_MEMORY_DIR` 可指定同一用户跨视频共享的可写目录，默认 `~/.pixel-video/memory`。SessionStart 也会带入已有偏好与最近五条作品的风格；本次明确要求优先，历史风格作为参考。
- 在切换阶段或中断前，用 `checkpoint` 留下已完成内容与下一步。准备交付正式版本时，进入 finishing-video 并运行 `finish`，成功后再向用户报告完成。该命令自动调用完成回调，保存项目小结、本片风格和有用户依据的长期偏好；沉淀失败时不标记完成。用户暂停或仅看小样时保存进度即可。
- 图片生成、素材检索、语音转写使用当前宿主实际可用的工具；CLI 负责文件、时间轴、预览、导出和记录，不自行理解音频或判断用户喜好。
