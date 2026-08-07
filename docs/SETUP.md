# Complete VideoFlow setup

This guide is written for a buyer starting with no provider accounts. The interactive wizard handles values and deployment; this document explains where each value comes from.

This guide configures a connected VideoFlow installation. To evaluate the product without provider accounts first, use the local test-mode path below.

## Before you start

Install a supported Node.js release (20.19+, 22.13+, or 24+) and Git. From the VideoFlow directory, run:

```bash
npm install
npm run setup
```

Keep the provider dashboards open in browser tabs. Use development/test credentials until the local installation is working.

## Optional: test everything local first

No provider account is required to evaluate the design and recording flow:

```bash
npm run test-mode
npm run dev
```

Open `http://localhost:3000/test`. Recordings are saved to IndexedDB inside the current browser profile. They normally remain after refresh, but IndexedDB is browser-managed, quota-limited storage rather than a backup. Clearing site data, changing browser profile or origin, private-browsing cleanup, storage pressure, or browser eviction can remove recordings. Test mode never sends a recording over the network.

After review, choose **Save & open editor**. The recording saves and the application navigates directly to the same full-page editor used in connected mode. Use its timeline for cuts, crop, timed text, zoom, screen framing, and webcam layout. Use the editor's **Settings** tool for title, description, thumbnail, local sharing, viewer permissions, password, CTA, analytics, and deletion. The library's quick preview is optional; there is no required post-save settings modal.

Use **Simulate a new viewer** on the local viewer page to create additional unique-view and completion scenarios. Local links are deliberately limited to the current browser profile because the video blob is not hosted anywhere.

When ready, run `npm run setup` and choose **Full provider setup**. Local sandbox videos remain local and are not migrated to R2.

## Choose the media profile

The repository includes two deployable media profiles:

- **Browser-first (bundled):** the browser records, uploads directly to R2, composes non-destructive edits for preview/fallback, and renders edited WebM downloads in real time. The owner can choose **Publish latest** (or **Update published video** after further edits) to render and store a finished WebM for the exact editor revision. Public playback prefers a current published rendition. Enabling sharing does not publish automatically.
- **Background render worker (bundled, optional deployment):** a buyer-deployed Chromium/FFmpeg worker renders without an open owner tab and publishes MP4 or WebM through durable jobs. Set `MEDIA_WORKER_SECRET` in Convex and the worker, then follow [Rendering and background publishing](RENDERING.md). HLS is not bundled.

The setup wizard configures the browser-first profile. Worker deployment is a separate optional operations step.

## No-login review requests

Connected installations can create a dedicated review request from a video's share-link panel. Each request gets its own unguessable controlled-share token. The assigned reviewer can watch, comment, approve, or request changes without a Clerk account. If the owner later adds an email gate or password to that controlled link, the public review response requires the same non-expired share session as playback and comments.

When both Resend values are configured, VideoFlow emails the private review link to the assigned reviewer and emails the final decision to the video owner. Without Resend, request creation, copied links, playback, comments, and decisions continue to work. Set `NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS=false` to hide new request creation in an installation that wants the prior sharing UI; this does not invalidate existing review links.

Automatic task proposals and social publishing are also additive. Use `NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS=false` or `NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING=false` to keep the prior editor surface while preserving existing records and jobs. Zernio is a separate opt-in inside social publishing: `NEXT_PUBLIC_FEATURE_ZERNIO=true` exposes it alongside the direct YouTube and LinkedIn adapters; it defaults off.

## 1. Create the Convex project

