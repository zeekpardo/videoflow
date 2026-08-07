# Instructions for an installation assistant

Read `AGENTS.md`, `README.md`, `docs/SETUP.md`, and `docs/CUSTOMIZATION_UPGRADES.md` completely before changing this installation. If `CUSTOMIZATIONS.local.md` exists, read it as well.

## First installation

1. Inspect `git status` and confirm whether this folder is already a Git repository.
2. If it came from a ZIP and is not a repository, explain the value of a private baseline and ask before running `git init`, staging files, committing, or connecting a remote. Never push automatically.
3. Run `npm install`.
4. Start with `npm run test-mode` unless the owner explicitly wants connected provider setup.
5. Run `npm run doctor` and the required validation suite.
6. Never print, copy between customers, or commit secrets.

## Existing or customized installation

Do not copy this release over the existing folder. Apply it as a reviewable Git patch or merge, preserve all unrelated changes, and stop for owner direction when an incoming change conflicts with a documented customization.

Use `npm run config` for targeted configuration changes. The setup tool is not a source-code updater.

## Required validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For a connected deployment, also run the acceptance checks in `docs/SETUP.md` before delivery.
