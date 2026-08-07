# VideoFlow 2.5 release handoff

Candidate prepared July 28, 2026. This handoff records source-level verification; it does not represent a production deployment or signed App Store/Play Store submission.

## Automated release gate

- Web/package version, iOS `MARKETING_VERSION`, and Android `versionName`: `2.5.0`.
- Clean lockfile install: `npm ci`.
- Local credential-free environment: `npm run doctor`.
- Web quality gate: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Production dependencies: `npm audit --omit=dev` reports zero vulnerabilities. The remaining full-audit advisory is confined to ESLint's development-only glob-matching dependency and has no compatible upstream patch in the current ESLint line.
- iOS: XcodeGen regeneration followed by the documented unsigned Release build for an arm64 iOS Simulator.
- Android: unsigned Release APK and AAB assembly, debug unit tests, and debug lint.
- Repository hygiene: secret-pattern scan, ignored local provider files, ignored native build outputs, and `git diff --check`.

## Verified compatibility envelope

| Surface | Candidate result |
| --- | --- |
| Web application | Production build passes on Node 22.23.1 and Next.js 16.2.12. |
| Browser test mode | Recording studio and camera-only fallback open without console errors in the local browser smoke test. |
| Safari compatibility | MP4/H.264/AAC recording, source layers, foreground exports, rendition storage, playback/download naming, and metadata-before-seek behavior have focused automated coverage. |
| iOS | Unsigned Release simulator build passes with Xcode 26.3; camera hardware, account connectivity, signing, and export sharing still require a configured physical device. |
| Android | Unsigned Release APK/AAB, unit tests, and lint pass with Android Studio's bundled JDK; connected account and media workflows still require emulator/physical-device acceptance. |

## Installation-owner acceptance before production

1. Back up the intended Convex deployment and R2 bucket, and record the rollback point before deploying additive schema/functions.
2. Run `npm run doctor` against the intended connected environment, then complete the signed-in, password-share, no-login review, automatic-task, and revision-safe publish scenarios in [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
3. Test current desktop and mobile Safari on the supported Apple OS versions, including camera permissions, MP4 recording/upload, seeking, edited export, downloads, password unlock, and review links. Screen capture remains dependent on the Safari/device capability exposed at runtime.
4. If social publishing is enabled, use non-production YouTube/LinkedIn destinations. If Zernio is enabled, use a dedicated test account and keep its API key only in the worker environment.
5. Set installation-owned bundle/application identifiers, signing, privacy metadata, icons, screenshots, and listings before either store submission.
6. Test both native clients on representative physical devices with the installation's public Clerk/Convex values. Never add server, R2, social-provider, or signing secrets to either app bundle.

Publish the release notes from [`CHANGELOG.md`](../CHANGELOG.md) and retain the exact Git tag plus source-archive checksum used for deployment.
