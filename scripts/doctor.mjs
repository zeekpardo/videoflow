import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const requiredLocal = ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "NEXT_PUBLIC_APP_URL"];
const requiredConvex = ["CLERK_JWT_ISSUER_DOMAIN", "R2_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET", "APP_URL", "APP_NAME"];

function parseEnv(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && match[2].trim() && !/replace_me|your-/i.test(match[2])) names.add(match[1]);
  }
  return names;
}

function has(output, name) {
  return new RegExp(`(^|\\n)${name}(=|\\s)`, "m").test(output);
}

let failed = false;
let testMode = false;
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const supportedNode = (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor === 22 && nodeMinor >= 13) || nodeMajor >= 24;
console.log(`Node ${process.versions.node} ${supportedNode ? "✓" : "✗ (use 20.19+, 22.13+, or 24+)"}`);
failed ||= !supportedNode;

if (!existsSync(".env.local")) {
  console.log(".env.local ✗ (run npm run setup)");
  failed = true;
} else {
  const localText = readFileSync(".env.local", "utf8");
  const local = parseEnv(localText);
  testMode = /^NEXT_PUBLIC_TEST_MODE=true$/m.test(localText);
  const expected = testMode
    ? ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_NAME", "NEXT_PUBLIC_APP_LOGO_URL", "NEXT_PUBLIC_BRAND_COLOR", "NEXT_PUBLIC_MAX_RECORDING_MINUTES", "NEXT_PUBLIC_MAX_VIDEO_BYTES"]
    : requiredLocal;
  for (const name of expected) {
    const ok = local.has(name);
    console.log(`${name} ${ok ? "✓" : "✗"}`);
    failed ||= !ok;
  }
}

if (testMode) {
  console.log("Runtime local test mode ✓ (provider accounts intentionally not required)");
  console.log("Storage browser IndexedDB ✓ (videos never upload in this mode)");
  if (failed) process.exitCode = 1;
  else console.log("VideoFlow local test mode looks ready.");
  process.exit();
}

const result = spawnSync("npx", ["convex", "env", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (result.status !== 0) {
  console.log("Convex environment ✗ (connect a deployment with `npx convex dev --once`)");
  failed = true;
} else {
  const output = `${result.stdout}\n${result.stderr}`;
  for (const name of requiredConvex) {
    const ok = has(output, name);
    console.log(`Convex ${name} ${ok ? "✓" : "✗"}`);
    failed ||= !ok;
  }

  const providerMatch = output.match(/(?:^|\n)TRANSCRIPTION_PROVIDER(?:=|\s+)([^\s]+)/m);
  const provider = providerMatch?.[1] || (has(output, "OPENAI_API_KEY") ? "openai" : has(output, "OPENROUTER_API_KEY") ? "openrouter" : "none");
  const providerReady = provider === "none" || (provider === "openai" && has(output, "OPENAI_API_KEY")) || (provider === "openrouter" && has(output, "OPENROUTER_API_KEY"));
  console.log(`Transcription ${provider}${providerReady ? " ✓" : " ✗ (provider key missing)"}`);
  failed ||= !providerReady;

  const resendReady = has(output, "RESEND_API_KEY") && has(output, "NOTIFICATION_FROM_EMAIL");
  const resendPartial = has(output, "RESEND_API_KEY") !== has(output, "NOTIFICATION_FROM_EMAIL");
  console.log(`Notifications ${resendReady ? "Resend ✓" : resendPartial ? "✗ (both Resend values are required)" : "disabled (optional)"}`);
  failed ||= resendPartial;

  console.log(`Background worker ${has(output, "MEDIA_WORKER_SECRET") ? "server secret configured ✓" : "not deployed (optional)"}`);
}

if (failed) process.exitCode = 1;
else console.log("VideoFlow configuration looks ready.");
