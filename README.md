# Programmatic Video

[![X: @YZLin151776](https://img.shields.io/badge/X-%40YZLin151776-000000?style=flat&logo=x&logoColor=white)](https://x.com/YZLin151776) [![Douyin: 47421190572](https://img.shields.io/badge/Douyin-47421190572-FE2C55?style=flat&logo=tiktok&logoColor=white)](https://www.douyin.com/search/47421190572?type=user)

[English](README.md) | [简体中文](README.zh-CN.md)

**An agent plugin for making editable, code-driven videos with Claude Code or Codex.**

Start with lyrics, narration or an idea. Work with your agent on the script and scenes, make a moving draft, then refine and export the video. Pixel animation is one style; illustrated scenes, motion graphics and narration visuals can use the same workflow.

**This project is in early development.** We're testing it through real video projects. Try it out, share feedback, or help improve the skills and tools. Issues and pull requests are welcome.

## How it works

**Brainstorm with references → Write the script and plan → Build a moving draft → Produce, review and deliver**

Each video has its own brief, plan, assets, editable scenes, previews and production notes. Keep useful style examples and explicitly confirmed preferences for future work.

The plugin includes an entry skill, four creative stages, a reusable review skill, a session-start hook and a local `programmatic-video` CLI. Built-in rendering currently uses Canvas for image assets, animation and graphics; general external-video editing is still a future extension.

## Get started

Install Node.js 20+, FFmpeg with ffprobe, and Chrome, Edge or Playwright Chromium.

[Download the source ZIP](https://github.com/Ol1ver0413/programmatic-video-plugin/archive/refs/heads/main.zip), or install from a local checkout:

```sh
git clone https://github.com/Ol1ver0413/programmatic-video-plugin.git
cd programmatic-video-plugin
npm install --global .
programmatic-video --help
```

**The package is not published to npm.** Load the plugin in your host, start with `using-programmatic-video`, and describe what you want to make.

> Make an illustrated video for my narration. Let's discuss the scenes and try the opening before producing the rest.

[Setup and migration (中文)](docs/getting-started.md) · [CLI and project conventions (中文)](skills/using-programmatic-video/references/toolkit.md) · [Lessons from real productions (中文)](docs/production-lessons.md)

Formerly `pixel-video-plugin`. The `pixel-video` CLI alias and existing memory remain compatible.

## License

Project code is licensed under [MIT](LICENSE). Bundled fonts retain their [original licenses](skills/using-programmatic-video/assets/starter/assets/fonts/LICENSE.txt).
