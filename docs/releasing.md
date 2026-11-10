# Publishing a release

The plugin, CLI, WorkBuddy / CodeBuddy, Claude Code and Codex manifests share one version. The source is `package.json`; `.version-bump.json` lists the fields synchronized by `scripts/version.mjs`. No npm registry publication is required.

## Prepare a pull request

Work on a topic branch. Choose the release version once, then run:

Run release commands from a source checkout; installed distribution archives do not contain the maintenance scripts.

```sh
npm run release:version -- 0.1.1
```

Add a dated `## [0.1.1] - YYYY-MM-DD` section to `CHANGELOG.md` describing the actual changes. Run:

```sh
npm run release:check
npm test
npm run format:check
```

Open a PR into `main`. Shipped skills, hooks, CLI, templates, agents, manifests, package metadata and compatibility launchers need a newer version in the same PR. Tests and repository maintenance that do not change the installed plugin can keep the version. CI compares the PR against its base, checks all declared versions and release notes, runs regression tests, and verifies the extracted distribution package.

## Merge and publish

`main` is the stable, installable branch. GitHub branch protection requires a PR, the `verify` check, an up-to-date branch, resolved conversations and linear history; it also applies to administrators. A second person's approval is not required for this solo-maintained repository. Do not push directly to `main`.

After merging, the same CI workflow checks the exact merged commit. Its main-only `release` job derives `vX.Y.Z` from the manifest version, creates an annotated tag, builds the distribution and SHA-256 checksum, and publishes the GitHub Release. It does not make a second version commit or push changes to `main`.

Version/tag mismatch stops publication. Existing tags are never moved. Published assets are never overwritten. If a run stops after creating its tag or draft release, rerun that original workflow; draft assets can be uploaded again before publication. A later docs-only commit with the same released plugin version does not create a new release.

The package contains the complete plugin and its bundled font licenses. Production videos, generated assets, local audits, memory, intermediate files and session traces are excluded. Release helpers and CI files are source-maintenance tools, not part of the npm archive.

## Version policy

- Use `0.x.y` while the project is early: compatible fixes and instruction refinements increment the patch; new compatible capabilities increment the minor. Explain breaking changes and migration in the changelog.
- Test versions may use `-beta.N`; prereleases are marked on GitHub.
- Published versions are immutable. Fix a released problem by publishing a newer version.
- The initial release is `0.1.0`. CI allows initial version setup when the base has no changelog and no release tag exists. It also permits retrying the exact commit already tagged `v0.1.0`. Subsequent release versions must increase.

## WorkBuddy updates

The Git marketplace tracks the repository's default `main` branch. Users install the complete plugin and refresh that source, manually or through the host's automatic-update setting. The plugin's manifest supplies its version. Git tags identify released commits; they do not send notifications to WorkBuddy. Host installation/update behavior still needs a real WorkBuddy check before claiming desktop compatibility or official listing.

Branch protection is a GitHub repository setting, not a side effect of this Markdown file or the CI workflow. Verify it after changing repository administration settings.
