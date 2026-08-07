import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const devlaunch = resolve(root, "../devlaunch");
const localPath = resolve(root, ".env.local");

function parse(path) {
  const values = new Map();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

function convexGet(name) {
  const result = spawnSync("npx", ["convex", "env", "get", name, "--prod"], { cwd: devlaunch, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function convexSet(name, value) {
  const result = spawnSync("npx", ["convex", "env", "set", name, value, "--prod"], { cwd: devlaunch, encoding: "utf8", stdio: "ignore" });
  if (result.status !== 0) throw new Error(`Could not set DevLaunch Convex ${name}`);
  console.log(`✓ DevLaunch Convex ${name}`);
}

function secret() { return randomBytes(32).toString("hex"); }

if (!existsSync(devlaunch)) throw new Error("Expected the DevLaunch repository beside VideoFlow");
const devLocal = parse(resolve(devlaunch, ".env.local"));
const devVercel = parse(resolve(devlaunch, ".env.vercel"));
const convexUrl = devVercel.get("NEXT_PUBLIC_CONVEX_URL") || devLocal.get("NEXT_PUBLIC_CONVEX_URL");
if (!convexUrl || !/^https:\/\/.+\.convex\.cloud\/?$/i.test(convexUrl)) throw new Error("Could not locate the DevLaunch production Convex URL");

const ingestToken = convexGet("VIDEOFLOW_DEMO_INGEST_TOKEN") || secret();
const accessPepper = convexGet("VIDEOFLOW_DEMO_ACCESS_PEPPER") || secret();
const resendKey = convexGet("RESEND_API_KEY") || devLocal.get("RESEND_API_KEY");
if (!resendKey) throw new Error("DevLaunch does not have a Resend API key to reuse");

convexSet("VIDEOFLOW_DEMO_INGEST_TOKEN", ingestToken);
convexSet("VIDEOFLOW_DEMO_ACCESS_PEPPER", accessPepper);
convexSet("RESEND_API_KEY", resendKey);
convexSet("VIDEOFLOW_DEMO_EMAIL_FROM", "VideoFlow <hello@lead.hyperflow.cloud>");
convexSet("VIDEOFLOW_DEMO_APP_NAME", "VideoFlow");

const local = parse(localPath);
const updates = new Map([
  ["NEXT_PUBLIC_DEMO_MODE", local.get("NEXT_PUBLIC_DEMO_MODE") || "false"],
  ["NEXT_PUBLIC_DEMO_PURCHASE_URL", "https://devlaunchlearn.com/videoflow"],
  ["NEXT_PUBLIC_DEMO_PRIVACY_URL", "https://devlaunchlearn.com/privacy"],
  ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA"],
  ["TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA"],
  ["DEVLAUNCH_CONVEX_URL", convexUrl],
  ["VIDEOFLOW_DEMO_INGEST_TOKEN", ingestToken],
  ["DEMO_SESSION_SECRET", local.get("DEMO_SESSION_SECRET") || secret()],
  ["DEMO_RATE_LIMIT_SECRET", local.get("DEMO_RATE_LIMIT_SECRET") || secret()],
  ["NEXT_PUBLIC_DEMO_MAX_RECORDING_MINUTES", local.get("NEXT_PUBLIC_DEMO_MAX_RECORDING_MINUTES") || "15"],
  ["NEXT_PUBLIC_DEMO_MAX_VIDEO_BYTES", local.get("NEXT_PUBLIC_DEMO_MAX_VIDEO_BYTES") || "524288000"],
  ["NEXT_PUBLIC_DEMO_MAX_VIDEOS", local.get("NEXT_PUBLIC_DEMO_MAX_VIDEOS") || "10"],
]);

const existing = existsSync(localPath) ? readFileSync(localPath, "utf8").replace(/\s+$/, "") : "";
const managedNames = new Set(updates.keys());
const retained = existing.split(/\r?\n/).filter((line) => {
  const match = line.match(/^([A-Z0-9_]+)=/);
  return !match || !managedNames.has(match[1]);
});
const block = ["", "# Sales demo connection (managed by npm run demo:configure)", ...[...updates].map(([name, value]) => `${name}=${value}`)];
writeFileSync(localPath, [...retained, ...block, ""].join("\n"), { mode: 0o600 });
chmodSync(localPath, 0o600);
console.log("✓ VideoFlow .env.local demo connection");
console.log("✓ Existing local test/demo mode selection preserved");
console.log("No secret values were printed.");
