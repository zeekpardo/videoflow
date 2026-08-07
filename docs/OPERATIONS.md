# Operations, capacity, and incident runbook

This guide covers the bundled browser-first deployment and the optional buyer-deployed V2 worker described in [Rendering and background publishing](RENDERING.md).

## Operational ownership

Each buyer owns and pays for their installation's resources:

| System | Operational responsibility |
| --- | --- |
| Next.js host | Availability, builds, domains, browser-facing environment values, logs |
| Clerk | Authentication configuration, allowed origins/redirects, keys, user support |
| Convex | Schema/functions, server environment, data usage, action failures, schedules, backups |
| Cloudflare R2 | Bucket credentials, CORS, object bytes/counts, operations, backup/retention |
| OpenAI/OpenRouter | Optional transcription key, spend, provider errors, data policy |
| Resend | Optional domain verification, key, delivery logs, suppression/bounce handling |
| Buyer | Privacy notice, retention policy, support, incident response, and tested recovery |

VideoFlow intentionally has no central vendor telemetry. The seller cannot see or operate a buyer's deployment unless the buyer separately grants access.

## Baseline operating envelope

The default values—15 minutes and 500 MB—are configurable guardrails, not a production capacity SLA. Browser recording, export, and publication can hit memory, encoder, GPU, or device limits first. Connected storage can be much larger than the composite size because a published screen-and-camera recording may retain composite, screen, webcam, mic, thumbnail, finished-rendition, and imported editor-graphic objects.

Before launch, record an accepted envelope:

```text
supported browser/version:
minimum buyer hardware:
screen source resolution:
camera resolution:
maximum tested duration:
largest composite bytes:
largest aggregate R2 bytes per recording:
native export result/time:
1080p export result/time:
minimum tested upload bandwidth:
public playback browsers:
```

Retest after changing bitrate, codec order, duration/byte limits, editor geometry, R2 CORS, or export code.

## Routine checks

### Each deployment

- Confirm the Next.js frontend points to the intended production Convex deployment.
- Run `npm run doctor` without copying its output into a public issue.
- Confirm final `APP_URL`/`NEXT_PUBLIC_APP_URL`, Clerk origin/redirects, and R2 CORS match exactly.
- Record, save, open the editor, share, unlock, comment, react, export, and delete a short fixture.
- Choose **Publish latest**, confirm the public page requests only the current finished rendition, make a rendering-affecting edit, and confirm **Update published video** produces the new revision.
- Verify a realistic screen-and-camera recording within the accepted envelope.
- Confirm optional integrations fail closed: missing OpenAI/OpenRouter or Resend configuration must not break recording, playback, sharing, or comments.

### Regular provider review

- Next.js host: error rate, build failures, and domain/certificate health.
- Clerk: failed sign-ins and configuration changes.
- Convex: function errors, action duration, data/function usage, scheduled-function history, and unexpected growth.
- R2: stored bytes, object count, class A/B operations, credential changes, and abandoned-object growth.
- Transcription provider: request failures, rate limits, and spend.
- Resend: delivery failures, bounces, complaints, and verified-domain state.

