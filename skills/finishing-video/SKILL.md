---
name: finishing-video
description: 在像素视频已进入看片、最终导出和交付阶段，或需要整理制作反馈、复盘与个人偏好时使用。
---

# 验收与沉淀

先读 [入口指南](../using-pixel-video/SKILL.md)，用 `pixel-video context` 恢复当前工程。按计划检查实际交付物，再记录反馈。继续局部修改时可回到 producing-video，保留已认可内容。

## 看片和交付

用 `pixel-video render --project "<project>"` 导出。读取导出报告，确认视频尺寸、时长、音轨（如需要）和完整解码。再看片/听音：角色一致性、关键动作的接触与结果、字幕对应、最长字幕、片头和结尾。功能检查不代替审美判断。没有完成的验证如实说明，渲染失败时静帧仍是静帧。

交付实际生成的成片、字幕（如有）、预览与可编辑工程路径。记录用户的修改意见和认可之处；没有反馈时写“尚无用户反馈”，不编造认可。工具只验证文件存在，不替你判断作品已符合需求。

## 每条视频留下小结

在项目保存 `review-input.json`，字段为：

```json
{
  "summary": "本次完成的内容和实际验证范围",
  "deliverables": ["output/video.mp4"],
  "style": "本片实际采用的画风、色板、构图、节奏和字幕处理，供下次参考",
  "feedback": [],
  "lessons": ["本次实践中验证有效、可供下一条视频参考的方法"],
  "preferences": []
}
```

`style` 描述实际成片；没有用户反馈也照常保留风格案例。`preferences` 仅放用户明确表达或认可的长期习惯，没有则留空。例如：

```json
{"key":"subtitle-style","value":"字幕小一些，保留画面主体","evidence":"用户原话：以后我的视频字幕都小一点","confirmed":true}
```

本片临时要求留在反馈和风格案例中。不同 UP 主的专属偏好在 key 中注明所属，例如 `creator:UP主名:subtitle-style`，避免混用。

运行 `pixel-video finish --project "<project>" --input "<project>/review-input.json"`，沿用本用户的 `--memory-dir` 配置。触发条件是这条命令通过交付文件和小结检查；它会自动调用完成回调，将风格案例和明确偏好写进个人 memory，并保存项目复盘，最后标记完成。同一份结果重试不会重复沉淀。执行成功后再报告本版完成；写入失败时修复可写位置并重试，不省略沉淀。

小样、等待制作或用户暂停时用 `checkpoint` 保存进度。之后有新反馈时更新小结并再次 `finish`；如需改片，先 `checkpoint` 重开制作，完成后再收尾。

## 更新个人记忆

后续对话中补充明确的长期偏好时，也可单独运行：

```sh
pixel-video remember --project "<project>" --key "subtitle-style" --value "用户认可的长期字幕偏好" --evidence "用户实际表达或认可的原话" --confirmed
```

`--confirmed` 表示已有用户表达作为依据，不能用来标记自己的猜测。当前要求优先于旧偏好；同一个 key 可更新，旧值留在 history。下次脑暴用 `memory`、续做用 `context` 读取相关记忆。个人记忆留在用户目录，通用 skill 的改进另做，不自动把私人素材或偏好写进公共插件。
