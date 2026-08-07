# Deploy the browser-only sales demo

The sales demo is a separate Vercel deployment profile of VideoFlow. It uses the existing **DevLaunch production Convex deployment** for verification, abuse limits, verified leads, analytics, and the `/admin` dashboard. VideoFlow does not deploy or maintain a second Convex backend for the demo.

Visitors verify a real inbox with a six-digit Resend code, receive one fixed 72-hour trial, and record/edit entirely in browser IndexedDB. The workspace also offers a guided V2 sample—generated locally without device permissions—that demonstrates AI Director edit-plan previews, AI transcription, editable captions, Smart Focus, templates, interactive video, an askable viewer preview with timestamp citations, a clearly labeled background-publish simulation, and Visual SOPs with locally captured frames. There is no Clerk account, R2 bucket, public share link, persistent server-side media, or media proxy. AI remains off until the visitor separately consents to a specific AI action.

## Data and expiry

DevLaunch Convex stores verification challenges, rate-limit ledgers, verified name/email, consent, fixed trial dates, and sanitized product analytics. It never receives recordings, audio, thumbnails, imported graphics, titles, descriptions, typed overlays, filenames, passwords, IP addresses, or raw editor projects.

The signed access cookie expires exactly at the fixed deadline. An open page clears its IndexedDB media at expiry; a closed browser clears it on the next visit because websites cannot execute while closed. Verified lead records intentionally remain for consent and sales operations. Expired challenge rows are retained through the one-hour abuse window and then removed by the DevLaunch hourly cleanup.

## 1. Configure Resend in DevLaunch Convex

