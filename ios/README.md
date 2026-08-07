# VideoFlow for iOS

This directory contains the native SwiftUI client for VideoFlow 2.5.0 (build 1). It uses Clerk for sign-in, the official Convex Swift client for live owner-scoped data, and the existing authenticated R2 upload contract. It is not a WebView.

## Configure and run

1. Copy `Config/VideoFlow.local.xcconfig.example` to `Config/VideoFlow.local.xcconfig`.
2. Replace the placeholder Convex deployment URL and Clerk publishable key. Keep the `https:/$()/` spelling in the xcconfig URL; Xcode expands it to `https://` without treating the slashes as a comment.
3. Generate the Xcode project with `xcodegen generate` from this directory.
4. Open `VideoFlow.xcodeproj`, select your development team, and run the `VideoFlow` scheme.

The local xcconfig is ignored by Git. It contains public client identifiers only; server secrets, R2 credentials, Clerk secret keys, and provider tokens never belong in the iOS target.

## Current native scope

- Clerk sign-in synchronized to `ConvexClientWithAuth`.
- Live owner-only video library with native playback.
- Camera and microphone capture on a physical iPhone or iPad, plus native Photos video import on device and Simulator.
- Direct authenticated R2 upload of MP4 or QuickTime video, followed by the same owner-scoped Convex create action used by the web app.
- No-login review-request creation, live workspace review status, rate-limited reminders, and cancellation.
- AVFoundation composition preview with split, trim, duplicate, delete, speed, volume, transitions, canvas presets, title/caption layers, undo/redo, touch timeline controls, and per-video local draft restore.
- H.264/AAC MP4 export with the iOS share sheet.

Camera hardware is unavailable in Simulator, but Photos import and the remaining UI—including real sample-media editing, draft recovery, and export—can be exercised. Desktop screen capture, imported graphic overlays, background-resumable uploads and exports, and push notifications remain later work.

## Regenerate and verify

```sh
xcodegen generate
xcodebuild -project VideoFlow.xcodeproj -scheme VideoFlow \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO ARCHS=arm64 build
```

App Store archives require an installation-owned bundle identifier, Apple development team, signing certificate, provisioning profile, privacy metadata, and store listing. None of those values are committed by VideoFlow.
