import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const VIDEO_ID = "editor-controls-fixture";

async function seedLocalRecording(page: Page) {
  await page.addScriptTag({ path: path.join(process.cwd(), "node_modules/fix-webm-duration/fix-webm-duration.js") });
  await page.evaluate(async (fixtureId) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#635bff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "white";
    context.font = "700 42px sans-serif";
    context.fillText("Editor shortcuts", 145, 195);

    const stream = canvas.captureStream(20);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((candidate) => MediaRecorder.isTypeSupported(candidate))!;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 650_000 });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Could not create editor shortcut fixture"));
    });
    recorder.start(100);
    // Keep enough real encoded frames for playback assertions to remain
    // observable when the complete browser suite is running in parallel.
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const rawBlob = new Blob(chunks, { type: mimeType });
    const fixDuration = (window as typeof window & {
      ysFixWebmDuration: (blob: Blob, durationMs: number, options: { logger: false }) => Promise<Blob>;
    }).ysFixWebmDuration;
    const videoBlob = await fixDuration(rawBlob, 10_000, { logger: false });

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
        title: "Editor controls fixture",
        createdAt: Date.now(),
        durationMs: 10_000,
        mode: "screen",
        mimeType,
        sizeBytes: videoBlob.size,
        videoBlob,
        shareToken: "editor-controls-share",
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

async function openEditor(page: Page) {
  await page.goto("/test");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }
  await seedLocalRecording(page);
  await page.goto(`/test/videos/${VIDEO_ID}`);
  await expect(page.locator(`[data-video-key="${VIDEO_ID}"]`)).toBeVisible();
}

async function canvasZoom(page: Page) {
  const value = await page.locator("[data-editor-canvas]").getAttribute("data-canvas-zoom");
  expect(value).not.toBeNull();
  return Number(value);
}