Verify a Resend domain or sending subdomain, create an API key, and set a sender that can receive replies. Official references: [domain verification](https://resend.com/docs/dashboard/domains/introduction) and [sender addresses](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend).

From the `devlaunch` repository:

```bash
npx convex env set --prod RESEND_API_KEY
npx convex env set --prod VIDEOFLOW_DEMO_EMAIL_FROM
npx convex env set --prod VIDEOFLOW_DEMO_APP_NAME
```

Example sender: `VideoFlow <demo@demo-mail.example.com>`.

## 2. Configure the shared DevLaunch connection

Generate two independent values:

```bash
openssl rand -hex 32 # VIDEOFLOW_DEMO_INGEST_TOKEN: DevLaunch Convex + VideoFlow Vercel
openssl rand -hex 32 # VIDEOFLOW_DEMO_ACCESS_PEPPER: DevLaunch Convex only
```

Set them in the DevLaunch production deployment:

```bash
cd /path/to/devlaunch
npx convex env set --prod VIDEOFLOW_DEMO_INGEST_TOKEN
npx convex env set --prod VIDEOFLOW_DEMO_ACCESS_PEPPER
npx convex deploy --yes
```

The ingest token authorizes only server-to-server calls from the VideoFlow Vercel routes. The pepper hashes codes, challenges, rate keys, email identifiers, and stable trial IDs. Keep the pepper durable: rotating it invalidates pending codes and changes active browsers’ local demo namespace.

## 3. Add Turnstile

Create a Cloudflare Turnstile **Managed** widget restricted to the production demo hostname. Add its public site key and private secret to the VideoFlow demo Vercel project. Every access email and resend requires a fresh challenge, and the API validates the token, action, and hostname server-side.

For automated tests only, Cloudflare provides site key `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA`. Never use test credentials in production.

Official references: [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), and [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

## 4. Create the VideoFlow demo Vercel project

Import the VideoFlow repository as a separate Vercel project. Use the ordinary build command:

```bash
npm run build
```

Do not run `convex deploy` from VideoFlow and do not add a Convex deploy key. Add these Vercel production variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_DEMO_MODE` | `true` |
| `NEXT_PUBLIC_APP_NAME` | `VideoFlow` |
| `NEXT_PUBLIC_APP_URL` | Final demo origin |
| `NEXT_PUBLIC_DEMO_PURCHASE_URL` | Existing sales page or checkout |
| `NEXT_PUBLIC_DEMO_PRIVACY_URL` | Published demo/privacy notice |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Hostname-restricted public widget key |
| `TURNSTILE_SECRET_KEY` | Private Turnstile secret |
| `DEVLAUNCH_CONVEX_URL` | Existing DevLaunch production `https://…convex.cloud` URL |
| `VIDEOFLOW_DEMO_INGEST_TOKEN` | Same value set in DevLaunch Convex |
| `DEMO_SESSION_SECRET` | Independent random value, 32+ characters |
| `DEMO_RATE_LIMIT_SECRET` | Independent random value, 32+ characters |
| `NEXT_PUBLIC_DEMO_MAX_RECORDING_MINUTES` | Optional; defaults to `15` |
| `NEXT_PUBLIC_DEMO_MAX_VIDEO_BYTES` | Optional; defaults to `500 MB` |
| `NEXT_PUBLIC_DEMO_MAX_VIDEOS` | Optional; defaults to `10` |
| `DEMO_OPENROUTER_API_KEY` | Separate, rotated demo-only key with a low credit cap |
| `DEMO_OPENROUTER_GENERATION_MODEL` | Optional; locked to `openai/gpt-5.4-nano` |
| `DEMO_OPENROUTER_TRANSCRIPTION_MODEL` | Optional; locked to `openai/whisper-large-v3` |

Do not add Clerk, R2, a general-purpose OpenAI/OpenRouter key, a VideoFlow Convex URL, or `CONVEX_DEPLOY_KEY` to this Vercel project. The optional AI demo uses only the dedicated `DEMO_OPENROUTER_API_KEY`. Redeploy after environment changes.

Create the demo key only after revoking any key that has appeared in chat, logs, or source control. Give it a small credit limit. In OpenRouter, attach a guardrail that allows only `openai/gpt-5.4-nano` and `openai/whisper-large-v3`, requires zero-data-retention, denies provider data collection, and blocks model fallbacks. The application repeats those restrictions on every request.

The DevLaunch Convex quota ledger atomically permits three transcript attempts and three generation attempts for each verified trial/email. Director plans, Visual SOP writing, and viewer questions all share those three generation attempts. It also applies per-network and global daily ceilings. A reservation counts even if the provider later fails, preventing retry storms from multiplying spend. The ledger stores request metadata and pseudonymous identifiers only—never audio, transcripts, prompts, or generated output.

## 5. Connect and verify

Point the existing sales page’s **Try the demo** button at the demo origin and the demo purchase URL back at the sales page or checkout.

Run:

```bash
vercel link
vercel env run -e production -- npm run demo:doctor
```

Acceptance checklist:

1. Complete Turnstile and receive a real six-digit email.
2. Confirm five wrong guesses lock a code, resend cooldowns work, and a used code cannot be reused.
3. Confirm `videoFlowDemoLeads`, `videoFlowDemoAccessChallenges`, `videoFlowDemoSessions`, and `videoFlowDemoEvents` exist only in DevLaunch Convex.
4. Confirm `/admin` → **Demo Analytics** shows the verified lead and activity.
5. Open the guided V2 sample without granting device permissions; complete its walkthrough and confirm its publishing step is labeled as a local simulation.
6. Record screen + camera, edit, and export without AI; confirm no media request leaves the browser.
7. Open an AI action, confirm it is blocked by the just-in-time consent dialog, accept, then verify only the first 60 seconds as a WAV excerpt or the caption text is sent to the server.
8. Confirm the fourth transcript and fourth generation request are rejected server-side, including after clearing browser storage.
9. Confirm public sharing is absent and the purchase bar returns to the real sales page.
10. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e:demo` in VideoFlow; run codegen, typecheck, scoped lint, and build in DevLaunch.

## Security and limits

- Fresh server-verified Turnstile token for every email and resend.
- Five requests per email/hour, 20 per IP/hour, and 200 globally/hour.
- Ten-minute codes, 60-second resend cooldown, and five guesses per code.
- HMAC-derived identifiers and signed HTTP-only, same-site 72-hour cookies.
- Re-verifying never extends the original trial.
- DevLaunch analytics ingestion uses the same server-only token, deduplicates event IDs, clamps properties, and caps each session at 2,000 events.
- Detailed leads and analytics require the existing authenticated DevLaunch analytics owner.
- AI requires separate, versioned consent; three transcript attempts and three generation attempts per verified trial; a 60-second 16 kHz mono WAV ceiling; strict input/output clamps; one in-flight paid call per reserved request; and no automatic paid retries.
- OpenRouter requests use a fixed model allowlist, disable fallbacks, and request ZDR plus denied provider data collection. The provider key must independently enforce a small credit cap and equivalent guardrails.
