# Pixel Video

[![X: @YZLin151776](https://img.shields.io/badge/X-%40YZLin151776-000000?style=flat&logo=x&logoColor=white)](https://x.com/YZLin151776) [![Douyin: 47421190572](https://img.shields.io/badge/Douyin-47421190572-FE2C55?style=flat&logo=tiktok&logoColor=white)](https://www.douyin.com/search/47421190572?type=user)

[English](README.md) | [简体中文](README.zh-CN.md)

**A creative plugin for making pixel-art video clips and short films with Claude Code or Codex.**

Explore ideas and references with your agent, plan the story and scenes, then build, preview and refine an editable video project.

Use it for music visuals, voice-over backgrounds, character actions and transitions. Projects support audio or silence; image generation, research and transcription use tools available in your host.

**This project is in early development.** We're testing and refining the workflow through real video projects. Try it out, share feedback, or help improve the skills and tools. Issues and pull requests are welcome.

## How it works

**Brainstorm with references → Write the story and plan → Produce and revise → Review, deliver and remember**

Each video gets its own folder for the brief, plan, assets, editable scenes, exports and production notes. Save style references and confirmed preferences for future work.

The plugin includes an entry skill, four creative stages, a session-start hook and a local `pixel-video` CLI.

## Get started

Install Node.js 20+, FFmpeg with ffprobe, and Chrome, Edge or Playwright Chromium.

[Download the source ZIP](https://github.com/Ol1ver0413/pixel-video-plugin/archive/refs/heads/main.zip), or clone the repository and install the local CLI:

```sh
git clone https://github.com/Ol1ver0413/pixel-video-plugin.git
cd pixel-video-plugin
npm install --global .
pixel-video --help
```

This installs the CLI from your local checkout. **The package is not published to npm.**

Load the plugin in your host, then start with `using-pixel-video` and describe what you want to make. Bring your own media or explore references together:

> Create a rainy-night convenience store scene as a background for my narration. Let's look at references and discuss the setting first.

[Setup guide (中文)](docs/getting-started.md) · [CLI and project conventions (中文)](skills/using-pixel-video/references/toolkit.md)

## License

Project code is licensed under [MIT](LICENSE). Bundled fonts retain their [original licenses](skills/using-pixel-video/assets/starter/assets/fonts/LICENSE.txt).
