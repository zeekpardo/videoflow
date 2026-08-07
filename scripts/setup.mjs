import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { parseEnvText, patchEnvText } from "./lib/env-file.mjs";

const ENV_PATH = ".env.local";
const purple = "\x1b[38;2;109;91;252m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";
const interactive = stdin.isTTY && stdout.isTTY;

function parseEnv(path = ENV_PATH) {
  return existsSync(path) ? parseEnvText(readFileSync(path, "utf8")) : new Map();
}

let current = parseEnv();

function section(number, title, detail) {
  stdout.write(`\n${purple}${bold}${number}. ${title}${reset}\n${dim}${detail}${reset}\n\n`);
}

function regularQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function hiddenQuestion(prompt) {
  if (!interactive || typeof stdin.setRawMode !== "function") return regularQuestion(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(prompt);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    const finish = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      resolve(value);
    };
    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        stdin.off("keypress", onKeypress);
        stdin.setRawMode(false);
        stdout.write("\n");
        reject(new Error("Setup cancelled"));
        return;
      }
      if (key?.name === "return" || key?.name === "enter") return finish();
      if (key?.name === "backspace") {
        if (value) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (character && !key?.ctrl && !key?.meta) {
        value += character;
        stdout.write("•");
      }
    };
    stdin.on("keypress", onKeypress);
  });
}

async function ask(label, key, fallback = "", options = {}) {
  const existing = current.get(key) || fallback;
  const hint = existing ? (options.secret ? "configured — Enter keeps it" : existing) : options.required ? "required" : "optional";
  while (true) {
    const response = await (options.secret ? hiddenQuestion : regularQuestion)(`${label} ${dim}[${hint}]${reset}: `);
    const value = response.trim() || existing;
    if (options.required && !value) {
      stdout.write(`${yellow}This value is required.${reset}\n`);
      continue;
    }
    if (value.includes("\n")) {
      stdout.write(`${yellow}Use a single-line value.${reset}\n`);
      continue;
    }
    if (options.validate && value && !options.validate(value)) {
      stdout.write(`${yellow}${options.validationMessage || "That value does not look valid."}${reset}\n`);
      continue;
    }
    return value;
  }
}