Convex exposes scheduled and cron execution history in its [Schedules dashboard](https://docs.convex.dev/dashboard/deployments/schedules). Cloudflare publishes current [R2 pricing](https://developers.cloudflare.com/r2/pricing/); review the live page instead of relying on a price copied into a customer quote.

## Backlog and growth checks

The bundled hourly cleanup processes at most:

- 200 expired share sessions.
- 100 pending uploads older than 24 hours.
- 100 rendition attempts still marked `rendering` after 24 hours.
- 500 stale public rate-limit rows.

Those are per-run drain rates, not table limits. If new stale rows arrive faster than cleanup removes them, backlog grows. Inspect the corresponding Convex tables during regular operations and investigate sustained growth before simply raising batch sizes; function duration and R2 delete calls also need testing.

Other current growth paths are unbounded by retention:

- One `videoViews` row per video/viewer key.
- Viewer watch-progress updates throughout playback.
- Comments and reactions retained until video deletion.
- Mic audio retained until video deletion, even after successful transcription.
- Complete personal-library/activity queries without pagination in the current v1.

Define a buyer retention policy before high-volume use. The current application does not automatically age out views, comments, reactions, transcripts, or published videos.

## Upload operations

Current uploads are direct, sequential, signed single-object `PUT` requests. They are not resumable.

When an upload fails:

1. Keep the page open long enough to capture the user-visible error and browser network status.
2. Confirm the configured app origin exactly matches the R2 CORS rule.
3. Confirm the production Convex deployment has the intended bucket, endpoint, and credentials without printing their values.
4. Check whether the primary object exceeded the client guardrail or a screen/webcam object exceeded the server guardrail.
5. Retry with a small fixture to separate configuration from size/network problems.
6. Confirm successful earlier objects remain in `pendingUploads` and are removed after the 24-hour cutoff.

An upload interrupted midway starts that object again. Do not tell users it resumes. A future multipart implementation should follow Cloudflare's [upload and multipart constraints](https://developers.cloudflare.com/r2/objects/upload-objects/) and add explicit session/part cleanup.

## Playback and signed URL operations

R2 presigned URLs authorize a specific operation on a specific object until expiry. Treat them as secrets in logs, screenshots, support tickets, and error reporting.

When playback fails:

1. Test the composite URL path and independent layer status separately.
2. Look for R2 `403`, CORS, expired signature, or missing-object responses in the browser network panel.
3. Confirm the app can recover or refresh expiring URLs according to the current implementation.
4. Rerun `npm run r2:cors` after any domain change.
5. Verify `GET`, `PUT`, and `HEAD` are allowed for the exact origin and that response headers are readable.
6. Test an older composite-only recording and a new independent-layer recording.

When a current finished rendition exists, the public query should return only that flattened URL and omit raw composite, screen, and webcam URLs. Legacy, unpublished, stale, failed, or removed renditions can use live browser composition and receive the source URLs required by that fallback. Hiding a source-download button does not revoke fallback playback URLs. See Cloudflare's [presigned URL security considerations](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Browser export and publication operations

When an edited export or **Publish latest** render fails, stalls, or is low quality:

1. Reproduce in current desktop Chrome or Edge.
2. Keep the tab active and disable device sleep.
3. Try 1080p, then 720p, before retrying native.
4. Confirm all source URLs are readable through R2 CORS.
5. Confirm both screen and webcam layers load; the exporter intentionally refuses to silently discard independent webcam edits.
6. Check available RAM, GPU/encoder load, and free disk space for browser downloads.
7. Verify the output contains audio. If edited audio is absent, use the original composite for the reliable mixed-audio source and record the browser/device failure.

The renderer accumulates its complete output in memory and then repairs WebM duration. Closing/reloading the tab, browser throttling, OOM, or encoder failure loses that render; it is not a background job. Connected publication uploads the result to R2, while test mode stores it in IndexedDB.

Publication is revision-bound. If the project changes while a render is running, finalization rejects the stale result. A rendering-affecting save clears the previous finished rendition and removes its connected R2 object. Confirm the editor shows an actionable error/status and lets the owner choose **Update published video** for the current revision. Turning sharing on does not publish automatically.

The hourly cleanup reconciles a rendition left in `rendering` for more than 24 hours. If a previously published, current flattened file still exists, cleanup restores `ready` and keeps serving it. Otherwise the attempt becomes `error` with a timeout message. An uploaded-but-unfinalized WebM remains governed by the separate pending-upload cleanup.

## Transcription operations

Current states are `none`, `pending`, `done`, `error`, and `too_large`.

- `none`: provider disabled/misconfigured or no mic object. Recording remains usable.
- `pending`: one scheduled Convex Node action has been requested.
- `done`: transcript stored in Convex.
- `too_large`: mic object is at or above 25 MB.
- `error`: fetch, provider, parsing, or save failed.

The bundled implementation makes one provider attempt and has no automatic retry or manual requeue control. When diagnosing:

1. Run `npm run doctor` and confirm the provider/key/model pair without exposing the key.
2. Check the Convex action log for a safe error category.
3. Confirm the mic asset exists, is audio, and is below 25 MB.
4. Review provider status, quota, rate limit, billing, and current API behavior.
5. Do not repeatedly upload the whole recording as a substitute for a missing retry feature.

OpenAI `whisper-1` stores timestamped segments. The current OpenRouter adapter stores one searchable whole-video segment. The optional chunked/retry pipeline in [Rendering profiles](RENDERING.md) is not implemented.

## Deletion and retention

Deleting a connected video attempts to remove its composite, screen, webcam, mic, thumbnail, finished rendition, and every editor-graphic object, then related asset, transcript, comment, reaction, view, and share-session rows, then the video row. Already missing R2 objects are tolerated.

Important boundaries:

- Deletion does not recall a file someone already downloaded.
- An R2 URL issued before deletion can be shared, although deleting its object should make subsequent reads fail.
- There is no trash or undo.
- There is no legal-hold, configurable retention, or bulk retention policy in v1.
- Test-mode deletion affects only the current browser profile.

Do not add a bucket lifecycle that expires live video objects independently of Convex metadata. Use distinct prefixes and an application-aware retention job if retention is later implemented.

## Backup and restore

Convex and R2 must be backed up as one logical application even though their tools are separate.

At minimum retain:

- Convex data export containing video records, object keys, edits, transcripts, engagement, and share state.
- R2 copy/inventory containing every referenced object key and metadata.
- A versioned copy of the exact source-code release and schema used by the backup.
- A secret inventory that identifies required variables without storing secret values in the backup runbook.

A safe restore rehearsal:

1. Create isolated Clerk, Convex, R2, and frontend resources.
2. Restore R2 objects while preserving referenced keys, or produce a reviewed key-remapping migration.
3. Restore/migrate Convex metadata and schema.
4. Configure secrets and exact origins without copying development credentials.
5. Keep the restored frontend private while checking owner isolation and media references.
6. Test owner playback, public/password playback, transcript, export, and deletion.
7. Record recovery time, missing objects, dangling metadata, and any manual steps.

The repository does not automate a consistent point-in-time snapshot or restore. Do not promise an RPO/RTO until the buyer has run this rehearsal. Follow current Convex backup/export and Cloudflare R2 backup guidance for the buyer's plans and region.

## Security incidents

### R2 credentials exposed

1. Revoke/rotate the bucket-scoped Cloudflare token and S3 credentials in Cloudflare.
2. Update only the intended Convex deployment's server variables.
3. Reapply/verify CORS and run `npm run doctor` without printing values.
4. Review R2 audit/activity information and object inventory for unexpected reads, writes, or deletes.
5. Test signed upload, owner playback, public playback, export, and delete.
6. Rotate any worker credential too if a future worker shared the same secret—prefer separate credentials so this is unnecessary.

Previously issued presigned URLs should be treated as exposed bearer credentials until they expire or the referenced object/key is removed. Consult Cloudflare's current behavior during the incident rather than assuming credential rotation recalls every URL instantly.

### Share link or media URL exposed

1. Make the video private and rotate the share link to block new application requests.
2. Add/change the video password if continued sharing is required.
3. Understand that an already issued R2 URL can remain usable until expiry.
4. If immediate source revocation is required, deleting/replacing the underlying objects requires an application-aware migration and can break playback. The bundled UI has no one-click media-key rotation.
5. Record what data was accessible: composite, screen, webcam, transcript, or engagement.

### Clerk or Convex secret exposed

1. Revoke the affected credential in its provider dashboard.
2. Update the correct frontend or Convex deployment secret store.
3. Confirm browser-visible variables contain no server secrets.
4. Review provider logs and user/data changes.
5. Test authentication and two-user isolation before reopening access.

### Optional integration key exposed

Revoke the OpenAI/OpenRouter/Resend key, update the production Convex environment, inspect provider usage, and verify the application continues core recording/sharing behavior while the integration is unavailable.

## Privacy checklist

The buyer's privacy notice and retention policy should account for:

- Recorded screen, webcam, microphone, and possible system audio.
- Separate raw visual layers in R2.
- Mic-only transcription source retained in R2.
- Transcript text in Convex and audio sent to the configured provider.
- AI Director instructions, viewer questions, and relevant transcript excerpts sent to the configured provider; viewer questions require explicit acknowledgement and are rate-limited.
- Visual SOP screenshots stored as owner-scoped video graphic assets until the video is deleted.
- Guest commenter name and required email.
- Viewer key, watch progress, user agent, and referrer when available.
- Notification email content sent through Resend.
- Current finished-rendition URL delivered to public playback, or presigned source URLs when legacy/unpublished live composition is used.

No third-party analytics SDK is bundled, but first-party viewer analytics still collect the fields above. Obtain appropriate user consent and publish buyer-specific contact, retention, deletion, and subprocessors information.

## Cost controls

Track at least:

```text
R2 stored bytes = composite + screen + webcam + mic + thumbnail + editor graphics + current finished WebM + future derivatives
R2 operations   = upload/sync/playback/export/delete activity
Convex usage    = queries + mutations + actions + stored engagement/transcripts
AI usage        = transcribed audio and retries
Email usage     = first-view/comment notifications
Frontend usage  = builds, requests, and logs
```

Recommended controls before adding larger buyers:

- Aggregate recording/owner quota enforcement (not bundled).
- Paginated library and activity queries (not bundled in v1).
- Analytics retention/rollups (not bundled).
- Storage and provider budget alerts in provider dashboards.
- Tested lower export presets for constrained devices.
- Explicit limits in buyer terms that match measured capacity.

## Background-worker operations

When workers are deployed, add monitoring for:

- Queue depth and oldest queued age.
- Claim rate, lease expiry, retries, terminal failures, and superseded jobs.
- Render duration versus source duration by preset.
- CPU, memory, temporary disk, process exits, and worker concurrency.
- Output verification/checksum failures.
- Derivative bytes and cleanup backlog.
- Renderer contract version adoption and rollback.

The worker writes durable status, attempts, progress, and terminal error details to `mediaJobs`; infrastructure CPU, memory, disk, and process-exit metrics still belong in the buyer's worker platform.

## Handoff checklist

- [ ] Production resources are isolated from development.
- [ ] `npm run doctor` passes without secrets in logs.
- [ ] Final domain, Clerk, Convex, and R2 CORS align.
- [ ] Two-user isolation test passes.
- [ ] Short smoke test passes.
- [ ] Realistic operating-envelope test passes and is recorded.
- [ ] Aggregate R2 footprint and provider costs are understood.
- [ ] Public source-URL behavior is disclosed accurately.
- [ ] Retention/privacy notice is buyer-specific.
- [ ] Convex and R2 backup/restore rehearsal is complete before backup promises.
- [ ] Credential rotation contacts and incident ownership are documented.
- [ ] Optional worker/HLS features are not represented as bundled.
