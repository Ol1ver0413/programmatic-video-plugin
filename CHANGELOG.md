# Changelog

## [0.1.0] - 2026-11-10

First public release of Programmatic Video.

- Create editable videos through six workflow skills, a session-start hook, one optional reviewer, and a local CLI.
- Prepare WorkBuddy / CodeBuddy plugin distribution alongside the existing Claude Code and Codex manifests. WorkBuddy desktop installation and official listing remain unverified.
- Reuse project editing, audio and caption timing, asset preparation, draft rendering, opt-in scene caching, and frame evidence across video projects.
- Plan asset reuse and targeted edits before generation; choose related image sheets or individual images by required detail, and repair failed items without regenerating approved assets.
- Synchronize all plugin versions, check pull requests, and publish matching Git tags and GitHub releases from tested main commits.
- Check code quality with ESLint and Prettier; run one parallel Node 22 job each on Linux, macOS and Windows for regression, extracted-package and real video-rendering checks.
- Resolve project-directory aliases before checking file containment, preserving export and review snapshots on macOS and Windows while rejecting linked inputs outside the project.
- Keep generated videos, private materials, caches, and session traces out of distribution archives.
