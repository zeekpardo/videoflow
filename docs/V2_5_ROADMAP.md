# VideoFlow v2.5 release scope

VideoFlow v2.5 is organized as five reviewable vertical slices. This document records what ships in 2.5.0 and the explicitly deferred follow-up work. Each slice preserves buyer customizations, keeps every private Convex operation scoped to the verified identity, and leaves optional providers genuinely optional.

## Delivery order

| Slice | Outcome | Current status |
| --- | --- | --- |
| 2.5A · Review requests | Assigned reviewers approve or request changes from a private link without creating an account | First connected-mode slice implemented |
| 2.5B · Task extraction | VideoFlow proposes bounded tasks from transcripts and timestamped feedback, then creates approved internal tasks | Internal workflow implemented |
| 2.5C · Social publishing | Owners bind destinations and publish one current finished rendition through durable, idempotent jobs | YouTube and LinkedIn worker adapters implemented |
| 2.5D · Native iOS | A SwiftUI app records camera video, uploads directly to R2, manages the library, and participates in review workflows | First native slice implemented |
| 2.5E · Native Android | A Jetpack Compose app provides authenticated library, reviews, playback, camera/import upload, native editing, and MP4 export | Connected native slice implemented |

This order establishes review and task domain models before external integrations. Social publishing reuses the durable job/revision model. Native iOS and Android clients then consume stable auth, upload, library, and review contracts instead of duplicating browser-only behavior.

## 2.5A · No-login video review requests

The first slice uses a dedicated controlled share link for each reviewer. Owners provide a reviewer name and email, optional instructions, and an optional due date. The link can be copied even when Resend is absent. Reviewers can watch, comment, approve, or request changes without Clerk.

Security and rollout gates:

- The share token resolves the video and request server-side; public clients never submit an owner ID.
- Password-protected or email-gated links require a valid, non-expired share session before reading media or writing a decision.
- Reviewer email stays private; the public response exposes only the assigned display name and request state.
- Invitation and response emails are optional and fail independently of recording, sharing, comments, and decisions.
- `NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS=false` hides new creation entry points while preserving existing request links and data.

Implemented in this release: rate-limited reminder delivery and owner cancellation that revokes the dedicated link and its active share sessions. Multi-reviewer policies, full request history, and owner-side review filters remain follow-up work.

## 2.5B · Automatic task creation from videos

Start with a provider-neutral internal task model rather than writing directly to third-party systems. A task records its source video, source timestamp or comment, title, description, assignee hint, due-date hint, state, and provenance. Transcript/comment analysis produces proposals; owners approve or edit proposals before any external side effect by default.

Implementation milestones:

1. Add owner-scoped `videoTaskProposals` and `videoTasks` tables with source timestamps and idempotency keys.
2. Generate deterministic proposals locally from explicit phrases and timestamped change requests; optionally enrich them with the configured OpenAI model.
3. Add an owner review queue with accept, edit, reject, and bulk-create actions.
4. Define a task-provider adapter and durable delivery records for later Linear, Jira, Asana, or other buyer-selected destinations.
5. Add webhook reconciliation only after outbound creation is idempotent and retry-safe.

OpenAI remains optional. Without it, explicit comments and deterministic transcript rules still create useful proposals.

Implemented in this release: owner-scoped proposal and task tables, deterministic and optional OpenAI proposal generation, accept/reject controls, direct comment-to-task creation, manual timestamped tasks, and todo/done state that resolves or reopens its source comment. External task-provider delivery remains a follow-up because no buyer-selected destination has been chosen.

## 2.5C · Social publishing integrations

Social publishing should operate only on a current finished rendition. It must not publish stale edits or expose raw source-layer URLs to a provider. The existing media-job lease, retry, progress, cancellation, and exact-revision checks are the base for a new provider-neutral publish job.

Implementation milestones:

1. Add destination connections, encrypted/externally vaulted provider credentials, OAuth state validation, and server-only refresh handling.
2. Add `socialPublishJobs` with destination, edit revision, caption/metadata snapshot, idempotency key, provider result ID, and retry state.
3. Require an explicit owner preview/confirmation before the first publish to each destination.
4. Upload the current flattened MP4/WebM according to provider capabilities; queue a compatible render first when needed.
5. Record provider status and canonical post URLs without making publishing required for ordinary VideoFlow use.

Provider adapters should be selected only after validating current API access, media limits, review requirements, and buyer demand. Tokens and OAuth callbacks never belong in browser-visible environment variables.

Implemented in this release: owner-bound connection metadata, exact-revision/idempotent jobs, leases, retries, cancellation, progress, and externally vaulted worker tokens for YouTube resumable uploads and LinkedIn Videos + Posts publishing. An optional, default-off Zernio adapter can instead upload the current MP4 to Zernio and publish through one configured Zernio account/platform target. This self-hosted worker path does not itself host an end-user OAuth consent flow or token refresh service; direct workers receive provider tokens from their secret environment, while Zernio owns provider connections behind its separately supplied API key.

## 2.5D · Native VideoFlow iOS app

The iOS app should be a real SwiftUI client, not a WebView wrapper. Its first release should focus on camera capture and review rather than attempting to reproduce desktop screen capture or the full browser compositor.

Initial app scope:

- Clerk-authenticated sign-in and Convex calls using the same verified identity boundary as the web app.
- Camera/microphone recording with interruption handling, background-safe file staging, upload progress, and resumable retry.
- Direct R2 upload through owner-scoped presigned operations; no media proxy through the Next.js host.
- Library browsing, playback, share/review-request management, comments, and review decisions.
- Native notifications for comments, review requests, decisions, and completed background jobs.

Implemented in this release under `ios/`: an iOS 17 SwiftUI/XcodeGen project with Clerk-to-Convex authentication, independent tab navigation, live owner library and playback, physical-device camera capture and Photos video import, direct authenticated R2 upload, review-request creation/reminders/cancellation, live review status, persistent local editor drafts, an AVFoundation composition editor, and real MP4 export. Background-resumable staging, push notifications, imported overlays, and native comments remain follow-up work.

## 2.5E · Native VideoFlow Android app

Implemented under `android/`: a Jetpack Compose app with a supported Clerk-to-Convex authentication bridge, identity-scoped Library and Reviews subscriptions, owner playback, system-camera capture, video import, authenticated direct R2 upload, and a Media3 composition editor. The editor provides persistent local drafts, fixed-playhead touch scrubbing, pinch timeline zoom, split, trim, speed, volume, duplicate, delete, undo/redo, title/caption layers, canvas presets, composition preview, H.264/AAC MP4 rendering, and system sharing.

When the public Clerk publishable key and Convex deployment URL are absent, the APK safely uses its isolated sample workspace; configuring both switches it to the account-backed client. A first-party CameraX recorder, background-resumable uploads/export progress, imported overlays, and notification delivery remain follow-up work. Server/provider credentials are never embedded in the APK.

## Release gates

Every slice must pass `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Schema changes stay additive and old records remain readable. External writes require bounded inputs, idempotency, retry semantics, and owner-visible status. A disabled or unconfigured optional provider must never break recording, playback, sharing, review, comments, or internal tasks.
