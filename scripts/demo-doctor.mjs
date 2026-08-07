import { existsSync, readFileSync } from "node:fs";

function parseEnv(path) {
  const values = new Map();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

const fileEnv = parseEnv(".env.local");
const value = (name) => process.env[name] || fileEnv.get(name) || "";
const checks = [];
function check(label, ok, detail) { checks.push(ok); console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); }
function validUrl(candidate) { try { const url = new URL(candidate); return url.protocol === "https:" || url.hostname === "localhost"; } catch { return false; } }

console.log("VideoFlow sales demo doctor\n");
check("Demo-only routing", value("NEXT_PUBLIC_DEMO_MODE") === "true", "NEXT_PUBLIC_DEMO_MODE must be true");
check("Demo application URL", validUrl(value("NEXT_PUBLIC_APP_URL")), "final demo origin");
check("Purchase destination", validUrl(value("NEXT_PUBLIC_DEMO_PURCHASE_URL")), "existing sales page or checkout");
check("Privacy notice", validUrl(value("NEXT_PUBLIC_DEMO_PRIVACY_URL")), "required for lead collection");
check("Turnstile site key", value("NEXT_PUBLIC_TURNSTILE_SITE_KEY").length >= 20, "browser-visible widget key");
check("Turnstile secret", value("TURNSTILE_SECRET_KEY").length >= 20, "server-only key");
check("DevLaunch Convex URL", /^https:\/\/.+\.convex\.cloud\/?$/i.test(value("DEVLAUNCH_CONVEX_URL")), "primary DevLaunch deployment");
check("Shared ingest token", value("VIDEOFLOW_DEMO_INGEST_TOKEN").length >= 32, "same value must exist in DevLaunch Convex");
check("Session signing secret", value("DEMO_SESSION_SECRET").length >= 32, "32+ characters");
check("Rate-limit secret", value("DEMO_RATE_LIMIT_SECRET").length >= 32, "32+ characters");
check("Demo-only OpenRouter key", value("DEMO_OPENROUTER_API_KEY").length >= 20, "rotated, server-only, credit-capped key");
check("Low-cost generation model", (value("DEMO_OPENROUTER_GENERATION_MODEL") || "openai/gpt-5.4-nano") === "openai/gpt-5.4-nano", "hard allowlist");
check("Low-cost transcription model", (value("DEMO_OPENROUTER_TRANSCRIPTION_MODEL") || "openai/whisper-large-v3") === "openai/whisper-large-v3", "hard allowlist");
check("No demo Convex deploy key", !value("CONVEX_DEPLOY_KEY"), "the demo does not deploy its own Convex backend");

console.log("\nDevLaunch must contain VIDEOFLOW_DEMO_INGEST_TOKEN, VIDEOFLOW_DEMO_ACCESS_PEPPER, RESEND_API_KEY, and VIDEOFLOW_DEMO_EMAIL_FROM.");
console.log("OpenRouter must cap the demo key, allow only openai/gpt-5.4-nano and openai/whisper-large-v3, require ZDR, and deny provider data collection.");
console.log("Media-storage check: the demo requires no Clerk, R2, application Convex deployment, or server media tables.");
if (checks.every(Boolean)) console.log("Sales demo configuration is ready.");
else { console.error("Sales demo configuration needs attention. No secret values were printed."); process.exitCode = 1; }
