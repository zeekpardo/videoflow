# VideoFlow for Android

Native Android client for VideoFlow 2.5.0 (version code 1). The app uses Jetpack
Compose, Clerk's supported Convex bridge, and Jetpack Media3 for playback,
composition preview, and MP4 export.

## Run

1. Open `android/` in Android Studio, or boot an emulator.
2. Build with `./gradlew :app:assembleDebug`.
3. Install with `./gradlew :app:installDebug`.

The app safely uses public sample media when its client configuration is absent. To
connect an installation, copy the two placeholder lines from
`local.properties.example` into the ignored `local.properties` file alongside
`sdk.dir`:

```properties
VIDEOFLOW_CONVEX_URL=https://your-deployment.convex.cloud
VIDEOFLOW_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
```

With both values present, Clerk supplies the signed-in session to Convex, library and
review subscriptions remain identity-scoped, playback uses owner-only presigned URLs,
and camera/import media uploads directly to the owner-scoped R2 grant. These are public
client values; server, R2, social-provider, and signing secrets never belong in the APK.

## Functional editing core

- ordered, non-destructive clip ranges
- local per-video draft restore with debounced and close-time saves
- split, trim, duplicate, delete, undo, and redo
- per-clip speed and volume
- fixed-playhead timeline with drag scrubbing and pinch zoom
- audio, title, caption, and canvas controls
- Media3 `CompositionPlayer` preview
- Media3 `Transformer` H.264/AAC MP4 export and Android share sheet

Preview and export are derived from the same Media3 `Composition`, so visible edits
and rendered output use one source of truth.

## Release verification

```sh
./gradlew :app:assembleRelease :app:bundleRelease \
  :app:testDebugUnitTest :app:lintDebug
```

The generated release APK and app bundle are unsigned. Before release, test both the
sample fallback and a configured test account on a physical device. Play Store delivery requires
an installation-owned application ID, signing key, release signing configuration,
privacy disclosures, and store listing. Do not commit those credentials or artifacts.
