---
name: using-programmatic-video
description: 在用户要用代码制作、续做或修改视频、动画、配音配画或动态图文时使用，选择创作阶段、恢复项目并调用本插件工具。
---

# Using Programmatic Video

入口负责选择当前需要的工作。用户只想讨论就继续讨论；已有明确脚本、正在续做或只改一镜时，从对应阶段进入。受委派的子 agent 直接执行指定任务，不重新发起全片脑暴。

## 开始或恢复

新作品参考 `programmatic-video memory`；接手已有工程或上下文压缩后运行 `programmatic-video context --project "<project>"`。本轮已读且未变化的记录不用每镜重新全量读取。当前要求优先，历史风格只是案例；项目内的临时反馈不自动变成永久习惯。

和用户对齐用途、内容、声音、画幅与观看感受。pixel 是可选画风；音乐、旁白、讲解、氛围循环和动作片段的节奏不同。先查 [工具约定](references/toolkit.md) 确认实际能力，再承诺输出格式或外部视频剪辑方案。

| 工作 | 何时使用 |
| --- | --- |
| [brainstorming](../brainstorming/SKILL.md) | 边讨论边收集参考，明确场景与观看感受 |
| [writing-plans](../writing-plans/SKILL.md) | 把内容写成带时间的脚本、分镜和验证顺序 |
| [producing-video](../producing-video/SKILL.md) | 先做代表性动态小样，再制作其余场景并局部修改 |
| [reviewing-video](../reviewing-video/SKILL.md) | 检查语义、动作、音画与交付文件，必要时独立审片 |
| [finishing-video](../finishing-video/SKILL.md) | 交付本版、记录反馈与经验、保存有依据的偏好 |

## 工程与工具

- 一条视频一个可写目录；`brief.md`、`plan.md`、素材、代码、进度、预览和成片放在一起，安装目录保持只读。
- 命令入口是 `programmatic-video`，旧命令 `pixel-video` 保留兼容。未全局安装时运行 `node "<plugin-root>/scripts/programmatic-video.mjs"`；插件根目录为本文件上两级。
- 阶段切换、关键进展或中断前用 `checkpoint` 记录已完成、下一步、待验证内容、当前小样和素材版本。它记录进度，不是代码快照。
- 指定镜头/时间范围的动态小样用 `render --scene` 或 `render --start --duration`；取帧与带时间标注的总览用 `frames`。先看关键风险，再决定是否扩展生图和制作。
- 素材搜索、图像生成与语音转写使用宿主实际可用能力。工具不代替故事、审美和用户偏好的判断。
- 准备正式交付时调用 finishing-video 的 `finish`，成功后报告本版完成。它保存复盘与风格；小样、暂停和等待反馈只记录进度。

记忆支持 `--memory-dir`、`PROGRAMMATIC_VIDEO_MEMORY_DIR`，并兼容旧环境变量与默认目录。已有项目可沿用上次 finish 保存的位置，规则见 [工具约定](references/toolkit.md)。
