# 每个项目维护一份 project.json

project.json 是本项目持续维护的工程描述。声音与字幕文件、场景代码、素材仍是实际内容文件；它统一登记时间、引用、可调参数与本次用户的专项要求。导出报告和 QA 任务由 CLI 生成，不能成为另一份手工维护的工程配置。

## 场景对应与微调

```json
{
  "id": "greeting",
  "start": 6,
  "end": 10,
  "intent": "Approach, greet, then separate",
  "source": {"file": "src/film.js", "symbol": "greeting"},
  "assets": ["person", "street"],
  "params": {"actorScale": 1, "offsetX": 0}
}
```

source 是代码定位信息，不会自动导入/执行该函数；已有播放器仍按场景入口渲染。assets 是顶层 project.assets 的键，不是重复复制路径。params 放该场景代码实际读取的常调项；不要把尚未接入代码的数字当成有效调节。复杂演出继续在代码里表达，不强迫全部动画变成配置。

```sh
programmatic-video project --project "<project>" --time 8.4
programmatic-video project --project "<project>" --scene greeting
programmatic-video project --project "<project>" --scene greeting --set actorScale --value 0.8
programmatic-video project --project "<project>" --scene greeting --set offsetX --value=-12
programmatic-video render --project "<project>" --scene greeting --out output/previews/greeting-v2.mp4
```

set 只修改已经声明的 params 键，保持类型，拒绝非有限数值。负值用 --value=-12 避免参数歧义。它只更新 project.json，不修改代码或旧视频；返回 rerender_required。新增参数时由制作 agent 同时接入场景代码，并做小样验证。未使用新字段的旧工程正常支持，不自动迁移或覆盖。

## 项目专项检查

```json
{
  "review": {
    "requirements": [
      {"id": "keep-small-characters", "text": "人物在街景内保持较小尺度。", "scenes": ["greeting"], "source": "brief.md 的已确认构图要求"},
      {"id": "keep-original-audio", "text": "保留已确认原声，不增加配音。", "source": "用户本轮反馈"}
    ]
  }
}
```

id 在本项目唯一。scenes 可省略表示全片；reference 可选，指项目内参考文件；source 记录真实需求出处。由制作 agent 从原始要求和最新反馈维护，不能把前作经验自动加入新作品的硬要求。原声字幕、额外字卡、主角与动作执行者等需要区别时写清楚。

## 导出版本与当前工程

新 renderer 在原有导出报告内保存 video_sha256 和 project_snapshot：当时的 project.json、字幕、代码文本和输入路径/哈希。素材以路径与哈希关联，仍应保留实际采用的版本文件；报告不会备份全部二进制素材。渲染中输入变化会拒绝发布，保护原成片。

```sh
programmatic-video project --project "<project>" --input output/previews/greeting-v1.mp4 --time 0.4
programmatic-video validate --project "<project>" --input output/previews/greeting-v1.mp4 --report output/previews/greeting-v1.mp4.report.json
programmatic-video frames --project "<project>" --input output/previews/greeting-v1.mp4 --report output/previews/greeting-v1.mp4.report.json --scene greeting --samples 8
```

project --input 的 time 是该视频秒数，会换算到项目时间；返回对应导出版本的参数/源码信息及 source_matches_current。只读快照不能直接 set；修复仍维护当前 project.json，再导出对应场景。frames/validate 加 --report 时也沿用导出版本，避免当前工程已改动却审错时间或参数。--report 与 --map 二选一。

旧成片没有绑定快照时会标记 unverified，不把当前配置冒认为旧片配置。新工程使用新 renderer；旧工程不自动改工具，必要时使用受支持的 `render --no-stills` 或指定 --out 的内置 Canvas 路径重新导出。参考 [工具约定](toolkit.md) 的接口与自定义后处理限制。
