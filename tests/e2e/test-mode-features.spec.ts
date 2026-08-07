import { expect, test } from "@playwright/test";

test("local links, engagement, and analytics work without providers", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/test");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("videos")) request.result.createObjectStore("videos", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      tx.objectStore("videos").put({
        id: "fixture-video",
        title: "Local feature tour",
        description: "A local-only share preview.",
        createdAt: Date.now(),
        durationMs: 30_000,
        mode: "screen_camera",
        mimeType: "video/webm",
        sizeBytes: 4,
        videoBlob: new Blob(["test"], { type: "video/webm" }),
        screenBlob: new Blob(["screen"], { type: "video/webm" }),
        cameraBlob: new Blob(["camera"], { type: "video/webm" }),
        thumbnailBlob: new Blob(["<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'><rect width='1280' height='720' fill='#6d5bfc'/></svg>"], { type: "image/svg+xml" }),
        shareToken: "fixture-share-token",
        sharedAt: Date.now(),
        allowComments: true,
        allowReactions: true,
        allowDownload: true,
        cta: { label: "Book a demo", url: "https://example.com/demo" },
        views: [],
        comments: [],
        reactions: [],
        zoomEffects: [],
        editState: {
          version: 1,
          cuts: [],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
          camera: { x: 0.17, y: 0.81, size: 0.26, shape: "circle", mirror: false, visible: true },
          textOverlays: [],
        },
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  });

  await expect(page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string | null>((resolve, reject) => {
      const request = db.transaction("videos", "readonly").objectStore("videos").get("fixture-video");
      request.onsuccess = () => { db.close(); resolve(request.result?.shareToken ?? null); };
      request.onerror = () => reject(request.error);
    });
  })).resolves.toBe("fixture-share-token");

  await page.reload();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByAltText("Local feature tour thumbnail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick preview" })).toBeVisible();
  await page.getByRole("button", { name: "Quick preview" }).click();
  const preview = page.getByRole("dialog", { name: "Local feature tour" });
  await expect(preview.getByText("Quick preview", { exact: true })).toBeVisible();
  await expect(preview.getByText("Screen + camera", { exact: true })).toBeVisible();
  await expect(preview.getByText("Enabled in this browser", { exact: true })).toBeVisible();
  await expect(preview.locator('video[data-video-layer="primary"]')).toHaveCount(1);
  await expect(preview.locator('video[data-video-layer="screen"]')).toHaveCount(1);
  await expect(preview.locator('video[data-video-layer="camera"]')).toHaveCount(1);
  await expect(preview.getByRole("button", { name: "Playback speed" })).toBeVisible();
  await expect(preview.getByText("Edit the video and manage details, thumbnails, sharing, and analytics.")).toBeVisible();
  await preview.getByRole("button", { name: "Open editor" }).click();
  await expect(page).toHaveURL(/\/test\/videos\/fixture-video/);
  await expect(page.getByLabel("Video edit timeline")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Video details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thumbnail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current frame" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate title card" })).toBeVisible();
  const detailsTab = page.getByRole("tab", { name: "Details" });
  await detailsTab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Share" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Share link" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Allow comments" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Allow reactions" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Allow download" })).toBeChecked();
  await expect(page.getByLabel("Call to action label")).toHaveValue("Book a demo");
  await expect(page.getByLabel("Call to action URL")).toHaveValue("https://example.com/demo");
  await page.getByRole("tab", { name: "Share" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Viewer analytics" })).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Download video" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Full resolution/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /1080p/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /720p/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Edited WebM/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Original recording/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Screen source/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Webcam source/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit project/ })).toBeVisible();
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Edit project/ }).click();
  await expect((await projectDownload).suggestedFilename()).toBe("Local-feature-tour.videoflow.json");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Zoom", exact: true }).click();
  await page.getByRole("button", { name: "Add zoom at 0:00", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Choose the zoom focus" })).toBeVisible();
  await page.getByRole("button", { name: "Choose zoom focus" }).click({ position: { x: 400, y: 180 } });
  await page.getByRole("button", { name: "Zoom 1 from 0:00 to 0:02" }).click();
  await page.getByRole("button", { name: "Set zoom to 2.5 times" }).click();
  await expect(page.getByLabel("Zoom magnification")).toHaveValue("2.5");

  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const cutTrack = page.locator('[data-timeline-track="cut"]');
  const cutTrackBox = await cutTrack.boundingBox();
  expect(cutTrackBox).not.toBeNull();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.02, cutTrackBox!.y + cutTrackBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.08, cutTrackBox!.y + cutTrackBox!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /^Cut 1 from/ })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Cut end" }).fill("6");
  await page.getByRole("spinbutton", { name: "Cut start" }).fill("5");
  await expect(page.getByRole("button", { name: "Cut 1 from 0:05 to 0:06" })).toBeVisible();

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Add text at 0:00" }).click();
  await page.locator("textarea").fill("This callout works.");

  await page.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audio" })).toBeVisible();
  await page.getByRole("slider", { name: /Master level/ }).fill("65");
  await page.getByRole("slider", { name: /Fade in/ }).fill("1.2");

  await page.getByRole("button", { name: "Objects", exact: true }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator('[data-video-object="rectangle"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /^Object 1 from/ })).toBeVisible();

  await page.getByRole("button", { name: "Clicks", exact: true }).click();
  await page.getByRole("button", { name: "Add keys" }).click();
  await page.getByLabel("Keys shown").fill("Shift + A");
  await page.getByRole("button", { name: "Add click" }).click();
  await page.getByRole("button", { name: "Choose click marker position" }).click({ position: { x: 360, y: 180 } });
  await expect(page.getByRole("button", { name: /^Click 1 from/ })).toBeVisible();
  await expect(page.getByText("Shift + A", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(page.getByText("Crop the frame")).toBeVisible();
  await page.getByRole("button", { name: "Screen", exact: true }).click();
  await expect(page.getByText("Shared screen layout")).toBeVisible();
  await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeDisabled();
  await expect(page.getByText("Using the combined recording")).toBeVisible();

  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<{ zooms: number; cuts: number; text: string; gain: number; fadeInMs: number; objects: number; clicks: number; keys: string }>((resolve, reject) => {
      const request = db.transaction("videos", "readonly").objectStore("videos").get("fixture-video");
      request.onsuccess = () => { db.close(); resolve({ zooms: request.result?.zoomEffects?.length ?? 0, cuts: request.result?.editState?.cuts?.length ?? 0, text: request.result?.editState?.textOverlays?.[0]?.text ?? "", gain: request.result?.editState?.audio?.gain ?? 0, fadeInMs: request.result?.editState?.audio?.fadeInMs ?? 0, objects: request.result?.editState?.objects?.length ?? 0, clicks: request.result?.editState?.interactions?.clicks?.length ?? 0, keys: request.result?.editState?.interactions?.keys?.[0]?.label ?? "" }); };
      request.onerror = () => reject(request.error);
    });
  })).toEqual({ zooms: 1, cuts: 1, text: "This callout works.", gain: 0.65, fadeInMs: 1_200, objects: 1, clicks: 1, keys: "Shift + A" });

  await page.goto("/test/v/fixture-share-token");
  await expect(page.getByText("Local feature tour", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book a demo" })).toHaveAttribute("href", "https://example.com/demo");
  await expect(page.getByText("This callout works.")).toBeVisible();
  await expect(page.getByText("Shift + A", { exact: true })).toBeVisible();
  await expect(page.locator('[data-video-object="rectangle"]')).toBeVisible();
  await expect(page.getByText("Everything on this device stays local. AI and real external delivery remain off.")).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByRole("button", { name: /Edited WebM/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Original recording/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Screen source/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Webcam source/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Edit project/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "👍" }).click();
  await expect(page.getByRole("button", { name: "👍 0s" })).toBeVisible();
  await page.locator('textarea[placeholder^="Comment at "]').fill("This local comment works.");
  await page.getByRole("button", { name: /Add comment at \d+s/ }).click();
  await expect(page.getByText("This local comment works.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d+s$/ })).toBeVisible();
  await expect(page.getByText("1 viewers")).toBeVisible();

  await page.goto("/test");
  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByText("Local feature tour")).toBeVisible();
  await expect(page.getByText("1 views")).toBeVisible();
});