1. Sign up at [dashboard.convex.dev](https://dashboard.convex.dev).
2. The setup wizard runs `npx convex dev --once`. Sign in when the CLI opens a browser.
3. Choose **Create a new project** and give it a neutral name such as `videoflow-dev`.
4. The CLI links this folder, creates the development deployment, writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`, and deploys the initial schema/functions.

If you cancel this step, finish it manually with `npx convex dev --once`, then rerun `npm run setup`.

## 2. Create the Clerk application

1. Create an app at [dashboard.clerk.com](https://dashboard.clerk.com). Enable email/password or the social providers you want.
2. Open **API keys** and copy the publishable key (`pk_test_…`) and secret key (`sk_test_…`).
3. In Clerk, open **Integrations**, locate Convex, and activate it.
4. Copy the issuer/frontend API URL shown by the integration. It usually resembles `https://your-instance.clerk.accounts.dev`.
5. Paste the three values into the wizard. Secret input displays as bullets.

The issuer is a server value stored in Convex. The publishable key and Next.js secret are written to the ignored `.env.local`. Follow the [official Clerk + Convex integration guide](https://docs.convex.dev/auth/clerk) if the dashboard labels change.

## 3. Create Cloudflare R2 storage

1. Open [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2) and enable R2 for the account.
2. Create a bucket, for example `videoflow-dev`.
3. On the R2 overview, choose **Manage R2 API Tokens** → **Create API token**.
4. Grant **Object Read & Write** and restrict the token to this bucket. Do not use an account-wide token.
5. Copy all three values immediately: token, access key ID, and secret access key.
6. Copy the S3 endpoint. It follows `https://ACCOUNT_ID.r2.cloudflarestorage.com`; do not paste a public bucket URL.
7. Enter the bucket, endpoint, access key ID, secret access key, and API token in the wizard.

Keep the bucket private. At the end, the wizard runs `npm run r2:cors`. This permits signed browser `PUT`, `GET`, and `HEAD` requests from `http://localhost:3000` and the configured app origin; it does not make the bucket public. VideoFlow uses [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) so the browser can transfer an individual object without receiving bucket credentials. Treat every issued URL as a bearer credential until it expires.

A screen-and-camera recording creates six core R2 objects after the owner publishes it:

1. Composite WebM with mixed microphone/system audio.
2. Raw screen WebM for non-destructive layout editing.
3. Raw webcam WebM for independent camera placement.
4. Mic-only audio for optional transcription.
5. Thumbnail image.
6. Current finished WebM rendition for the published editor revision.

Each imported editor graphic adds another PNG, JPEG, or WebP object. VideoFlow allows up to 50 graphic assets per video and validates each at 10 MB or less, no more than 8192 pixels on either edge, and no more than 40 megapixels.

The client uses one signed PUT below 32 MB and resumable 8 MB multipart uploads above that threshold. Per-part state is owner-scoped in Convex, retries three times, and can resume when the same file is reselected within 24 hours. Successfully uploaded objects that never finalize are tracked as pending and become eligible for bounded cleanup. The configured maximum is checked separately against the primary, screen, webcam, and finished video objects, not as one aggregate storage quota. Plan storage and operations using the sum of every object, not only the composite size shown during review. Check current [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before setting customer limits.

Do not add an automatic expiry lifecycle to live video prefixes unless you also add application support for that retention policy; otherwise Convex can retain metadata that points to deleted objects. Do add a one-day abort-incomplete-multipart rule for unfinished upload sessions. See Cloudflare's [multipart uploads](https://developers.cloudflare.com/r2/objects/upload-objects/) and [R2 S3 API tokens](https://developers.cloudflare.com/r2/api/s3/tokens/) documentation.

## 4. Choose transcription

Transcription is optional.

### OpenAI

1. Add billing/credits to the API account. A ChatGPT subscription does not automatically include API usage.
2. Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
3. Choose **OpenAI** in setup and accept `whisper-1` unless you have intentionally adapted the timestamp handling.

VideoFlow sends only the extracted microphone track, only after save, and only when it is under 25 MB. The Convex Node action currently loads that complete audio object into memory and makes one provider request. `whisper-1` returns timestamped segments used by transcript seeking. A failed attempt is marked as an error; the bundled v1 does not provide automatic retries or chunk audio above the limit. The mic-only object remains in R2 until the video is deleted.

### OpenRouter

1. Create an account, add credits, and create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. Choose **OpenRouter** in setup.
3. Accept `openai/whisper-large-v3` or enter another model from OpenRouter's [speech-to-text catalog](https://openrouter.ai/models?fmt=cards&output_modalities=transcription).

VideoFlow uses OpenRouter's [dedicated transcription API](https://openrouter.ai/docs/api/api-reference/transcriptions/create-audio-transcriptions). The normalized response is stored as a searchable full transcript represented by one whole-video timeline segment; it does not currently provide Whisper-style timestamped segments.

## 5. Optional Resend email

1. Create an account at [resend.com](https://resend.com/signup).
2. Add and verify a sending domain. Follow the DNS instructions until the domain is verified.
3. Create an API key with sending access.
4. In setup, enter the key and a sender address on the verified domain, such as `notifications@video.example.com`.

If you skip Resend, recordings and comments continue normally. VideoFlow simply skips notification delivery.

## 6. Verify and launch

```bash
npm run doctor
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and run the short configuration smoke test first:

- The local review plays and seeks before upload.
- **Save & open editor** opens the private full-page editor directly.
- The editor's **Settings** tool contains details, thumbnail, sharing, permissions, password, CTA, and activity.
- **Publish latest** creates a current finished WebM; after another rendering-affecting edit, **Update published video** replaces it with a rendition for the new editor revision.
- Turning on sharing creates a public link.
- The link opens in a private browser window.
- A comment and reaction appear for the owner.
- If enabled, a transcript appears after processing.
- Deleting removes the video from the library.

Then run an operating-envelope test before launch:

1. Record a 5–15 minute screen-and-camera video at the resolution buyers will use.
2. Note the composite size and inspect R2 for the screen, webcam, mic, thumbnail, and published-rendition objects; verify the total fits the buyer's storage budget.
3. Export the edited video at the intended download quality, then choose **Publish latest**, in desktop Chrome or Edge. Keep the tab active and confirm both results have video and audio.
4. Open the public page in current Chrome/Edge plus the playback browsers you plan to support. Confirm it uses the current finished rendition and does not request raw composite/screen/webcam URLs.
5. Test an interrupted upload above 32 MB, reselect the same file, and confirm recorded parts resume rather than restart.
6. Test the transcript states that apply to the installation: done, provider error, disabled, and the 25 MB limit.

The defaults of 15 minutes and 500 MB are configurable guardrails, not a performance guarantee. Browser RAM, GPU, encoder, source resolution, number of simultaneous streams, network speed, and R2/provider limits determine the practical ceiling. Record the hardware/browser combination you accepted for each buyer. Read [Architecture and data flow](ARCHITECTURE.md) and [Operations](OPERATIONS.md) before launch.

## What the wizard changes

- `.env.local`: only keys managed by the selected setup section. Unmanaged values, comments, blank lines, and ordering are preserved, and the file mode is set to owner read/write.
- Convex development environment: Clerk issuer, R2 secrets, brand values, optional transcription, and optional Resend settings.
- Convex deployment: schema, functions, auth config, R2 component, and scheduled cleanup.
- R2 bucket: a CORS rule for the exact application origins.

It does not copy or upgrade application source files, replace custom assets, create or modify Git history, commit credentials, make a bucket public, or configure billing on any provider. Read [Customization-safe installations and upgrades](CUSTOMIZATION_UPGRADES.md) before applying a new VideoFlow release to an existing installation.

## Resetting a local installation

To switch providers or branding, rerun `npm run setup`; pressing Enter keeps existing local values. To connect an entirely different Convex project, use the official Convex CLI to relink the folder first, then rerun setup. Never copy `.env.local` between customers.

For routine changes, use `npm run config`. The configuration manager edits one section at a time:

- Brand, application URL, recording limit, and upload limit
- Clerk and Convex
- Cloudflare R2 and CORS
- OpenAI/OpenRouter transcription
- Resend notifications
- Local test mode versus connected mode
- Optional additions such as review requests, automatic tasks, social publishing, Zernio, the mobile camera selector, and library deletion shortcuts

Restart `npm run dev` after changing any environment value.
