# Repository workflow

- Change this repository on a topic branch and open a pull request into `main`. Do not push directly to `main`, including routine fixes and release preparation.
- `main` is an installable release source. Changes to shipped skills, hooks, CLI, templates, agents, or plugin manifests require a new unified version and dated `CHANGELOG.md` entry in the same PR.
- Use `npm run release:version -- X.Y.Z` to synchronize all version fields. Do not update host versions independently. Run `npm run release:check` and the relevant tests before committing.
- GitHub Actions validates the PR and merged commit. Only its successful main workflow publishes `vX.Y.Z` and the matching GitHub Release. Do not move existing tags or publish from a feature branch.
- Keep `.context/`, `.work/`, production projects, generated assets, private memory and trace data out of commits and release packages.
- Keep the video tools general. Do not turn preferences from a single video into universal skill rules. Use one producing agent and, when useful and authorized, one reviewer.
- WorkBuddy distribution metadata is not proof of desktop compatibility or official listing. Describe only tests actually run.
