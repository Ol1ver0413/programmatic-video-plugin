# Programmatic Video

[![Douyin: 47421190572](https://img.shields.io/badge/Douyin-47421190572-FE2C55?style=flat&logo=tiktok&logoColor=white)](https://www.douyin.com/search/47421190572?type=user)

[English](README.md) | [简体中文](README.zh-CN.md)

**Make editable videos with an AI coding agent.**

An open-source plugin for Codex and Claude Code: workflow skills, an editable video project, and reusable media tools. Turn lyrics, narration or an idea into pixel animation, illustrated scenes or motion graphics.

**Still early.** We're improving it through real video projects. Try it, share feedback, or help build the next useful tool. Issues and pull requests are welcome.

## How it works

![The creation and tool-improvement loop: brainstorm, script and plan, produce and review using project.json, then learn reusable operations from traces for the next task.](docs/images/production-workflow.svg)

The agent writes the script, maintains one `project.json`, and calls the CLI/API to prepare assets, make a moving draft and render the video. One reviewer can help check it; feedback guides edits to the same project.

Canvas composes frames from reusable assets, and FFmpeg encodes the video. You can revise the scene code, timing or subtitles without generating every frame from scratch.

## Get started

You'll need Node.js 20+, FFmpeg with ffprobe, and Chrome, Edge or Playwright Chromium.

```sh
git clone https://github.com/Ol1ver0413/programmatic-video-plugin.git
cd programmatic-video-plugin
npm install --global .
programmatic-video doctor
```

Then **load the plugin in your host** using the [setup guide](docs/getting-started.md). CLI installation is separate from plugin loading; the package is not published to npm.

Start with `using-programmatic-video` and describe what you want to make:

> Make an illustrated video for this narration. Let's work out the story and try a short moving draft before producing the rest.

After production, `finish` saves project lessons and style examples; long-term preferences require explicit confirmation. Separately, we review traces and feedback, turn repeated work into shared tools, then test and ship changes through PRs.

[Setup](docs/getting-started.md) · [Tools](skills/using-programmatic-video/references/toolkit.md) · [Production lessons](docs/production-lessons.md) · [Releases](CHANGELOG.md) · [Contributing](docs/releasing.md) — guides are currently in Chinese.

WorkBuddy / CodeBuddy metadata is included; desktop compatibility and official listing are still unverified. See the [distribution notes](docs/workbuddy.md).

## License

[MIT](LICENSE). Bundled fonts retain their [original licenses](templates/video/assets/fonts/LICENSE.txt).
