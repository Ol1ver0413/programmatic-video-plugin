# WorkBuddy / CodeBuddy 插件分发

Programmatic Video 按完整插件分发：六个阶段与入口技能、一个审片角色、SessionStart hook、本地 CLI、共享代码和工程模板保存在同一个插件根目录。图片生成、素材检索等能力由宿主提供；插件不捆绑模型服务。

## 当前状态

仓库提供 `.codebuddy-plugin/plugin.json` 和 Git 插件市场清单，复用现有 skills、agents、hooks、bin、cli 与 templates。CodeBuddy 官方规范同时兼容 `.workbuddy-plugin/` 和 `.claude-plugin/`，因此不复制三份组件。

这表示已准备分发结构，不代表已进入 WorkBuddy 官方推荐列表，也不代表已完成 WorkBuddy 桌面端的实际安装与创作验证。投递时应附上实际测试的应用版本、系统和结果。

## 安装与验证

需要 Node.js 20+、FFmpeg / ffprobe，以及 Chrome、Edge 或 Playwright Chromium。插件安装和这些系统依赖的安装是两件事。

在 WorkBuddy 插件页面的添加市场入口，添加本仓库的 Git 地址，再选择 Programmatic Video 安装：

```text
https://github.com/Ol1ver0413/programmatic-video-plugin.git
```

这需要包含 `.codebuddy-plugin/` 的提交已经同步到远端。仅添加市场不会自动安装其中的插件。

CodeBuddy Code 的对应命令为：

```text
/plugin marketplace add Ol1ver0413/programmatic-video-plugin
/plugin install programmatic-video@programmatic-video
```

启用插件后进入 `using-programmatic-video`。CLI 已全局安装或宿主为工具进程加入插件 `bin/` 时，可直接使用 `programmatic-video`。否则，agent 从入口 skill 的路径或 SessionStart 输出确定真实插件根目录，再运行：

```sh
node "<plugin-root>/cli/programmatic-video.mjs" --version
node "<plugin-root>/cli/programmatic-video.mjs" doctor
```

不要假定当前工作目录就是插件目录。若当前宿主未执行 SessionStart，可手动打开入口 skill；CLI 和制作阶段仍可使用。

安装验证至少包括：

- 确认六个技能和一个审片角色可发现，SessionStart 能读到入口说明。
- 从插件目录之外调用 CLI，初始化到独立的可写视频目录。
- 在视频目录安装工程依赖，制作一个短预览并验证导出。
- 修改一个场景参数，重新导出，确认项目记录与画面一致。
- 重启应用，确认插件仍启用，工程可以恢复。

工程、生成素材、输出和个人记忆保存在插件安装目录之外。基础安装步骤见[安装说明](getting-started.md)。

## 官方收录

WorkBuddy 可以添加第三方插件市场；这是向用户分发完整插件的方式，与进入官方推荐列表不同。

[CodeBuddy 官方插件仓库](https://cnb.cool/codebuddy/marketplace)公开接受插件 PR，要求提供 `.codebuddy-plugin/plugin.json`、清楚的 README 和基本安全审查。该仓库是否同步到 WorkBuddy 推荐列表，需向维护方确认，不能把 CodeBuddy 收录写成 WorkBuddy 已上架。

[WorkBuddy 开放平台](https://open.workbuddy.cn/)目前公开了个人开发者入驻和技能 ZIP 的发布规范。完整插件的官方收录应先确认对应入口；不要把本仓库作为单个技能 ZIP 上传，造成兄弟技能、hook 或 CLI 丢失。可向平台公布的 `openworkbuddy@tencent.com` 咨询完整插件的收录方式。

投递材料可复用：仓库地址、MIT 许可证、插件介绍、已验证的安装与卸载步骤、实际宿主版本和系统、作品链接，以及本地文件和记忆的保存说明。移除演示工程、用户素材、个人偏好和会话 trace。

## 官方参考

- [WorkBuddy 插件组成](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Plug-In)
- [WorkBuddy 添加第三方插件市场](https://www.codebuddy.cn/docs/workbuddy/Plugins)
- [CodeBuddy 插件清单、组件和兼容路径](https://www.codebuddy.cn/docs/cli/plugins-reference)
- [CodeBuddy 插件市场](https://www.codebuddy.cn/docs/cli/plugin-marketplaces)
- [WorkBuddy 技能包规范](https://open.workbuddy.cn/docs/skill)
