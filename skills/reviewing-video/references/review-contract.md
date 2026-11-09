# 一个制作 agent + 一个审片 agent

每个项目维护同一份 project.json。review.requirements 是本片来自用户的额外要求；通用检查由 CLI 提供。制作 agent 统一写源文件，单个 reviewer 在分配的 QA 目录取证和反馈。Codex 等宿主可让一个子 agent 读取 agents/video-reviewer.md；支持 agents/ 的插件宿主可使用该角色。CLI 准备与记录任务，不在内部启动模型或额外 agent。

## 准备一次审片

```sh
programmatic-video review --project "<project>" --input output/previews/action-v1.mp4 --scene action
programmatic-video review --project "<project>" --input output/video.mp4
```

结果返回 task 路径、精确视频哈希、覆盖范围与 technical_ok。任务目录只有自动生成的检查报告与任务数据，位于 output/qa/；不另建手工维护的项目配置。准备时运行一次编码技术检查，把通用检查与范围内的项目专项要求合并。支持 --report 显式选择导出报告，或 --start/--duration 选择范围。

把任务、角色文件和原始需求交给同一个 reviewer；不要把制作 agent 的预设结论当作答案传给它。reviewer 读任务中的 scene_map 和 time_mapping，必要时用 project --input 定位，用 frames --input --report 取编码证据。source_matches_current=false 时检查的是任务指定的旧版，不能以当前源截图代替。

通用检查包括编码技术、意图/内容覆盖、构图与可读性、连续性、按需的动作接触、按需的音画字幕。动作静止可能是设计；无声无字幕不应被判缺失。专项检查按真实用户要求增加，不固定人物、画风、笑点或镜头数量。

## 集中反馈与记录

在指定 QA 目录写 observations.json。例如：

```json
{
  "task_id": "从任务复制",
  "video_sha256": "从任务复制",
  "checks": [
    {"id": "common:media", "status": "pass", "note": "编码规格与完整解码通过。", "evidence": ["output/qa/本次目录/media-check.json"]},
    {"id": "common:composition", "status": "issue", "scene": "action", "time": 8.4, "note": "左臂在切图边界被截断。", "suggestion": "校准此姿态区域并复查同图集邻近姿态。", "evidence": ["output/qa/本次目录/frames/003.png"]}
  ]
}
```

上例不是完整结果，实际应逐项回答任务里的 checks。状态是 pass、issue、not_applicable、unverified。每项需要说明；pass/issue 需要真实项目内证据。issue 用项目时间 time、scene 或全文件 scope:"artifact" 定位，填写建议；time/scene 同时存在时必须对应。

技术、内容、构图和用户专项要求不能用 not_applicable 跳过；看不到或听不到需要的证据就记 unverified。可选动作/声音项在确实不适用时说明原因。sidecar 通过不等于烧录字幕正确，抽样不等于看过全部中间动作。

```sh
programmatic-video review --project "<project>" --task output/qa/本次目录/review-task.json --result output/qa/本次目录/observations.json
programmatic-video review --project "<project>" --task output/qa/本次目录/review-task.json
```

CLI 核对视频、导出报告、技术证据及专项要求是否变化，校验问题定位与证据路径，自动计算状态：needs_changes、incomplete、reviewed。缺项/未验证不会变成通过；多次记录保留修订历史。它验证数据与证据关联，不替代 reviewer 的视觉判断。

## 修改与收尾

制作 agent 集中处理反馈，通过 project 定位和微调，再导出新版本；新视频准备新任务，定向检查修复点、相邻剪辑及共享资产。保持一个 reviewer，不按镜头拆更多 agent。重复同类问题或方向取舍时先汇总原因，不无限重渲/重审。

reviewed 表示这个版本在已记录范围内完成检查，不表示用户已认可，更不表示整片一定检查过。最终交付应对完整视频准备任务；finish 的输入可带 reviewTask 指向它。该字段存在时，CLI 要求任务已 reviewed、对应当前工程且该视频属于 deliverables，才保存完成记录。旧 finish 输入保持兼容。

需要用户确认的是创作方向与真实取舍；常见技术/可定位视觉错误由制作与审片先处理。用户确认与长期偏好继续按真实表达记录。
