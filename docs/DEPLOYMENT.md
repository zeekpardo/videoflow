# Production deployment

Vercel is the simplest Next.js frontend host, but any platform that supports Next.js 16 can serve the application. In the bundled browser-first profile, Clerk authenticates users, Convex stores application data and runs backend functions, and R2 stores media. The browser—not Vercel—uploads, plays, renders downloads, and creates a cached finished MP4 or WebM when the owner publishes the latest editor revision.

The optional background-worker profile described in [Rendering and background publishing](RENDERING.md) is bundled in V2: durable Convex jobs, the authenticated worker API, Chromium compositor, Dockerfile, and FFmpeg MP4 conversion ship in this repository. Deploying one or more worker processes is optional. HLS is not included.

## Production data path

1. A compatible browser records MP4 or WebM in browser memory; Safari commonly selects H.264/AAC MP4, while Chromium-family browsers commonly select WebM.
2. The browser requests an authenticated upload URL from Convex.
3. The browser sends each media object directly to private R2; objects above 32 MB use resumable multipart PUTs.
4. Convex verifies object metadata and stores the owner-scoped video record.
5. The owner publishes a foreground MP4/WebM or queues a background MP4/WebM tied to the exact `editRevision`.
6. Public and owner pages request expiring signed R2 `GET` URLs through Convex.
7. When a current finished rendition exists, the public query returns only that rendition URL and omits raw composite, screen, and webcam URLs.
8. Legacy or unpublished videos use browser live composition as a fallback and therefore receive source-layer URLs.
9. Edited downloads still render in real time in the requesting browser.
10. When enabled, a Convex Node action fetches mic-only audio from R2 and sends it to OpenAI or OpenRouter.

Next.js does not proxy normal video bytes. The optional worker also transfers directly through short-lived R2 URLs. Read [Architecture and data flow](ARCHITECTURE.md) for the exact boundaries.

## Create isolated production resources

Create a production Clerk instance, Convex production deployment, and private R2 bucket. Use a new bucket-scoped R2 token and production Clerk keys. Optional OpenAI/OpenRouter and Resend keys should also be separated when clean usage, revocation, and billing boundaries matter.

Do not reuse development credentials, buckets, or deployments. Confirm that the R2 token can access only the intended production bucket.

## Deploy Convex

For a manual deployment:

```bash
npx convex deploy
```

Set every required Convex server variable on the production deployment. Convex CLI flags can change, so verify the target deployment before entering a secret. `npm run doctor` checks the currently selected deployment and never prints values. See Convex's official [environment variable](https://docs.convex.dev/production/environment-variables) and [project configuration](https://docs.convex.dev/production/project-configuration) guidance.

For continuous deployment, follow Convex's [Vercel integration guide](https://docs.convex.dev/production/hosting/vercel), including a production deploy key and the Convex-aware build command. Do not put a production deploy key in a public repository or a browser-visible variable.

## Deploy Next.js to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Choose either the manual Convex deployment above or the official Convex/Vercel continuous-deployment flow; do not accidentally deploy the frontend against a development Convex URL.
3. Add all nine browser/Next.js variables from the README using production values.
4. Deploy and copy the final HTTPS origin.
5. Update both `NEXT_PUBLIC_APP_URL` on Vercel and `APP_URL` in production Convex.
6. Run `npm run r2:cors` while connected to the production Convex deployment.
7. Redeploy Next.js after changing any `NEXT_PUBLIC_*` value.

## Capacity planning

The displayed composite recording size is not the complete storage footprint. A new screen-and-camera recording can store:

- Composite MP4/WebM with mixed audio.
- Native screen-only MP4/WebM.
- Webcam-only MP4/WebM.
- Mic-only transcription audio.
- Thumbnail image.
- Current finished MP4/WebM rendition after the owner publishes the latest editor revision.
- Any PNG, JPEG, or WebP graphics imported into the editor (up to 50 per video).

