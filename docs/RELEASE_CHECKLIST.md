# VideoFlow 2.5 release checklist

Use this checklist to turn the versioned source tree into an installation-specific release. It does not authorize overwriting customer customizations, deploying production data, publishing store builds, or committing credentials.

## Source preflight

- [ ] Read `AGENTS.md`, `docs/CUSTOMIZATION_UPGRADES.md`, and the installation's ignored `CUSTOMIZATIONS.local.md` when present.
- [ ] Review `git status` and the complete release diff; keep unrelated installation changes intact.
- [ ] Confirm `package.json`, iOS `MARKETING_VERSION`, and Android `versionName` are `2.5.0`.
- [ ] Confirm `.env*`, native local configuration, signing material, recordings, and build artifacts remain ignored.
- [ ] Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

## Connected web smoke test

- [ ] Run `npm run doctor` against the intended environment without exposing its values.
- [ ] Record and save a video, edit it, publish the current revision, and play it through a signed-out share link.
- [ ] Verify a password-protected video with and without a valid share session.
- [ ] Create a no-login review request, send a reminder, cancel a second request, submit both decision types, and confirm owner status updates.
- [ ] Generate task proposals with the optional AI provider disabled, convert a comment to a task, and confirm completing/reopening it resolves/reopens the feedback.
- [ ] When social publishing is enabled, publish a non-production test rendition and verify exact-revision status, retry, and cancellation.
- [ ] When Zernio is enabled, use a dedicated test account and verify that its API key exists only in the worker environment.

## iOS candidate

- [ ] Copy `ios/Config/VideoFlow.local.xcconfig.example` to the ignored local config and add public client values only.
- [ ] Generate the project with XcodeGen and run the Release simulator build documented in `ios/README.md`.
- [ ] On a physical device, test sign-in, library playback, camera/Photos import, upload, review creation/reminders/cancellation, draft recovery, editing, MP4 export, and sharing.
- [ ] Before App Store submission, set the installation-owned bundle identifier, team, signing, privacy metadata, icons, screenshots, and listing.

## Android candidate

- [ ] Run the release build, unit test, and lint command documented in `android/README.md`.
- [ ] Test both modes: blank client values use the sample workspace; configured public Clerk/Convex values require sign-in and load only that owner's library/reviews.
- [ ] On an emulator and representative physical device, test camera/import upload, playback, draft recovery, every timeline operation, undo/redo, MP4 export, and sharing.
- [ ] Before Play Store submission, select the installation-owned application ID and signing key, then add privacy metadata, icons, screenshots, and listing.

## Release handoff

- [ ] Record the accepted browser/OS/device matrix and any installation-specific smoke tests.
- [ ] Back up the production data stores and document schema rollback constraints before deployment.
- [ ] Create the Git commit and annotated `v2.5.0` tag only after the final diff and validation output have been reviewed.
- [ ] Publish release notes from `CHANGELOG.md` and retain the exact source revision used for every deployed web or native artifact.
