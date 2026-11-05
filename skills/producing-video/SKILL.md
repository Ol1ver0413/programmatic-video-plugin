---
name: producing-video
description: 在已有像素视频方向和计划，需要准备制作素材、编排动画、预览或修改具体镜头时使用。
---

# 制作视频

读 [入口指南](../using-pixel-video/SKILL.md)，用 `pixel-video context` 恢复工程，再按 `brief.md` 和 `plan.md` 执行。沿用已认可的资产、音频和字幕，局部修改保留其他镜头。命令与接口见 [toolkit](../using-pixel-video/references/toolkit.md)。

## 素材与演出

按分镜补齐素材：复用用户资产，检索可用资产，或使用宿主的图片生成/编辑工具。工具不可用时使用已有素材或原生 Canvas 绘制，清楚说明结果。原文件、参考、提示词和版本放本项目，并更新 `assets/sources.json`。

先做最重要的角色或动作小样，检查再扩展。图集校验 alpha、裁切边界、同一人物的比例和色板。按姿势校准手部、胸口等挂点；严格数字用代码绘制，跟随同一组缩放、翻转和旋转。动作与道具应有真实接触过程，连续帧检查方法见 [direction](../using-pixel-video/references/direction.md)。

在 `src/scenes.js` 编排画面，`project.json` 登记镜头、尺寸和资产；样例代码要按作品改编，不把初始化得到的三个镜头直接当作完成的故事。动画只依赖片内时间和已保存资产，随机效果用固定种子。改变横竖比例时重新构图、统一缩放人物。

## 音画、预览与修改

有音频时保持声音与画面同一时间轴。字幕优先使用用户给出的时间戳；需要转写时用宿主可用工具，注明来源，未对齐的推估不称为逐字准确。原曲字幕减去裁切起点。无声项目用 `audio: null`，无字幕可用 `captions: null` 或空数组；`burnCaptions: false` 保留独立 SRT、导出干净画面。

在作品目录安装渲染依赖，然后用 `pixel-video validate / preview / render --stills` 检查工程、关键帧和实际播放。看动作的前中后帧，也看字幕边界与结尾；用户反馈先作用于相关镜头。

准备交付正式版本时，必须进入 [finishing-video](../finishing-video/SKILL.md)，检查成片并执行 `pixel-video finish`，成功后再报告本版完成。每次 render 只代表一次导出；小样、等待反馈或用户暂停时用 `checkpoint` 保存进度。
