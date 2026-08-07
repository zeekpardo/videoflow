import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3210";

export default defineConfig({
  testDir: "./tests/e2e-demo",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    command: [
      "NEXT_PUBLIC_DEMO_MODE=true",
      "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3210",
      "NEXT_PUBLIC_DEMO_PURCHASE_URL=https://example.com/buy-videoflow",
      "NEXT_PUBLIC_DEMO_PRIVACY_URL=https://example.com/privacy",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA",
      "DEMO_SESSION_SECRET=demo-e2e-session-secret-that-is-longer-than-thirty-two-characters",
      "DEMO_RATE_LIMIT_SECRET=demo-e2e-rate-secret-that-is-longer-than-thirty-two-characters",
      "TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA",
      "DEVLAUNCH_CONVEX_URL=https://example.convex.cloud",
      "VIDEOFLOW_DEMO_INGEST_TOKEN=demo-e2e-ingest-token-that-is-longer-than-thirty-two-characters",
      "npm run dev:next -- -p 3210",
    ].join(" "),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium-demo", use: { ...devices["Desktop Chrome"] } }],
});
