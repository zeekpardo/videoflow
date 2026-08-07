import { expect, test, type Page } from "@playwright/test";

const VIDEO_ID = "fullscreen-editor-layout-fixture";

test.use({ viewport: { width: 1440, height: 900 } });

async function seedLocalRecording(page: Page) {
  await page.evaluate(async (fixtureId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("videos")) {
          request.result.createObjectStore("videos", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("videos", "readwrite");
      transaction.objectStore("videos").put({
        id: fixtureId,
        title: "Full page editor fixture",
        createdAt: Date.now(),
        durationMs: 30_000,
        mode: "screen",
        mimeType: "video/webm",
        sizeBytes: 6,
        videoBlob: new Blob(["layout"], { type: "video/webm" }),
        shareToken: "fullscreen-editor-layout-share",
        sharedAt: Date.now(),
        allowComments: true,
        allowReactions: true,
        allowDownload: true,
        views: [],
        comments: [],
        reactions: [],
        zoomEffects: [],
        editState: {
          version: 1,
          cuts: [],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
          textOverlays: [],
        },
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }, VIDEO_ID);
}

test("the local editor owns the viewport without an outer card", async ({ page }) => {
  await page.goto("/test");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }

  await seedLocalRecording(page);
  await page.goto(`/test/videos/${VIDEO_ID}`);

  const editor = page.locator(`[data-video-key="${VIDEO_ID}"]`);
  await expect(editor).toBeVisible();

  const layout = await editor.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      borderRadius: style.borderTopLeftRadius,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(Math.abs(layout.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.right - layout.viewportWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.width - layout.viewportWidth)).toBeLessThanOrEqual(1);
  expect(layout.height).toBeGreaterThanOrEqual(layout.viewportHeight - 1);
  expect(layout.borderRadius).toBe("0px");
  expect(layout.borderWidth).toBe("0px");
  expect(layout.boxShadow).toBe("none");
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const toolbar = page.getByRole("navigation", { name: "Editor tools" });
  const timeline = page.getByLabel("Video edit timeline");
  const download = page.getByRole("button", { name: "Download", exact: true });
  const viewerPreview = page.getByRole("link", { name: "Viewer preview" });

  await expect(toolbar).toBeVisible();
  await expect(timeline).toBeVisible();
  await expect(download).toBeVisible();
  await expect(viewerPreview).toBeVisible();
  await expect(toolbar).toBeInViewport();
  await expect(timeline).toBeInViewport();
  await expect(download).toBeInViewport();
  await expect(viewerPreview).toBeInViewport();

  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trim & cut" })).toBeVisible();
  await page.getByRole("button", { name: "Transcript", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
});
