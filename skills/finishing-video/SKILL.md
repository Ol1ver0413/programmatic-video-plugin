---
name: finishing-video
description: 在视频准备正式交付，或需要整理本版反馈、制作复盘、风格案例与明确长期偏好时使用；检查完整成片并保存完成记录。
---

# 验收与沉淀

按 [入口指南](../using-programmatic-video/SKILL.md) 恢复工程，保留已认可内容。局部修改可回到 producing-video；正式交付本版时仍检查完整成片。

## 检查实际交付

draft只作预演；正式交付使用final规格。检查实际render_spec与对应报告，不能用草稿审片结束正式交付。增量合成也要检查完整编码与镜头接缝；缓存命中只说明技术复用。

用 `programmatic-video render --project "<project>"` 导出完整视频，读取报告并按 [reviewing-video](../reviewing-video/SKILL.md) 检查实际编码成片、音频和字幕。核对脚本中必须出现的内容；小样只证明其覆盖范围，检查工具不判断用户满意。

用 `programmatic-video validate --project "<project>" --input output/video.mp4` 检查实际编码文件；需要保持已认可的音轨或 sidecar 时加 --reference-audio/--reference-captions。读取失败报告并修复，不用一次性 finalize 脚本重新实现媒体核验。用户要求的字幕或其他交付缺口应尽早明确输入与交付范围，不能因允许导出而自动视为取消。

交付真实成片、字幕（如有）、可编辑工程和必要的审查证据。说明哪些已验证、哪些只是抽样、是否还有未解决问题；没有用户反馈就记录尚无反馈。需要 HTML 交接页时，复用工程内的交付、素材和环境信息，不另维护一套版本与镜头常量。

## 收尾输入

在 `output/qa/` 中以 UTF-8 保存 `review-input.json`（已有工程可沿用原位置），读回确认文字完整、路径对应本版产物后再执行 finish：

```json
{
  "summary": "本次完成内容、版本与实际验证范围",
  "deliverables": ["output/video.mp4"],
  "style": "本片实际画风、构图、节奏、动作或信息呈现与字幕处理",
  "feedback": [],
  "lessons": [],
  "preferences": []
}
```

使用了独立审片任务时，在输入增加 `reviewTask: "output/qa/本次目录/review-task.json"`。交付前对完整视频审查；CLI 会要求任务 reviewed、工程与导出对应且视频在 deliverables 中，不能用只审一段的小样代替全片。审片任务和记录自动生成，project.json 仍是唯一持续维护的工程描述。

style 是实际风格案例，不代表长期喜好。反馈写用户真实表达；lessons 写经过实践的经验，保留“哪项决定→观察到什么→下次适用条件”，不要只堆完成事项。后续反馈到来时沿用本工程补充，不把最初的“尚无反馈”当成永久结论。关键事件理解错误、动作演出不足、素材不合格与导出问题分开记录，便于下次知道该改哪一层。

用户接受或提出修改时，及时用 checkpoint 记录原话、对应产物路径/版本和仍未验证的项目，不留到下一次恢复再猜。feedback 与 lessons 当前各为字符串数组，可将“决定→观察→适用条件”写在一条字符串内。若完整审片仍有未验证项，先保存真实反馈和待补复盘，保留 review 状态；不要删 reviewTask 或改成全部通过来绕过 finish。

```sh
programmatic-video finish --project "<project>" --input "<project>/output/qa/review-input.json"
```

该命令检查交付文件和小结，再调用内部完成回调保存本片风格、明确偏好与项目复盘，最后标记完成；它不替代看片或媒体验证。同一份结果可重试，保存失败时修复并重试。调用成功后再报告本版完成，不能据此宣称用户已认可。

## 长期偏好与续做

preferences 只填用户明确表达或认可的长期习惯，要求 key、value、evidence 和 confirmed:true；没有就留空。本片“动作更有意思”等反馈保留在本片，除非用户明确要求以后沿用。不同创作者可使用 `creator:名字:偏好项` 的 key。

后续补充明确偏好可用 `remember --key ... --value ... --evidence ... --confirmed`；带 `--project` 时该项目须已完成。当前要求优先于历史记录。个人记忆不自动回写公共 skill。

继续改片先 checkpoint 重开工程；新版交付更新小结再 finish。使用同一记忆配置，具体恢复与兼容规则见 [工具约定](../using-programmatic-video/references/toolkit.md)。小样、暂停或等待反馈时只保存进度。
