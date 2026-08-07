import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3210";
const SESSION_SECRET = "demo-e2e-session-secret-that-is-longer-than-thirty-two-characters";

function signedSession() {
  const startedAt = Date.now();
  const session = {
    version: 1,
    sessionId: "d".repeat(64),
    emailHash: "e".repeat(64),
    name: "Export Tester",
    startedAt,
    expiresAt: startedAt + 72 * 60 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return { session, token: `${payload}.${signature}` };
}

test("local demo source files download under the production content security policy", async ({ page, context }) => {
  const { session, token } = signedSession();
  await context.addCookies([{
    name: "videoflow-demo-access",
    value: token,
    url: BASE_URL,
    httpOnly: true,
    sameSite: "Lax",
    expires: Math.floor(session.expiresAt / 1_000),
  }]);

  const response = await page.goto("/demo");
  expect(response?.headers()["content-security-policy"]).toContain("connect-src 'self' https://challenges.cloudflare.com");

  await page.evaluate(async ({ sessionId, expiresAt }) => {
    localStorage.setItem("videoflow-sales-demo:session", JSON.stringify({ sessionId, expiresAt }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-sales-demo", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("videos")) request.result.createObjectStore("videos", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("graphicAssets")) {
          const store = request.result.createObjectStore("graphicAssets", { keyPath: "key" });
          store.createIndex("by_video", "videoId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const original = new Blob(["original-source-bytes"], { type: "video/webm" });
    const screen = new Blob(["screen-source-bytes"], { type: "video/webm" });
    const camera = new Blob(["camera-source-bytes"], { type: "video/webm" });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      tx.objectStore("videos").put({
        id: "demo-source-download",
        sessionId,
        expiresAt,
        title: "CSP source export",
        createdAt: Date.now(),
        durationMs: 1_000,
        mode: "screen_camera",
        mimeType: "video/webm",
        sizeBytes: original.size,
        videoBlob: original,
        screenBlob: screen,
        cameraBlob: camera,
        zoomEffects: [],
        editState: {
          version: 2,
          trim: { startMs: 0, endMs: 1_000 },
          cuts: [],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
          camera: { x: 0.82, y: 0.8, size: 0.24, shape: "circle", mirror: false, visible: true },
          textOverlays: [],
          audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
          objects: [],
          interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
        },
        editRevision: 0,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }, { sessionId: session.sessionId, expiresAt: session.expiresAt });

  await page.goto("/demo/videos/demo-source-download");
  await expect(page.getByLabel("Video edit timeline")).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();

  for (const choice of [
    { name: /Original recording/, filename: "CSP-source-export-original.webm", contents: "original-source-bytes" },
    { name: /Screen source/, filename: "CSP-source-export-screen.webm", contents: "screen-source-bytes" },
    { name: /Webcam source/, filename: "CSP-source-export-camera.webm", contents: "camera-source-bytes" },
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: choice.name }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(choice.filename);
    const path = await download.path();
    expect(path).not.toBeNull();
    expect(await readFile(path!, "utf8")).toBe(choice.contents);
  }

  await expect(page.getByText("Download failed", { exact: true })).toHaveCount(0);
});