The primary, screen, webcam, and finished-rendition video objects are each validated against the configured byte limit. The setting is not an aggregate per-recording or per-owner quota. Measure total R2 bytes, object operations, Convex usage, transcription usage, and notification usage on representative recordings before choosing customer-facing limits. Consult current [R2 pricing](https://developers.cloudflare.com/r2/pricing/) instead of embedding a cost assumption in sales material.

Browser capacity is also part of production capacity. Capture retains multiple MediaRecorder chunk sets, and edited export/publication accumulates its complete result in memory. A configured 15-minute or 500 MB limit does not prove a buyer's laptop can complete that capture or render. Native export has a 7680×4320 safety ceiling, but available RAM/GPU and the browser encoder normally become limiting first.

Objects below 32 MB use a single signed `PUT`. Larger files use owner-scoped 8 MB multipart parts with three-way concurrency, per-part retry, and same-file resume for 24 hours. Configure an R2 lifecycle rule that aborts incomplete multipart uploads after one day. Cloudflare documents [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and [multipart uploads](https://developers.cloudflare.com/r2/objects/upload-objects/).

## Production acceptance test

Run the short smoke test:

- Sign-up and sign-in complete on the final domain.
- Two different accounts cannot see each other's private libraries.
- Screen + camera records in desktop Chrome over HTTPS.
- A 10-second recording uploads, plays, and seeks.
- **Save & open editor** navigates directly to the full-page editor.
- Details, thumbnail, sharing, permissions, password, CTA, activity, transcript, and export controls are reachable from the editor.
- **Publish latest** renders and stores a finished MP4/WebM for the current editor revision.
- A rendering-affecting edit makes the prior rendition stale; **Update published video** creates the replacement rather than publishing the stale result.
- A public link opens signed out; a private link does not.
- Password unlock permits playback, transcript, comments, reactions, and permitted downloads.
- Link rotation blocks new page requests through the old share URL. Already issued presigned media URLs remain valid until their own expiry.
- Viewer progress and completion appear for the owner.
- Optional transcript and email behavior matches the selected providers.
- Deletion removes metadata and all known R2 objects.

Then run a realistic envelope test:

- Record and upload a 5–15 minute screen-and-camera video at the intended source resolution.
- Confirm the total size and count of all R2 objects, not just the composite.
- Render native and 1080p edited output in Chrome/Edge and current Safari; confirm the filename/container, duration, seeking, cuts, layout, video quality, and audio.
- Publish the latest revision, then confirm public playback uses only the flattened rendition URL and does not receive raw composite, screen, or webcam URLs.
- Make another rendering-affecting edit and confirm public playback follows the documented unpublished/stale fallback until the owner updates the published video.
- Test public playback in every browser you advertise.
- Interrupt an upload and verify the user sees failure, a retry starts cleanly, and pending cleanup eventually removes abandoned objects.
- Leave an editor and public page open long enough to confirm expiring media URLs refresh or recover according to the implemented application behavior.
- Exercise disabled, successful, too-large, and failed transcription states.

Document the accepted operating envelope—browser version, hardware class, source resolution, duration, and network—alongside the deployment handoff.

## Domain changes

Every final-domain change requires three updates: `NEXT_PUBLIC_APP_URL` on the frontend host, `APP_URL` in Convex, and the R2 CORS rule via `npm run r2:cors`. Authentication redirect/origin settings in Clerk may also need the new domain. Test both signed upload and edited export after any change because canvas export requires readable cross-origin media.

## Presigned media and privacy

R2 presigned URLs are bearer credentials. When the owner has published a finished rendition for the current editor revision, the public query returns only that flattened rendition URL and omits the raw composite, screen, and webcam URLs. Legacy, unpublished, or stale revisions can use live browser composition as a fallback; that fallback necessarily receives expiring source URLs. Download controls hide source-download actions from viewers, but they cannot prevent someone with browser access from inspecting URLs needed by a fallback. Password protection and share rotation guard new application requests; they do not revoke URLs already issued by R2.

The bundled published-rendition path reduces source exposure for current published revisions. Do not promise universal raw-source secrecy while legacy/unpublished fallback remains enabled. The optional worker profile would move rendition creation off the owner's tab and add MP4/HLS; it is not required for the bundled WebM publication path and is not implemented yet.

## Backups and operations

Convex metadata exports and R2 object backups are separate. The repository does not create a consistent point-in-time snapshot across both systems or automate restore. A useful restore requires the Convex records and the exact R2 keys they reference. Back up both, document restore order, and test a restore before making backup, retention, or recovery-time promises.

Do not attach an automatic expiry lifecycle to live source/thumbnail prefixes unless application metadata is updated at the same time. Otherwise Convex can point to missing media. VideoFlow's hourly cleanup handles expired share sessions, old pending uploads, and stale public rate-limit rows in bounded batches; it is not a general retention system.

Monitor provider dashboards because this repository intentionally has no vendor telemetry. The minimum checks, alerts, incident steps, and capacity triggers are in [Operations](OPERATIONS.md).