async function setEditorPlayhead(page: Page, seconds: number) {
  const primary = page.locator('[data-video-layer="primary"]');
  await expect.poll(() => primary.evaluate((node) => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await primary.evaluate((node, nextTime) => {
    const video = node as HTMLVideoElement;
    video.currentTime = nextTime;
    video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  }, seconds);
  await expect.poll(() => primary.evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeCloseTo(seconds, 1);
}

async function expectEditorPlayhead(page: Page, seconds: number) {
  await expect.poll(() => page.locator('[data-video-layer="primary"]').evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeCloseTo(seconds, 1);
}

test("shared editor canvas supports fit and precise preview zoom controls", async ({ page }) => {
  await openEditor(page);

  await expect(page.locator("[data-editor-canvas-viewport]")).toBeVisible();
  await expect(page.locator("[data-editor-canvas]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeVisible();

  await page.getByRole("button", { name: "Fit canvas to editor" }).click();
  const fitZoom = await canvasZoom(page);
  expect(fitZoom).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Zoom canvas in" }).click();
  const zoomedIn = await canvasZoom(page);
  expect(zoomedIn).toBeGreaterThan(fitZoom);

  await page.getByRole("button", { name: "Zoom canvas out" }).click();
  expect(await canvasZoom(page)).toBeLessThan(zoomedIn);

  await page.getByRole("button", { name: "Zoom canvas in" }).click();
  await page.getByRole("button", { name: "Zoom canvas in" }).click();
  expect(await canvasZoom(page)).toBeGreaterThan(fitZoom);
  await page.keyboard.press("Control+0");
  expect(await canvasZoom(page)).toBe(fitZoom);

  await page.keyboard.press("Control++");
  expect(await canvasZoom(page)).toBeGreaterThan(fitZoom);
  await page.keyboard.press("Control+-");
  expect(await canvasZoom(page)).toBe(fitZoom);
});

test("timeline ruler scrubs continuously and keeps its playhead aligned", async ({ page }) => {
  await openEditor(page);

  const primaryVideo = page.locator('[data-video-layer="primary"]');
  await expect.poll(() => primaryVideo.evaluate((node) => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  // The generated WebM contains three seconds of encoded frames with
  // ten-second metadata, so Chromium can snap a real seek past frame three to
  // the end. Keep this interaction test focused on the editor's scrub value.
  await primaryVideo.evaluate((node) => {
    const video = node as HTMLVideoElement;
    let currentTime = video.currentTime;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => { currentTime = value; },
    });
  });

  const ruler = page.getByRole("button", { name: "Seek edit timeline" });
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();

  await page.mouse.move(rulerBox!.x + rulerBox!.width * 0.15, rulerBox!.y + rulerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rulerBox!.x + rulerBox!.width * 0.7, rulerBox!.y + rulerBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expectEditorPlayhead(page, 7);
  await expect.poll(async () => {
    const transform = await page.locator("[data-timeline-playhead]").evaluate((node) => getComputedStyle(node).transform);
    const match = transform.match(/^matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+)/);
    return match ? Number(match[1]) : 0;
  }).toBeGreaterThan(rulerBox!.width * 0.65);
});

test("workspace shortcuts edit globally but never fire while typing", async ({ page }) => {
  await openEditor(page);

  await page.keyboard.press("c");
  await expect(page.getByRole("heading", { name: "Trim & cut" })).toBeVisible();
  await expect(page.getByText("Drag to create a cut", { exact: true })).toBeVisible();
  const timeline = page.locator("[data-editor-timeline]");
  await expect(timeline).toHaveCSS("user-select", "none");
  const cutTrack = page.locator('[data-timeline-track="cut"]');
  await expect(cutTrack).toHaveAttribute("data-cut-creation-enabled", "true");
  const cutTrackBox = await cutTrack.boundingBox();
  expect(cutTrackBox).not.toBeNull();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.1, cutTrackBox!.y + cutTrackBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.3, cutTrackBox!.y + cutTrackBox!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Cut 1 from 0:01 to 0:03" })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Cut 1 from/ })).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("button", { name: "Cut 1 from 0:01 to 0:03" })).toBeVisible();

  const endHandle = page.getByRole("separator", { name: "Resize end of Cut 1" });
  const endHandleBox = await endHandle.boundingBox();
  expect(endHandleBox).not.toBeNull();
  await page.mouse.move(endHandleBox!.x + endHandleBox!.width / 2, endHandleBox!.y + endHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(endHandleBox!.x + endHandleBox!.width / 2 + cutTrackBox!.width * 0.1, endHandleBox!.y + endHandleBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Cut 1 from 0:01 to 0:04" })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /^Cut 1 from/ })).toHaveCount(0);

  await page.keyboard.press("z");
  await expect(page.getByRole("heading", { name: "Zoom a detail" })).toBeVisible();
  await page.getByRole("button", { name: "Add zoom at 0:00" }).click();
  await expect(page.getByRole("status")).toContainText("Choose the zoom focus");
  await expect(page.getByRole("button", { name: "Choose zoom focus" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose zoom focus" })).toHaveCount(0);

  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { name: "Timed text" })).toBeVisible();
  await page.getByRole("button", { name: "Add text at 0:00" }).click();
  const textarea = page.locator("textarea");
  await textarea.fill("Typing stays in this field");
  const zoomBeforeTyping = await canvasZoom(page);

  await page.keyboard.press("c");
  await expect(page.getByRole("heading", { name: "Timed text" })).toBeVisible();
  await expect(textarea).toHaveValue("Typing stays in this fieldc");

  await page.keyboard.press("Control++");
  expect(await canvasZoom(page)).toBe(zoomBeforeTyping);
  await expect(page.getByRole("button", { name: /^Text 1 from/ })).toBeVisible();

  await textarea.press("Backspace");
  await expect(page.getByRole("button", { name: /^Text 1 from/ })).toBeVisible();
  await expect(textarea).toHaveValue("Typing stays in this field");

  await page.getByRole("heading", { name: "Timed text" }).click();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Timed text" })).toBeVisible();
});

test("adding cuts, text, and zoom effects preserves the current playhead", async ({ page }) => {
  await openEditor(page);
  await setEditorPlayhead(page, 6.2);

  await page.keyboard.press("c");
  const cutTrack = page.locator('[data-timeline-track="cut"]');
  const cutTrackBox = await cutTrack.boundingBox();
  expect(cutTrackBox).not.toBeNull();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.12, cutTrackBox!.y + cutTrackBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * 0.23, cutTrackBox!.y + cutTrackBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /^Cut 1 from/ })).toBeVisible();
  await expectEditorPlayhead(page, 6.2);

  await page.keyboard.press("t");
  await page.getByRole("button", { name: "Add text at 0:06" }).click();
  await expect(page.getByRole("button", { name: /^Text 1 from 0:06/ })).toBeVisible();
  await expectEditorPlayhead(page, 6.2);

  await page.keyboard.press("z");
  await page.getByRole("button", { name: "Add zoom at 0:06" }).click();
  await expectEditorPlayhead(page, 6.2);
  const focusTarget = page.getByRole("button", { name: /Choose (?:zoom )?focus(?: in preview)?/i });
  await expect(focusTarget).toBeVisible();
  await focusTarget.click({ position: { x: 60, y: 60 } });
  await expect(page.getByRole("button", { name: /^Zoom 1 from 0:06/ })).toBeVisible();
  await expectEditorPlayhead(page, 6.2);
});

test("autosave keeps the media source and playhead stable after adding text", async ({ page }) => {
  await openEditor(page);
  await setEditorPlayhead(page, 6.2);

  const primaryVideo = page.locator('[data-video-layer="primary"]');
  const sourceBeforeEdit = await primaryVideo.getAttribute("src");
  expect(sourceBeforeEdit).toMatch(/^blob:/);

  await page.keyboard.press("t");
  await page.getByRole("button", { name: "Add text at 0:06" }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();

  await expect(primaryVideo).toHaveAttribute("src", sourceBeforeEdit!);
  await expectEditorPlayhead(page, 6.2);
});

test("playback and seek shortcuts fire once globally and with the player focused", async ({ page }) => {
  await openEditor(page);

  const primaryVideo = page.locator('[data-video-layer="primary"]');
  const player = primaryVideo.locator("..");
  await expect.poll(() => primaryVideo.evaluate((node) => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await primaryVideo.evaluate((node) => {
    const video = node as HTMLVideoElement;
    const probe = { paused: true, ended: false, currentTime: 0.2, playCalls: 0, pauseCalls: 0 };
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => probe.paused },
      ended: { configurable: true, get: () => probe.ended },
      currentTime: { configurable: true, get: () => probe.currentTime, set: (value: number) => { probe.currentTime = value; } },
      duration: { configurable: true, get: () => 10 },
    });
    video.play = () => {
      probe.playCalls += 1;
      probe.paused = false;
      probe.ended = false;
      return Promise.resolve();
    };
    video.pause = () => {
      probe.pauseCalls += 1;
      probe.paused = true;
    };
    (window as typeof window & { __editorShortcutProbe?: typeof probe }).__editorShortcutProbe = probe;
  });
  const probe = () => page.evaluate(() => (window as typeof window & {
    __editorShortcutProbe: { paused: boolean; currentTime: number; playCalls: number; pauseCalls: number };
  }).__editorShortcutProbe);

  await page.getByRole("heading", { name: "Edit your recording" }).click();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await probe()).playCalls).toBe(1);
  expect((await probe()).paused).toBe(false);
  await page.keyboard.press("k");
  await expect.poll(async () => (await probe()).pauseCalls).toBe(1);
  expect((await probe()).paused).toBe(true);

  await player.focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await probe()).playCalls).toBe(2);
  expect((await probe()).paused).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await probe()).pauseCalls).toBe(2);
  expect((await probe()).paused).toBe(true);

  await primaryVideo.evaluate((node) => { (node as HTMLVideoElement).currentTime = 0.2; });
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await probe()).currentTime).toBeCloseTo(1.2, 1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await probe()).currentTime).toBeCloseTo(6.2, 1);

  await page.getByRole("heading", { name: "Edit your recording" }).click();
  await primaryVideo.evaluate((node) => { (node as HTMLVideoElement).currentTime = 0.2; });
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await probe()).currentTime).toBeCloseTo(1.2, 1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await probe()).currentTime).toBeCloseTo(6.2, 1);

  // Sliders keep DOM focus after a pointer edit. They are not text-entry
  // controls, so the global playback shortcut must remain available there.
  await page.keyboard.press("a");
  const audioSlider = page.getByRole("slider", { name: /Fade in/i });
  await expect(audioSlider).toBeVisible();
  await audioSlider.focus();
  const sliderValueBeforeArrow = Number(await audioSlider.inputValue());
  const playCallsBeforeArrow = (await probe()).playCalls;
  await page.keyboard.press("ArrowRight");
  expect(Number(await audioSlider.inputValue())).toBeGreaterThan(sliderValueBeforeArrow);
  expect((await probe()).playCalls).toBe(playCallsBeforeArrow);
  await primaryVideo.evaluate(() => {
    const current = (window as typeof window & {
      __editorShortcutProbe: { paused: boolean };
    }).__editorShortcutProbe;
    current.paused = true;
  });
  const playCallsBeforeSliderShortcut = (await probe()).playCalls;
  await page.keyboard.press("Space");
  await expect.poll(async () => (await probe()).playCalls).toBe(playCallsBeforeSliderShortcut + 1);

  const playCallsBeforeRepeat = (await probe()).playCalls;
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      repeat: true,
      bubbles: true,
    }));
  });
  expect((await probe()).playCalls).toBe(playCallsBeforeRepeat);

  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const timeField = page.locator('input[type="number"]').first();
  await expect(timeField).toBeVisible();
  await timeField.focus();
  const playCallsBeforeNumberInput = (await probe()).playCalls;
  await page.keyboard.press("Space");
  expect((await probe()).playCalls).toBe(playCallsBeforeNumberInput);

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /Add text at/i }).click();
  const textEditor = page.locator("textarea").first();
  await textEditor.fill("Keeptyping");
  await textEditor.focus();
  await textEditor.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(4, 4));
  const playCallsBeforeTyping = (await probe()).playCalls;
  await textEditor.press("Space");
  await expect(textEditor).toHaveValue("Keep typing");
  expect((await probe()).playCalls).toBe(playCallsBeforeTyping);
});
