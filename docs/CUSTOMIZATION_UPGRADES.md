# Customization-safe installations and upgrades

This repository is a starting point, not an authority over an installed copy. Once an organization changes branding, screens, workflows, providers, permissions, or deployment behavior, that installation is customer-owned. Setup and future VideoFlow updates must preserve those decisions.

## The rule

Do not reinstall VideoFlow over an existing folder and do not copy a new release tree on top of it. `npm install` may update dependencies in `node_modules`; `npm run setup` may patch selected environment/provider settings; neither command is a source-code upgrade mechanism.

Source updates must arrive as reviewable Git commits or patches. Git can identify overlap with local work; a file-copy installer cannot.

## What an agent must do

An agent working in an existing installation must:

1. Read `AGENTS.md`, this document, and `CUSTOMIZATIONS.local.md` when it exists.
2. Inspect `git status`, the current branch, recent commits, and the incoming diff before editing.
3. Treat every existing modification as intentional unless evidence shows otherwise.
4. Apply only the requested upstream commits or feature patch. Never replace the working tree, reset customized files, or use an automatic “take theirs” conflict strategy.
5. Separate mechanical conflicts from product decisions. If an incoming change and a customization alter the same behavior, preserve both when possible; otherwise stop and ask the installation owner which behavior should win.
6. Keep new optional behavior behind a documented feature switch when retaining the previous behavior is reasonable.
7. Run the required validation suite and report any customization-specific checks that still need a human.

An agent must not delete provider data, rewrite deployment history, rotate credentials, replace logos/assets, or run a destructive migration merely to make an update apply.

## Record local decisions

Installations may create an ignored `CUSTOMIZATIONS.local.md` at the repository root. Agents are required by `AGENTS.md` to read it, but VideoFlow updates do not track or overwrite it.

Recommended contents:

```md
# Installation customizations

## Brand and UI
- `public/logo.svg` is customer-owned.
- Dashboard navigation adds a customer support link.

## Behavior
- Library deletion shortcuts are disabled.
- Custom approval is required before publishing.

## Integrations and data
- Uses a customer analytics adapter in `lib/customer-analytics.ts`.
- Production Convex data must never be reseeded.

## Acceptance checks
- Sign in as an admin and a viewer.
- Record, publish, and open one password-protected share link.
```

Do not put secrets, customer records, tokens, or private URLs in this manifest.

## Safe update workflow

Use a branch and keep the customer branch recoverable:

```bash
git status
git switch -c codex/videoflow-update
git fetch <upstream-remote>
git log --oneline --decorate --graph --all -20
git diff <customer-base>..<incoming-release>
```

Then merge or cherry-pick the requested update in small units. Review every conflict against the local manifest and current behavior. Commit only after tests pass. The exact remote and base vary by installation; never invent them or force-push an update.

For an uncommitted installation, make a recoverable local commit or backup branch before applying upstream source changes, with the owner's approval when that would affect their Git history.

## Setup installer guarantees

`npm run setup` is configuration tooling. It:

- patches only the environment keys owned by the selected setup section;
- preserves unmanaged `.env.local` values, comments, blank lines, and ordering;
- keeps an existing prompted value when Enter is pressed;
- edits one provider section at a time through `npm run config`;
- never copies application source files, replaces assets, commits, resets, or rebases Git;
- does not remove provider settings unless the user explicitly chooses a disabling action;
- exposes optional VideoFlow additions as independent switches where documented.

Full provider setup can deploy the current Convex functions/schema and can change values that the user confirms. Review incoming schema and backend changes before running it on an already customized or production-linked installation.

## Feature switches

Omitting a switch uses the current VideoFlow default. Set a value to `false` to retain the earlier behavior:

| Variable | Default | Controls |
| --- | --- | --- |
| `NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH` | `true` | Front/back and named-camera choices in the recorder |
| `NEXT_PUBLIC_FEATURE_LIBRARY_DELETE` | `true` | Delete from library quick preview and multi-select |
| `NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS` | `true` | Create no-login review requests in the owner UI; existing request links remain usable |
| `NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS` | `true` | Analyze video context and expose task proposal and management controls |
| `NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING` | `true` | Create destinations and enqueue social publishing jobs |
| `NEXT_PUBLIC_FEATURE_ZERNIO` | `false` | Add Zernio as an opt-in social publishing provider |

Run `npm run config`, choose **Optional feature additions**, and restart the development server after changing a switch. These switches hide the optional entry points; they do not delete videos or alter stored data.

## Schema and data changes

Code compatibility and data safety are separate reviews. Before a backend upgrade:

- inspect schema changes and all cleanup/migration functions;
- prefer additive fields and indexes;
- keep old data readable during rollout;
- make migrations resumable and ownership-scoped;
- never infer permission to delete or rewrite customer data;
- verify backups and a rollback path for production changes.

Turning a feature switch off is the first rollback for optional UI behavior. Reverting a Git commit is the source rollback. Data rollback requires an explicit, tested plan; do not assume reverting code reverses a migration.
