import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3210";
const SESSION_SECRET = "demo-e2e-session-secret-that-is-longer-than-thirty-two-characters";

function signedSession() {
  const startedAt = Date.now();
  const session = {
    version: 1,
    sessionId: "b".repeat(64),
    emailHash: "a".repeat(64),
    name: "Demo Buyer",
    startedAt,
    expiresAt: startedAt + 72 * 60 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return { session, token: `${payload}.${signature}` };
}

test("email code opens the protected local-only demo and stale media clears on return", async ({ page, context }) => {
  const { session, token } = signedSession();
  let requestBody: Record<string, unknown> | undefined;

  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.turnstile={render:function(_,options){setTimeout(function(){options.callback('test-turnstile-token')},0);return 'test-widget'},remove:function(){}};`,
    });
  });

  await page.route("**/api/demo/request-code", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challengeToken: "c".repeat(64),
        expiresAt: Date.now() + 10 * 60 * 1000,
        resendAvailableAt: Date.now() + 60_000,
      }),
    });
  });
  await page.route("**/api/demo/verify-code", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ challengeToken: "c".repeat(64), code: "123456" });
    await context.addCookies([{ name: "videoflow-demo-access", value: token, url: BASE_URL, httpOnly: true, sameSite: "Lax", expires: Math.floor(session.expiresAt / 1_000) }]);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, expiresAt: session.expiresAt, redirectTo: "/demo" }) });
  });

  const accessResponse = await page.goto("/demo/access");
  expect(accessResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(accessResponse?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Get private access" })).toBeVisible();
  await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "https://example.com/privacy");
  await expect(page.getByRole("link", { name: "Get VideoFlow" })).toHaveAttribute("href", "https://example.com/buy-videoflow");

  await page.getByLabel("Name").fill("Demo Buyer");
  await page.getByLabel("Work email").fill("buyer@example.com");
  await page.getByText(/I agree to the 72-hour demo terms/).click();
  await page.getByRole("button", { name: "Email my code" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  expect(requestBody).toMatchObject({
    name: "Demo Buyer",
    email: "buyer@example.com",
    acceptedTerms: true,
    marketingConsent: false,
    website: "",
    turnstileToken: "test-turnstile-token",
  });

  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Open the demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "What do you want to record?" })).toBeVisible();
  await expect(page.getByText(/Recording, editing, and publishing stay local/).first()).toBeVisible();
  await expect(page.getByText(/Demo · 3d left/)).toBeVisible();
  await expect(page.getByRole("button", { name: /share/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /viewer/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Explore guided V2 sample" }).click();
  await expect(page).toHaveURL(/\/demo\/videos\//);
  await expect(page.getByText("Guided V2 product demo")).toBeVisible();
  await page.getByRole("button", { name: "Enhance" }).click();
  await expect(page.getByText("V2 AI Director")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create edit plan/ })).toBeVisible();
  await page.getByRole("button", { name: /AI transcript/ }).click();
  await expect(page.getByRole("heading", { name: "Use optional AI for this demo?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
  await page.getByText("I understand and consent to this limited AI processing.").click();
  await expect(page.getByRole("button", { name: "Accept and continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Close" }).click();

  await page.evaluate(async () => {
    const expiresAt = Date.now() - 1;
    localStorage.setItem("videoflow-sales-demo:session", JSON.stringify({ sessionId: "expired-session", expiresAt }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-sales-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      tx.objectStore("videos").put({
        id: "expired-browser-video",
        sessionId: "expired-session",
        expiresAt,
        title: "Expired browser video",
        createdAt: Date.now() - 1000,
        durationMs: 1000,
        mode: "screen",
        mimeType: "video/webm",
        sizeBytes: 1,
        videoBlob: new Blob(["x"], { type: "video/webm" }),
        zoomEffects: [],
        editState: { version: 2, trim: { startMs: 0, endMs: 1000 }, cuts: [], crop: { top: 0, right: 0, bottom: 0, left: 0 }, screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 }, textOverlays: [], audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 }, objects: [], interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] } },
        editRevision: 0,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  });
  await context.clearCookies();
  await page.goto("/demo/access");
  await expect(page.getByRole("heading", { name: "Get private access" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-sales-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<number>((resolve, reject) => {
      const request = db.transaction("videos", "readonly").objectStore("videos").count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  })).toBe(0);

  await page.goto("/demo");
  await expect(page).toHaveURL(/\/demo\/access$/);
});
