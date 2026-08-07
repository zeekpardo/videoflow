# VideoFlow releases

## 2.5.0 — July 27, 2026

### Added

- No-login review requests with dedicated controlled links, assigned reviewers, due dates, instructions, approve/request-changes decisions, owner reminders/cancellation, and optional Resend delivery.
- Owner-scoped automatic task proposals generated from transcripts, comments, and reviewer change requests, plus direct comment-to-task creation and linked resolved/reopened state.
- Durable, exact-revision social publishing jobs and owner-bound workers for YouTube and LinkedIn.
- A default-off Zernio adapter for unified-provider media upload and immediate social publishing without storing its API key in the browser or Convex.
- A native iOS 17 SwiftUI app with Clerk/Convex authentication, owner library and reviews, camera/Photos import, direct R2 upload, local editor draft recovery, AVFoundation composition editing, MP4 export, and system sharing.
- A native Android Jetpack Compose app with optional Clerk/Convex authentication, owner library/reviews, camera/import upload, local editor draft recovery, touch scrubbing, pinch zoom, Media3 composition playback, H.264/AAC MP4 export, and system sharing.

### Changed

- Added independent feature switches for review requests, automatic tasks, social publishing, and Zernio.
- Improved Safari compatibility across camera/microphone recording, MP4 source-layer upload validation, browser-edited MP4 export, finished-rendition storage, and container-correct downloads/project manifests.
- Updated Next.js to the patched 16.2.12 release and pinned safe PostCSS and Sharp transitive versions; the production dependency audit is clean.
- Expanded setup and architecture documentation for native clients, social workers, public review security, and customization-safe upgrades.
- Aligned web, iOS, and Android marketing versions at `2.5.0`; native build/version codes start at `1`.

### Release boundaries

- The Android app falls back to isolated public sample data when its two public client values are absent. Store signing, background-resumable staging, push notifications, and a first-party CameraX recorder remain follow-up work.
- iOS App Store and Android Play Store distribution require installation-owned bundle/application identifiers, signing, privacy disclosures, and store listings.
- Zernio is optional and defaults off. YouTube, LinkedIn, and Zernio credentials remain worker-only secrets.
- External task-provider delivery is not included; owners approve and manage internal VideoFlow tasks in this release.

### Upgrade notes

- Read `docs/CUSTOMIZATION_UPGRADES.md` before applying this release to a customized installation.
- Apply v2.5 as reviewable Git changes. Do not copy the release tree over an existing installation.
- Run `npm install`, then `npm run config` to review the new optional feature switches.
- Deploy the additive Convex schema/functions before enabling review, task, or social controls in production.
- Keep `NEXT_PUBLIC_FEATURE_ZERNIO=false` unless an installation has deliberately configured a Zernio worker.

## 2.1.0 — July 20, 2026

### Added

- Front/back camera selection for camera recordings on supported phones.
- Delete actions in library quick preview and multi-select.
- Independent feature switches for the mobile camera selector and library deletion shortcuts.
- A customization-safe upgrade contract for installation agents.
- An ignored `CUSTOMIZATIONS.local.md` manifest for installation-specific decisions.

### Changed

- Camera-only recording no longer depends on the browser screen-capture API.
- Unsupported screen-capture modes now show a clear capability message and fall back to camera setup.
- Deleting from the editor returns directly to the library without a transient missing-video page.
- Setup patches only its selected `.env.local` keys and preserves unmanaged values, comments, ordering, blank lines, and line endings.
- The package version is now `2.1.0`.

### Upgrade notes

- Existing behavior remains the default unless an installation disables one of the new switches.
- Set `NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH=false` to retain front-camera-only choices.
- Set `NEXT_PUBLIC_FEATURE_LIBRARY_DELETE=false` to hide the new library deletion entry points.
- Read `docs/CUSTOMIZATION_UPGRADES.md` before applying this release to a customized installation.
- Run `npm install`, then `npm run config` for targeted configuration changes. Do not copy this release over an existing customized folder.

## 2.0.0

- Added AI Director workflows, editable captions, visual SOP generation, organized libraries, interactive viewers, and background publishing.