async function confirm(label, defaultValue = true) {
  const marker = defaultValue ? "Y/n" : "y/N";
  const answer = (await regularQuestion(`${label} ${dim}[${marker}]${reset}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

function configuredFeature(key, fallback = true) {
  const value = current.get(key);
  return value === undefined || value === "" ? fallback : value.toLowerCase() !== "false";
}

async function choose(label, choices, initial = 0) {
  stdout.write(`${label}\n`);
  choices.forEach((choice, index) => stdout.write(`  ${index + 1}. ${choice.label}${choice.detail ? ` ${dim}— ${choice.detail}${reset}` : ""}\n`));
  while (true) {
    const answer = (await regularQuestion(`Choose ${dim}[${initial + 1}]${reset}: `)).trim();
    const index = answer ? Number(answer) - 1 : initial;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value;
    stdout.write(`${yellow}Enter a number from 1 to ${choices.length}.${reset}\n`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return result;
}

function convexLinked() {
  return run("npx", ["convex", "env", "list"]).status === 0;
}

function getConvexEnv(name) {
  const result = run("npx", ["convex", "env", "get", name]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function setConvexEnv(name, value) {
  if (!value) return true;
  const result = run("npx", ["convex", "env", "set", name, value]);
  if (result.status === 0) {
    stdout.write(`  ${green}✓${reset} ${name}\n`);
    return true;
  }
  stdout.write(`  ${yellow}!${reset} ${name} could not be set${result.stderr ? `: ${result.stderr.trim()}` : ""}\n`);
  return false;
}

function writeLocalEnv(values) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const body = patchEnvText(existing, values);
  writeFileSync(ENV_PATH, body, { mode: 0o600 });
  current = parseEnv();
}

function localUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function fullSetup() {
  stdout.write(`\n${purple}${bold}◆ VideoFlow guided setup${reset}\n`);
  stdout.write("Configure the app, connect its providers, and verify the installation. Secret input is hidden.\n");
  stdout.write(`${dim}Nothing is copied from another project and secrets are never printed in the summary.${reset}\n`);

  section(1, "Brand and browser settings", "These are the only values written to the ignored .env.local file.");
  const appName = await ask("Product name", "NEXT_PUBLIC_APP_NAME", "VideoFlow", { required: true });
  const appUrl = (await ask("App URL", "NEXT_PUBLIC_APP_URL", "http://localhost:3000", {
    required: true,
    validate: localUrl,
    validationMessage: "Enter a complete http:// or https:// URL.",
  })).replace(/\/$/, "");
  const logoUrl = await ask("Logo path or URL", "NEXT_PUBLIC_APP_LOGO_URL", "/logo.svg", { required: true });
  const brandColor = await ask("Accent color", "NEXT_PUBLIC_BRAND_COLOR", "#6d5bfc", {
    required: true,
    validate: (value) => /^#[0-9a-f]{6}$/i.test(value),
    validationMessage: "Use a six-digit hex color such as #6d5bfc.",
  });
  const maxMinutes = await ask("Recording limit in minutes", "NEXT_PUBLIC_MAX_RECORDING_MINUTES", "15", {
    required: true,
    validate: (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 240,
    validationMessage: "Use a whole number between 1 and 240.",
  });
  const maxBytes = await ask("Upload limit in bytes", "NEXT_PUBLIC_MAX_VIDEO_BYTES", "524288000", {
    required: true,
    validate: (value) => Number.isInteger(Number(value)) && Number(value) >= 10 * 1024 * 1024,
    validationMessage: "Use a byte count of at least 10485760.",
  });
  const mobileCameraSwitch = await confirm(
    "Enable front/back camera selection on supported phones?",
    configuredFeature("NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH"),
  );
  const libraryDelete = await confirm(
    "Enable deletion from library quick preview and multi-select?",
    configuredFeature("NEXT_PUBLIC_FEATURE_LIBRARY_DELETE"),
  );
  const reviewRequests = await confirm(
    "Enable no-login video review requests?",
    configuredFeature("NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS"),
  );
  const automaticTasks = await confirm(
    "Enable automatic task proposals from videos?",
    configuredFeature("NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS"),
  );
  const socialPublishing = await confirm(
    "Enable social publishing controls?",
    configuredFeature("NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING"),
  );
  const zernioSocial = socialPublishing && await confirm(
    "Offer Zernio as an optional unified social provider?",
    configuredFeature("NEXT_PUBLIC_FEATURE_ZERNIO", false),
  );

  section(2, "Convex", "Create a free project at https://dashboard.convex.dev, then let the official CLI link this folder.");
  let linked = convexLinked();
  if (!linked && await confirm("Connect or create the Convex project now?", true)) {
    stdout.write(`${dim}The Convex CLI may open a browser and ask you to choose a project.${reset}\n`);
    const result = run("npx", ["convex", "dev", "--once"], { interactive: true });
    linked = result.status === 0 && convexLinked();
    current = parseEnv();
  }
  const convexUrl = await ask("Convex deployment URL", "NEXT_PUBLIC_CONVEX_URL", current.get("NEXT_PUBLIC_CONVEX_URL") || "", {
    required: true,
    validate: (value) => /^https:\/\/.+\.convex\.cloud\/?$/i.test(value),
    validationMessage: "Copy the https://…convex.cloud deployment URL from Convex.",
  });

  section(3, "Clerk authentication", "Create an app at https://dashboard.clerk.com, then add the Convex integration in Clerk's Integrations screen.");
  const clerkPublishable = await ask("Clerk publishable key", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "", {
    required: true,
    validate: (value) => /^pk_(test|live)_/.test(value),
    validationMessage: "Clerk publishable keys begin with pk_test_ or pk_live_.",
  });
  const clerkSecret = await ask("Clerk secret key", "CLERK_SECRET_KEY", "", {
    required: true,
    secret: true,
    validate: (value) => /^sk_(test|live)_/.test(value),
    validationMessage: "Clerk secret keys begin with sk_test_ or sk_live_.",
  });

  writeLocalEnv({
    NEXT_PUBLIC_TEST_MODE: "false",
    NEXT_PUBLIC_DEMO_MODE: "false",
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishable,
    CLERK_SECRET_KEY: clerkSecret,
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_APP_NAME: appName,
    NEXT_PUBLIC_APP_LOGO_URL: logoUrl,
    NEXT_PUBLIC_BRAND_COLOR: brandColor,
    NEXT_PUBLIC_MAX_RECORDING_MINUTES: maxMinutes,
    NEXT_PUBLIC_MAX_VIDEO_BYTES: maxBytes,
    NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH: String(mobileCameraSwitch),
    NEXT_PUBLIC_FEATURE_LIBRARY_DELETE: String(libraryDelete),
    NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS: String(reviewRequests),
    NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS: String(automaticTasks),
    NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING: String(socialPublishing),
    NEXT_PUBLIC_FEATURE_ZERNIO: String(zernioSocial),
  });
  stdout.write(`  ${green}✓${reset} .env.local written with owner-only permissions\n`);

  if (!linked) {
    stdout.write(`\n${yellow}${bold}Convex is not linked yet.${reset}\n`);
    stdout.write("Run `npx convex dev --once`, then run `npm run setup` again so the wizard can securely configure server providers.\n");
    return;
  }

  for (const name of [
    "CLERK_JWT_ISSUER_DOMAIN", "R2_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET",
    "TRANSCRIPTION_PROVIDER", "OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_TRANSCRIPTION_MODEL",
    "RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL",
  ]) {
    const existing = getConvexEnv(name);
    if (existing) current.set(name, existing);
  }

  const issuer = await ask("Clerk JWT issuer domain", "CLERK_JWT_ISSUER_DOMAIN", "", {
    required: true,
    validate: localUrl,
    validationMessage: "Enter the https:// issuer shown in Clerk's Convex integration.",
  });

  section(4, "Cloudflare R2 storage", "Create an R2 bucket and bucket-scoped API token at https://dash.cloudflare.com/?to=/:account/r2.");
  const r2Bucket = await ask("R2 bucket name", "R2_BUCKET", "videoflow", { required: true });
  const r2Endpoint = await ask("R2 S3 endpoint", "R2_ENDPOINT", "", {
    required: true,
    validate: (value) => /^https:\/\/.+\.r2\.cloudflarestorage\.com\/?$/i.test(value),
    validationMessage: "Use https://ACCOUNT_ID.r2.cloudflarestorage.com.",
  });
  const r2AccessKey = await ask("R2 access key ID", "R2_ACCESS_KEY_ID", "", { required: true, secret: true });
  const r2SecretKey = await ask("R2 secret access key", "R2_SECRET_ACCESS_KEY", "", { required: true, secret: true });
  const r2Token = await ask("Cloudflare API token", "R2_TOKEN", "", { required: true, secret: true });

  section(5, "Transcription", "Optional. OpenAI provides timestamped segments; OpenRouter provides a searchable full transcript.");
  const providerDefault = current.get("TRANSCRIPTION_PROVIDER") === "openrouter" ? 1 : current.get("TRANSCRIPTION_PROVIDER") === "none" ? 2 : 0;
  const transcriptProvider = await choose("Choose a transcription provider:", [
    { value: "openai", label: "OpenAI", detail: "timestamped whisper-1 segments" },
    { value: "openrouter", label: "OpenRouter", detail: "one unified STT key and model catalog" },
    { value: "none", label: "None", detail: "recording and sharing still work" },
  ], providerDefault);
  let transcriptKey = "";
  let transcriptModel = "";
  if (transcriptProvider === "openai") {
    stdout.write(`${dim}Create a key at https://platform.openai.com/api-keys.${reset}\n`);
    transcriptKey = await ask("OpenAI API key", "OPENAI_API_KEY", "", { required: true, secret: true });
    transcriptModel = await ask("OpenAI transcription model", "OPENAI_TRANSCRIPTION_MODEL", "whisper-1", { required: true });
  } else if (transcriptProvider === "openrouter") {
    stdout.write(`${dim}Create a key and add credits at https://openrouter.ai/settings/keys.${reset}\n`);
    transcriptKey = await ask("OpenRouter API key", "OPENROUTER_API_KEY", "", { required: true, secret: true });
    transcriptModel = await ask("OpenRouter transcription model", "OPENROUTER_TRANSCRIPTION_MODEL", "openai/whisper-large-v3", { required: true });
  }

  section(6, "Email notifications", "Optional. Create a Resend account and verify a domain at https://resend.com/domains.");
  const useResend = await confirm("Configure Resend notifications?", !!current.get("RESEND_API_KEY"));
  const resendKey = useResend ? await ask("Resend API key", "RESEND_API_KEY", "", { required: true, secret: true }) : "";
  const notificationFrom = useResend ? await ask("Notification sender email", "NOTIFICATION_FROM_EMAIL", "", {
    required: true,
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    validationMessage: "Enter an email on your verified Resend domain.",
  }) : "";

  section(7, "Apply and verify", "Server-only values are sent directly to the linked Convex deployment.");
  const serverValues = {
    CLERK_JWT_ISSUER_DOMAIN: issuer.replace(/\/$/, ""),
    R2_TOKEN: r2Token,
    R2_ACCESS_KEY_ID: r2AccessKey,
    R2_SECRET_ACCESS_KEY: r2SecretKey,
    R2_ENDPOINT: r2Endpoint.replace(/\/$/, ""),
    R2_BUCKET: r2Bucket,
    APP_URL: appUrl,
    APP_NAME: appName,
    BRAND_COLOR: brandColor,
    MAX_VIDEO_BYTES: maxBytes,
    TRANSCRIPTION_PROVIDER: transcriptProvider,
    ...(transcriptProvider === "openai" ? { OPENAI_API_KEY: transcriptKey, OPENAI_TRANSCRIPTION_MODEL: transcriptModel } : {}),
    ...(transcriptProvider === "openrouter" ? { OPENROUTER_API_KEY: transcriptKey, OPENROUTER_TRANSCRIPTION_MODEL: transcriptModel } : {}),
    ...(useResend ? { RESEND_API_KEY: resendKey, NOTIFICATION_FROM_EMAIL: notificationFrom } : {}),
  };
  let applied = true;
  for (const [name, value] of Object.entries(serverValues)) applied = setConvexEnv(name, value) && applied;

  stdout.write(`\n${dim}Deploying Convex functions and schema…${reset}\n`);
  const deployResult = run("npx", ["convex", "dev", "--once"], { interactive: true });
  const configureCors = applied && deployResult.status === 0 && await confirm("Configure R2 CORS for localhost and the app URL now?", true);
  if (configureCors) {
    const cors = run("npm", ["run", "r2:cors"], { interactive: true });
    if (cors.status !== 0) stdout.write(`${yellow}R2 CORS could not be verified. Rerun npm run r2:cors after checking the keys.${reset}\n`);
  }

  stdout.write(`\n${purple}${bold}Setup complete${reset}\n`);
  stdout.write(`  App: ${appName} at ${appUrl}\n`);
  stdout.write(`  Storage: Cloudflare R2 bucket ${r2Bucket}\n`);
  stdout.write(`  Transcription: ${transcriptProvider === "none" ? "disabled" : transcriptProvider}\n`);
  stdout.write(`  Notifications: ${useResend ? "Resend enabled" : "disabled"}\n\n`);
  stdout.write(`  Mobile camera switch: ${mobileCameraSwitch ? "enabled" : "disabled"}\n`);
  stdout.write(`  Library deletion shortcuts: ${libraryDelete ? "enabled" : "disabled"}\n\n`);
  stdout.write(`  No-login review requests: ${reviewRequests ? "enabled" : "disabled"}\n\n`);
  stdout.write(`  Automatic task proposals: ${automaticTasks ? "enabled" : "disabled"}\n`);
  stdout.write(`  Social publishing controls: ${socialPublishing ? "enabled" : "disabled"}\n\n`);
  stdout.write(`  Optional Zernio provider: ${zernioSocial ? "enabled" : "disabled"}\n\n`);
  stdout.write(`${bold}Next:${reset}\n  npm run doctor\n  npm run dev\n\n`);
}

async function enableTestMode() {
  current = parseEnv();
  const values = {
    NEXT_PUBLIC_TEST_MODE: "true",
    NEXT_PUBLIC_DEMO_MODE: "false",
    NEXT_PUBLIC_APP_URL: current.get("NEXT_PUBLIC_APP_URL") || "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: current.get("NEXT_PUBLIC_APP_NAME") || "VideoFlow",
    NEXT_PUBLIC_APP_LOGO_URL: current.get("NEXT_PUBLIC_APP_LOGO_URL") || "/logo.svg",
    NEXT_PUBLIC_BRAND_COLOR: current.get("NEXT_PUBLIC_BRAND_COLOR") || "#6d5bfc",
    NEXT_PUBLIC_MAX_RECORDING_MINUTES: current.get("NEXT_PUBLIC_MAX_RECORDING_MINUTES") || "15",
    NEXT_PUBLIC_MAX_VIDEO_BYTES: current.get("NEXT_PUBLIC_MAX_VIDEO_BYTES") || "524288000",
    NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH: current.get("NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH") || "true",
    NEXT_PUBLIC_FEATURE_LIBRARY_DELETE: current.get("NEXT_PUBLIC_FEATURE_LIBRARY_DELETE") || "true",
    NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS: current.get("NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS") || "true",
    NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS: current.get("NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS") || "true",
    NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING: current.get("NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING") || "true",
    NEXT_PUBLIC_FEATURE_ZERNIO: current.get("NEXT_PUBLIC_FEATURE_ZERNIO") || "false",
  };
  writeLocalEnv(values);
  stdout.write(`\n${green}${bold}Local test mode is ready.${reset}\n`);
  stdout.write("No Clerk, Convex, Cloudflare, or AI credentials are required. Videos stay in this browser's IndexedDB storage.\n\n");
  stdout.write(`${bold}Next:${reset}\n  npm run dev\n  open http://localhost:3000/test\n\n`);
}

function loadConvexValues(names) {
  for (const name of names) {
    const existing = getConvexEnv(name);
    if (existing) current.set(name, existing);
  }
}

async function ensureConvexLink() {
  if (convexLinked()) return true;
  stdout.write(`${yellow}This section needs a linked Convex deployment.${reset}\n`);
  if (!await confirm("Connect or create one now?", true)) return false;
  const result = run("npx", ["convex", "dev", "--once"], { interactive: true });
  current = parseEnv();
  return result.status === 0 && convexLinked();
}

async function editBrand() {
  current = parseEnv();
  section("A", "Brand and limits", "Update only the browser-facing identity and recording limits.");
  const values = {
    NEXT_PUBLIC_APP_NAME: await ask("Product name", "NEXT_PUBLIC_APP_NAME", "VideoFlow", { required: true }),
    NEXT_PUBLIC_APP_URL: (await ask("App URL", "NEXT_PUBLIC_APP_URL", "http://localhost:3000", { required: true, validate: localUrl, validationMessage: "Enter a complete http:// or https:// URL." })).replace(/\/$/, ""),
    NEXT_PUBLIC_APP_LOGO_URL: await ask("Logo path or URL", "NEXT_PUBLIC_APP_LOGO_URL", "/logo.svg", { required: true }),
    NEXT_PUBLIC_BRAND_COLOR: await ask("Accent color", "NEXT_PUBLIC_BRAND_COLOR", "#6d5bfc", { required: true, validate: (value) => /^#[0-9a-f]{6}$/i.test(value), validationMessage: "Use a six-digit hex color." }),
    NEXT_PUBLIC_MAX_RECORDING_MINUTES: await ask("Recording limit in minutes", "NEXT_PUBLIC_MAX_RECORDING_MINUTES", "15", { required: true, validate: (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 240 }),
    NEXT_PUBLIC_MAX_VIDEO_BYTES: await ask("Upload limit in bytes", "NEXT_PUBLIC_MAX_VIDEO_BYTES", "524288000", { required: true, validate: (value) => Number.isInteger(Number(value)) && Number(value) >= 10 * 1024 * 1024 }),
  };
  writeLocalEnv(values);
  if (convexLinked()) {
    setConvexEnv("APP_NAME", values.NEXT_PUBLIC_APP_NAME);
    setConvexEnv("APP_URL", values.NEXT_PUBLIC_APP_URL);
    setConvexEnv("BRAND_COLOR", values.NEXT_PUBLIC_BRAND_COLOR);
    setConvexEnv("MAX_VIDEO_BYTES", values.NEXT_PUBLIC_MAX_VIDEO_BYTES);
  }
  stdout.write(`${green}Brand and limits saved.${reset}\n`);
}

async function editAuth() {
  current = parseEnv();
  if (!await ensureConvexLink()) return;
  current = parseEnv();
  loadConvexValues(["CLERK_JWT_ISSUER_DOMAIN"]);
  section("B", "Clerk and Convex", "Update authentication without touching storage or optional integrations.");
  const convexUrl = await ask("Convex deployment URL", "NEXT_PUBLIC_CONVEX_URL", current.get("NEXT_PUBLIC_CONVEX_URL") || "", { required: true, validate: (value) => /^https:\/\/.+\.convex\.cloud\/?$/i.test(value), validationMessage: "Copy the https://…convex.cloud deployment URL." });
  const publishable = await ask("Clerk publishable key", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "", { required: true, validate: (value) => /^pk_(test|live)_/.test(value) });
  const secret = await ask("Clerk secret key", "CLERK_SECRET_KEY", "", { required: true, secret: true, validate: (value) => /^sk_(test|live)_/.test(value) });
  const issuer = await ask("Clerk JWT issuer domain", "CLERK_JWT_ISSUER_DOMAIN", "", { required: true, validate: localUrl });
  writeLocalEnv({ NEXT_PUBLIC_CONVEX_URL: convexUrl, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable, CLERK_SECRET_KEY: secret });
  setConvexEnv("CLERK_JWT_ISSUER_DOMAIN", issuer.replace(/\/$/, ""));
  stdout.write(`${green}Clerk and Convex settings saved.${reset}\n`);
}

async function editR2() {
  current = parseEnv();
  if (!await ensureConvexLink()) return;
  current = parseEnv();
  loadConvexValues(["R2_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET"]);
  section("C", "Cloudflare R2", "Update only media storage credentials and CORS.");
  const values = {
    R2_BUCKET: await ask("R2 bucket name", "R2_BUCKET", "videoflow", { required: true }),
    R2_ENDPOINT: (await ask("R2 S3 endpoint", "R2_ENDPOINT", "", { required: true, validate: (value) => /^https:\/\/.+\.r2\.cloudflarestorage\.com\/?$/i.test(value) })).replace(/\/$/, ""),
    R2_ACCESS_KEY_ID: await ask("R2 access key ID", "R2_ACCESS_KEY_ID", "", { required: true, secret: true }),
    R2_SECRET_ACCESS_KEY: await ask("R2 secret access key", "R2_SECRET_ACCESS_KEY", "", { required: true, secret: true }),
    R2_TOKEN: await ask("Cloudflare API token", "R2_TOKEN", "", { required: true, secret: true }),
  };
  for (const [name, value] of Object.entries(values)) setConvexEnv(name, value);
  if (await confirm("Apply the R2 CORS rule now?", true)) run("npm", ["run", "r2:cors"], { interactive: true });
  stdout.write(`${green}Cloudflare R2 settings saved.${reset}\n`);
}

async function editTranscription() {
  current = parseEnv();
  if (!await ensureConvexLink()) return;
  current = parseEnv();
  loadConvexValues(["TRANSCRIPTION_PROVIDER", "OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_TRANSCRIPTION_MODEL"]);
  section("D", "Transcription", "Switch providers or disable transcription without changing any other service.");
  const providerDefault = current.get("TRANSCRIPTION_PROVIDER") === "openrouter" ? 1 : current.get("TRANSCRIPTION_PROVIDER") === "none" ? 2 : 0;
  const provider = await choose("Transcription provider:", [
    { value: "openai", label: "OpenAI", detail: "timestamped whisper-1 segments" },
    { value: "openrouter", label: "OpenRouter", detail: "searchable full transcripts" },
    { value: "none", label: "Disabled", detail: "all other product features remain active" },
  ], providerDefault);
  setConvexEnv("TRANSCRIPTION_PROVIDER", provider);
  if (provider === "openai") {
    setConvexEnv("OPENAI_API_KEY", await ask("OpenAI API key", "OPENAI_API_KEY", "", { required: true, secret: true }));
    setConvexEnv("OPENAI_TRANSCRIPTION_MODEL", await ask("OpenAI model", "OPENAI_TRANSCRIPTION_MODEL", "whisper-1", { required: true }));
  } else if (provider === "openrouter") {
    setConvexEnv("OPENROUTER_API_KEY", await ask("OpenRouter API key", "OPENROUTER_API_KEY", "", { required: true, secret: true }));
    setConvexEnv("OPENROUTER_TRANSCRIPTION_MODEL", await ask("OpenRouter model", "OPENROUTER_TRANSCRIPTION_MODEL", "openai/whisper-large-v3", { required: true }));
  }
  stdout.write(`${green}Transcription setting saved.${reset}\n`);
}

async function editEmail() {
  current = parseEnv();
  if (!await ensureConvexLink()) return;
  current = parseEnv();
  loadConvexValues(["RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL"]);
  section("E", "Email notifications", "Enable, update, or disable Resend independently.");
  const enabled = await confirm("Enable Resend notifications?", !!current.get("RESEND_API_KEY"));
  if (!enabled) {
    run("npx", ["convex", "env", "remove", "RESEND_API_KEY"]);
    run("npx", ["convex", "env", "remove", "NOTIFICATION_FROM_EMAIL"]);
    stdout.write(`${green}Resend notifications disabled.${reset}\n`);
    return;
  }
  setConvexEnv("RESEND_API_KEY", await ask("Resend API key", "RESEND_API_KEY", "", { required: true, secret: true }));
  setConvexEnv("NOTIFICATION_FROM_EMAIL", await ask("Notification sender email", "NOTIFICATION_FROM_EMAIL", "", { required: true, validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }));
  stdout.write(`${green}Resend settings saved.${reset}\n`);
}

async function editMode() {
  current = parseEnv();
  const testEnabled = current.get("NEXT_PUBLIC_TEST_MODE") === "true";
  const mode = await choose("Choose the active runtime mode:", [
    { value: "test", label: "Local test mode", detail: "no accounts or credentials" },
    { value: "connected", label: "Connected mode", detail: "Clerk + Convex + Cloudflare" },
  ], testEnabled ? 0 : 1);
  writeLocalEnv({ NEXT_PUBLIC_TEST_MODE: mode === "test" ? "true" : "false", NEXT_PUBLIC_DEMO_MODE: "false" });
  stdout.write(`${green}${mode === "test" ? "Local test" : "Connected"} mode saved. Restart npm run dev to apply it.${reset}\n`);
}

async function editFeatures() {
  current = parseEnv();
  section("G", "Optional feature additions", "Enable or disable additive VideoFlow features without reverting source code or touching provider settings.");
  const mobileCameraSwitch = await confirm(
    "Enable front/back camera selection on supported phones?",
    configuredFeature("NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH"),
  );
  const libraryDelete = await confirm(
    "Enable deletion from library quick preview and multi-select?",
    configuredFeature("NEXT_PUBLIC_FEATURE_LIBRARY_DELETE"),
  );
  const reviewRequests = await confirm(
    "Enable no-login video review requests?",
    configuredFeature("NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS"),
  );
  const automaticTasks = await confirm(
    "Enable automatic task proposals from videos?",
    configuredFeature("NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS"),
  );
  const socialPublishing = await confirm(
    "Enable social publishing controls?",
    configuredFeature("NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING"),
  );
  const zernioSocial = socialPublishing && await confirm(
    "Offer Zernio as an optional unified social provider?",
    configuredFeature("NEXT_PUBLIC_FEATURE_ZERNIO", false),
  );
  writeLocalEnv({
    NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH: String(mobileCameraSwitch),
    NEXT_PUBLIC_FEATURE_LIBRARY_DELETE: String(libraryDelete),
    NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS: String(reviewRequests),
    NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS: String(automaticTasks),
    NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING: String(socialPublishing),
    NEXT_PUBLIC_FEATURE_ZERNIO: String(zernioSocial),
  });
  stdout.write(`${green}Optional feature switches saved.${reset} Restart npm run dev to apply them.\n`);
}

async function editConfiguration() {
  if (!existsSync(ENV_PATH)) {
    stdout.write(`${yellow}There is no saved configuration yet. Choose test mode or full setup first.${reset}\n`);
    return;
  }
  let done = false;
  while (!done) {
    current = parseEnv();
    stdout.write(`\n${purple}${bold}VideoFlow configuration manager${reset}\n`);
    const action = await choose("What would you like to edit?", [
      { value: "brand", label: "Brand, URL, and limits" },
      { value: "auth", label: "Clerk and Convex" },
      { value: "r2", label: "Cloudflare R2" },
      { value: "transcription", label: "Transcription provider" },
      { value: "email", label: "Resend notifications" },
      { value: "mode", label: "Test / connected mode" },
      { value: "features", label: "Optional feature additions" },
      { value: "done", label: "Save and exit" },
    ], 7);
    if (action === "brand") await editBrand();
    else if (action === "auth") await editAuth();
    else if (action === "r2") await editR2();
    else if (action === "transcription") await editTranscription();
    else if (action === "email") await editEmail();
    else if (action === "mode") await editMode();
    else if (action === "features") await editFeatures();
    else done = true;
  }
  stdout.write(`\n${green}Configuration saved.${reset} Restart the development server if it is running.\n`);
}

async function main() {
  stdout.write(`\n${purple}${bold}◆ VideoFlow setup and configuration${reset}\n`);
  stdout.write("Start without accounts, connect every provider, or edit one saved section. Secret input is hidden.\n\n");
  if (process.argv.includes("--test")) return enableTestMode();
  if (process.argv.includes("--edit")) return editConfiguration();
  const hasConfiguration = existsSync(ENV_PATH);
  const action = await choose("What would you like to do?", [
    { value: "test", label: "Start local test mode", detail: "record and save in this browser with no ENVs" },
    { value: "full", label: "Run full provider setup", detail: "Clerk, Convex, Cloudflare, and optional integrations" },
    { value: "edit", label: "Edit saved configuration", detail: "change only one section" },
  ], hasConfiguration ? 2 : 0);
  if (action === "test") await enableTestMode();
  else if (action === "edit") await editConfiguration();
  else await fullSetup();
}

main().catch((error) => {
  stdout.write(`\n${yellow}${error instanceof Error ? error.message : "Setup failed"}${reset}\n`);
  process.exitCode = 1;
});
