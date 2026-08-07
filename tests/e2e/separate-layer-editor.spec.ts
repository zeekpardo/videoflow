import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// These tests synthesize several MediaRecorder streams at once. Running the
// file's fixtures concurrently can exhaust Chromium's encoders and produce an
// empty WebM before the editor is even mounted, so keep this media-heavy group
// serial while the rest of the browser suite remains fully parallel.
test.describe.configure({ mode: "serial" });

const PRIMARY = { red: 37, green: 99, blue: 235 };
const SCREEN = { red: 16, green: 185, blue: 129 };
const CAMERA = { red: 244, green: 63, blue: 94 };

interface LayeredFixtureOptions {
  durationMs?: number;
  cuts?: { id: string; startMs: number; endMs: number }[];
  trim?: { startMs: number; endMs: number };
  zoomEffects?: { id: string; startMs: number; endMs: number; x: number; y: number; scale: number }[];
}

async function seedLayeredRecording(page: Page, id: string, corruptScreen = false, options: LayeredFixtureOptions = {}) {
  await page.addScriptTag({ path: path.join(process.cwd(), "node_modules/fix-webm-duration/fix-webm-duration.js") });
  await page.evaluate(async ({ fixtureId, brokenScreen, fixtureOptions }) => {
    const fixtureDurationMs = fixtureOptions.durationMs ?? 700;
    async function recordColorVideo({
      width,
      height,
      color,
      label,
      withAudio = false,
    }: {
      width: number;
      height: number;
      color: string;
      label: string;
      withAudio?: boolean;
    }) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const paint = () => {
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        context.fillStyle = "rgba(255,255,255,.95)";
        context.font = `700 ${Math.max(24, Math.round(height / 12))}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, width / 2, height / 2);
        context.fillStyle = "rgba(255,255,255,.7)";
        context.fillRect((frame++ % 20) * (width / 20), height - 12, width / 20, 8);
      };
      paint();

      const canvasStream = canvas.captureStream(20);
      let audioContext: AudioContext | null = null;
      let oscillator: OscillatorNode | null = null;
      if (withAudio) {
        audioContext = new AudioContext();
        oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const audioDestination = audioContext.createMediaStreamDestination();
        oscillator.frequency.value = 180;
        gain.gain.value = 0.02;
        oscillator.connect(gain).connect(audioDestination);
        await audioContext.resume();
        oscillator.start();
        audioDestination.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      }

      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate))!;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 750_000 });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error(`Could not record ${label} fixture`));
      });
      recorder.start(100);
      const timer = window.setInterval(paint, 50);
      await new Promise((resolve) => window.setTimeout(resolve, fixtureDurationMs));
      window.clearInterval(timer);
      recorder.stop();
      await stopped;
      oscillator?.stop();
      canvasStream.getTracks().forEach((track) => track.stop());
      await audioContext?.close();
      const rawBlob = new Blob(chunks, { type: mimeType });
      const fixDuration = (window as typeof window & {
        ysFixWebmDuration: (blob: Blob, durationMs: number, options: { logger: false }) => Promise<Blob>;
      }).ysFixWebmDuration;
      return fixDuration(rawBlob, fixtureDurationMs, { logger: false });
    }

    const [primaryBlob, screenBlob, cameraBlob] = await Promise.all([
      recordColorVideo({ width: 960, height: 540, color: "#2563eb", label: "COMBINED", withAudio: true }),
      recordColorVideo({ width: 1280, height: 720, color: "#10b981", label: "SCREEN" }),
      recordColorVideo({ width: 640, height: 480, color: "#f43f5e", label: "WEBCAM" }),
    ]);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("videos")) request.result.createObjectStore("videos", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("videos", "readwrite");
      transaction.objectStore("videos").put({
        id: fixtureId,
        title: brokenScreen ? "Layer fallback fixture" : "Separate layer fixture",
        createdAt: Date.now(),
        durationMs: fixtureDurationMs,
        mode: "screen_camera",
        mimeType: primaryBlob.type,
        sizeBytes: primaryBlob.size,
        width: 960,
        height: 540,
        videoBlob: primaryBlob,
        screenBlob: brokenScreen ? new Blob(["not a playable webm"], { type: "video/webm" }) : screenBlob,
        cameraBlob,
        views: [],
        comments: [],
        reactions: [],
        zoomEffects: fixtureOptions.zoomEffects ?? [{ id: "active-screen-zoom", startMs: 100, endMs: 600, x: 0.2, y: 0.8, scale: 1.6 }],
        editState: fixtureOptions.trim ? {
          version: 2,
          trim: fixtureOptions.trim,
          cuts: fixtureOptions.cuts ?? [],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
          camera: { x: 0.78, y: 0.28, size: 0.28, shape: "circle", mirror: false, visible: true },
          textOverlays: [],
          audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
          objects: [],
          interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
        } : {
          version: 1,
          cuts: fixtureOptions.cuts ?? [],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
          camera: { x: 0.78, y: 0.28, size: 0.28, shape: "circle", mirror: false, visible: true },
          textOverlays: [],
        },
      });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { fixtureId: id, brokenScreen: corruptScreen, fixtureOptions: options });
}

async function sampleScreenshot(page: Page, image: Buffer, points: { x: number; y: number }[]) {
  return page.evaluate(async ({ encoded, samples }) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode player screenshot"));
    });
    image.src = `data:image/png;base64,${encoded}`;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return samples.map(({ x, y }) => {
      const data = context.getImageData(
        Math.min(canvas.width - 1, Math.max(0, Math.round(x * canvas.width))),
        Math.min(canvas.height - 1, Math.max(0, Math.round(y * canvas.height))),
        1,
        1,
      ).data;
      return { red: data[0], green: data[1], blue: data[2] };
    });
  }, { encoded: image.toString("base64"), samples: points });
}

function expectColor(actual: { red: number; green: number; blue: number }, expected: typeof PRIMARY, tolerance = 35) {
  expect(Math.abs(actual.red - expected.red)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.green - expected.green)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.blue - expected.blue)).toBeLessThanOrEqual(tolerance);
}

async function inspectExportedWebm(page: Page, filePath: string) {
  const encoded = (await readFile(filePath)).toString("base64");
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not decode the edited separate-layer export"));
    });
    const sampleTime = Math.min(0.35, Math.max(0, video.duration / 2));
    await new Promise<void>((resolve) => {
      if (sampleTime === 0) return resolve();
      video.onseeked = () => resolve();
      video.currentTime = sampleTime;
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(video, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    let cyanStrokePixels = 0;
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        if (red < 70 && green > 210 && blue > 210) cyanStrokePixels += 1;
        if (red > 150 && red > green * 1.5 && red > blue * 1.25) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    URL.revokeObjectURL(url);
    return {
      width: canvas.width,
      height: canvas.height,
      cyanStrokePixels,
      cameraBounds: maxX >= 0 ? { minX, minY, maxX, maxY } : null,
    };
  }, encoded);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/test");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }
});

test("separate screen and webcam sources keep their intended editor layout", async ({ page }) => {
  test.setTimeout(60_000);
  await seedLayeredRecording(page, "separate-layer-editor-fixture");
  await page.goto("/test/videos/separate-layer-editor-fixture");

  const editor = page.locator('[data-video-key="separate-layer-editor-fixture"]');
  const videos = editor.locator("video");
  await expect(videos).toHaveCount(3);

  await expect.poll(() => videos.evaluateAll((elements) => elements.map((element) => ({
    readyState: (element as HTMLVideoElement).readyState,
    width: (element as HTMLVideoElement).videoWidth,
    height: (element as HTMLVideoElement).videoHeight,
  })))).toEqual([
    expect.objectContaining({ width: 960, height: 540 }),
    expect.objectContaining({ width: 1280, height: 720 }),
    expect.objectContaining({ width: 640, height: 480 }),
  ]);
  await expect(page.getByText("Screen and camera layers ready")).toBeVisible();

  const screenLayer = page.getByRole("button", { name: "Select screen layer" });
  const cameraLayer = page.getByRole("button", { name: "Select camera layer" });
  await expect(screenLayer).toBeVisible();
  await expect(cameraLayer).toBeVisible();
  await screenLayer.click();
  await expect(screenLayer).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Shared screen layout" })).toBeVisible();
  await cameraLayer.click();
  await expect(cameraLayer).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Webcam layer", { exact: true })).toBeVisible();
  await expect(page.getByText("Webcam stroke", { exact: true })).toBeVisible();
  await page.getByLabel("Stroke width").fill("12");
  await page.locator('input[aria-label="Stroke color"]').fill("#00ffff");

  const player = videos.first().locator("..");
  await videos.first().evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    video.pause();
  });

  const [playerBox, cameraBox] = await Promise.all([
    player.boundingBox(),
    videos.nth(2).locator("..").boundingBox(),
  ]);
  expect(playerBox).not.toBeNull();
  expect(cameraBox).not.toBeNull();
  await expect(videos.nth(2).locator("..")).toHaveCSS("border-width", "12px");
  await expect(videos.nth(2).locator("..")).toHaveCSS("border-color", "rgb(0, 255, 255)");
  expect(cameraBox!.width / playerBox!.width).toBeGreaterThan(0.12);
  expect(cameraBox!.width / playerBox!.width).toBeLessThan(0.2);
  expect(cameraBox!.height / playerBox!.height).toBeGreaterThan(0.23);
  expect(cameraBox!.height / playerBox!.height).toBeLessThan(0.33);

  const cameraCenter = {
    x: (cameraBox!.x + cameraBox!.width / 2 - playerBox!.x) / playerBox!.width,
    y: (cameraBox!.y + cameraBox!.height / 2 - playerBox!.y) / playerBox!.height,
  };
  expect(cameraCenter.x).toBeCloseTo(0.78, 2);
  expect(cameraCenter.y).toBeCloseTo(0.28, 2);
  expect(cameraBox!.height / Math.min(playerBox!.width, playerBox!.height)).toBeCloseTo(0.28, 2);

  // The zoom active at this source time belongs to the shared screen only.
  // It must not move or scale the webcam away from its saved editor state.
  await videos.first().evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 0.3;
    });
    video.dispatchEvent(new Event("timeupdate"));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
  });
  const zoomedCameraBox = await videos.nth(2).locator("..").boundingBox();
  expect(zoomedCameraBox).not.toBeNull();
  expect(zoomedCameraBox!.x).toBeCloseTo(cameraBox!.x, 0);
  expect(zoomedCameraBox!.y).toBeCloseTo(cameraBox!.y, 0);
  expect(zoomedCameraBox!.width).toBeCloseTo(cameraBox!.width, 0);
  expect(zoomedCameraBox!.height).toBeCloseTo(cameraBox!.height, 0);

  const [screenPixel, cameraPixel] = await sampleScreenshot(
    page,
    await player.screenshot(),
    [{ x: 0.35, y: 0.24 }, { x: 0.75, y: 0.23 }],
  );
  expectColor(screenPixel, SCREEN);
  expectColor(cameraPixel, CAMERA);

  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Full resolution/ })).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Edited WebM/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = await inspectExportedWebm(page, downloadPath!);
  expect(exported).toMatchObject({ width: 1280, height: 720 });
  expect(exported.cyanStrokePixels).toBeGreaterThan(250);
  expect(exported.cameraBounds).not.toBeNull();
  const exportedCamera = exported.cameraBounds!;
  expect((exportedCamera.minX + exportedCamera.maxX) / 2 / exported.width).toBeCloseTo(0.78, 1);
  expect((exportedCamera.minY + exportedCamera.maxY) / 2 / exported.height).toBeCloseTo(0.28, 1);
  expect((exportedCamera.maxY - exportedCamera.minY) / Math.min(exported.width, exported.height)).toBeCloseTo(0.28, 1);
  await page.keyboard.press("Escape");

  const dragStart = await videos.nth(2).locator("..").boundingBox();
  expect(dragStart).not.toBeNull();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(dragStart!.x + dragStart!.width / 2, dragStart!.y + dragStart!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragStart!.x + dragStart!.width / 2 + 55, dragStart!.y + dragStart!.height / 2 + 24, { steps: 8 });
  await page.mouse.up();
  const dragEnd = await videos.nth(2).locator("..").boundingBox();
  expect(dragEnd).not.toBeNull();
  expect(dragEnd!.x).toBeGreaterThan(dragStart!.x + 35);
  expect(dragEnd!.y).toBeGreaterThan(dragStart!.y + 10);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.keyboard.press("Control+z");
  const undoBox = await videos.nth(2).locator("..").boundingBox();
  expect(undoBox).not.toBeNull();
  expect(undoBox!.x).toBeCloseTo(dragStart!.x, 0);
  expect(undoBox!.y).toBeCloseTo(dragStart!.y, 0);
  await page.keyboard.press("Control+Shift+z");
  const redoBox = await videos.nth(2).locator("..").boundingBox();
  expect(redoBox).not.toBeNull();
  expect(redoBox!.x).toBeCloseTo(dragEnd!.x, 0);
  expect(redoBox!.y).toBeCloseTo(dragEnd!.y, 0);

  await page.getByRole("switch", { name: "Hide webcam" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(videos.nth(2)).toHaveAttribute("data-layer-active", "false");
  await expect(videos.nth(2).locator("..")).toHaveCSS("opacity", "0");
  const [revealedScreenPixel] = await sampleScreenshot(page, await player.screenshot(), [{ x: 0.78, y: 0.28 }]);
  expectColor(revealedScreenPixel, SCREEN);
});

test("continuous layered playback stays synchronized through one cut and screen-only zoom", async ({ page }) => {
  test.setTimeout(60_000);
  await seedLayeredRecording(page, "continuous-layer-playback-fixture", false, {
    durationMs: 4_800,
    cuts: [{ id: "continuous-cut", startMs: 900, endMs: 1_800 }],
    zoomEffects: [{ id: "continuous-zoom", startMs: 2_200, endMs: 4_000, x: 0.24, y: 0.72, scale: 1.75 }],
  });
  await page.goto("/test/videos/continuous-layer-playback-fixture");

  const editor = page.locator('[data-video-key="continuous-layer-playback-fixture"]');
  await expect(page.getByText("Screen and camera layers ready")).toBeVisible();

  const result = await editor.evaluate(async (element) => {
    const [primary, screen, camera] = Array.from(element.querySelectorAll("video")) as HTMLVideoElement[];
    if (!primary || !screen || !camera) throw new Error("Expected primary, screen, and camera video layers");
    const canvas = primary.parentElement!;
    const screenFrame = screen.parentElement!;
    const cameraFrame = camera.parentElement!;

    const waitForSeek = (video: HTMLVideoElement, time: number) => new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`Timed out seeking to ${time}`)), 4_000);
      video.addEventListener("seeked", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      video.currentTime = time;
    });

    primary.muted = true;
    await waitForSeek(primary, 0.25);
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    let primarySeekCount = 0;
    const seekTargets: number[] = [];
    const onSeeking = () => {
      primarySeekCount += 1;
      seekTargets.push(primary.currentTime);
    };
    primary.addEventListener("seeking", onSeeking);

    type Bounds = { x: number; y: number; width: number; height: number };
    type Sample = {
      primary: number;
      screen: number;
      camera: number;
      canvas: Bounds;
      webcam: Bounds;
      screenTransform: string;
      webcamTransform: string;
      layersPlaying: boolean;
    };
    const rect = (node: Element): Bounds => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const samples: Sample[] = [];
    const sample = () => samples.push({
      primary: primary.currentTime,
      screen: screen.currentTime,
      camera: camera.currentTime,
      canvas: rect(canvas),
      webcam: rect(cameraFrame),
      screenTransform: getComputedStyle(screenFrame).transform,
      webcamTransform: getComputedStyle(cameraFrame).transform,
      layersPlaying: !screen.paused && !camera.paused,
    });

    await primary.play();
    const deadline = performance.now() + 5_500;
    while (primary.currentTime < 3.45 && !primary.ended && performance.now() < deadline) {
      sample();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
    sample();
    primary.pause();
    primary.removeEventListener("seeking", onSeeking);

    return { samples, primarySeekCount, seekTargets, finalTime: primary.currentTime };
  });

  expect(result.finalTime).toBeGreaterThanOrEqual(3.4);
  expect(result.primarySeekCount).toBe(1);
  expect(result.seekTargets).toHaveLength(1);
  expect(result.seekTargets[0]).toBeCloseTo(1.8, 1);

  const settledSamples = result.samples.filter((sample) => sample.primary >= 0.4);
  expect(settledSamples.length).toBeGreaterThan(10);
  const maxLayerDrift = Math.max(...settledSamples.flatMap((sample) => [
    Math.abs(sample.primary - sample.screen),
    Math.abs(sample.primary - sample.camera),
  ]));
  expect(maxLayerDrift).toBeLessThanOrEqual(0.22);
  expect(settledSamples.filter((sample) => sample.primary < 0.85).some((sample) => sample.layersPlaying)).toBe(true);
  expect(settledSamples.filter((sample) => sample.primary > 2.3).some((sample) => sample.layersPlaying)).toBe(true);

  const baseline = settledSamples.find((sample) => sample.primary >= 0.45 && sample.primary < 0.8);
  const activeZoom = settledSamples.find((sample) => sample.primary >= 2.55 && sample.primary < 3.2);
  expect(baseline).toBeDefined();
  expect(activeZoom).toBeDefined();
  expect(activeZoom!.screenTransform).not.toBe(baseline!.screenTransform);
  expect(activeZoom!.webcamTransform).toBe(baseline!.webcamTransform);

  const maxBoundsDelta = (key: "canvas" | "webcam") => Math.max(...settledSamples.flatMap((sample) => [
    Math.abs(sample[key].x - baseline![key].x),
    Math.abs(sample[key].y - baseline![key].y),
    Math.abs(sample[key].width - baseline![key].width),
    Math.abs(sample[key].height - baseline![key].height),
  ]));
  expect(maxBoundsDelta("canvas")).toBeLessThanOrEqual(1);
  expect(maxBoundsDelta("webcam")).toBeLessThanOrEqual(1);
});

test("trim handles and a 100ms cut snap during paused seeking", async ({ page }) => {
  test.setTimeout(60_000);
  await seedLayeredRecording(page, "trim-short-cut-fixture", false, {
    durationMs: 3_000,
    trim: { startMs: 400, endMs: 2_400 },
    cuts: [{ id: "short-cut", startMs: 900, endMs: 1_000 }],
    zoomEffects: [],
  });
  await page.goto("/test/videos/trim-short-cut-fixture");

  await expect(page.getByRole("separator", { name: "Trim start" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Trim end" })).toBeVisible();
  await expect(page.getByText("0:00 / 0:01 final")).toBeVisible();

  const primary = page.locator('[data-video-key="trim-short-cut-fixture"] video[data-video-layer="primary"]');
  const pausedSeek = await primary.evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.pause();
    video.currentTime = 0.95;
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return video.currentTime;
  });
  expect(pausedSeek).toBeCloseTo(1, 1);

  await primary.evaluate((element) => {
    const video = element as HTMLVideoElement;
    video.pause();
    video.currentTime = 1.5;
  });
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const cutTrack = page.locator('[data-timeline-track="cut"]');
  const cutTrackBox = await cutTrack.boundingBox();
  expect(cutTrackBox).not.toBeNull();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * (1.4 / 3), cutTrackBox!.y + cutTrackBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cutTrackBox!.x + cutTrackBox!.width * (1.6 / 3), cutTrackBox!.y + cutTrackBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => primary.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(1.59);

  const trimStart = page.getByRole("separator", { name: "Trim start" });
  const trimStartBox = await trimStart.boundingBox();
  expect(trimStartBox).not.toBeNull();
  await page.mouse.move(trimStartBox!.x + trimStartBox!.width / 2, trimStartBox!.y + trimStartBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(trimStartBox!.x + trimStartBox!.width / 2 + 45, trimStartBox!.y + trimStartBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("videoflow-local-test", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<number>((resolve, reject) => {
      const request = db.transaction("videos", "readonly").objectStore("videos").get("trim-short-cut-fixture");
      request.onsuccess = () => { db.close(); resolve(request.result?.editState?.trim?.startMs ?? 0); };
      request.onerror = () => reject(request.error);
    });
  })).toBeGreaterThan(400);
});

test("an unplayable screen layer falls back to the combined recording", async ({ page }) => {
  test.setTimeout(60_000);
  await seedLayeredRecording(page, "failed-screen-layer-fixture", true);
  await page.goto("/test/videos/failed-screen-layer-fixture");

  const editor = page.locator('[data-video-key="failed-screen-layer-fixture"]');
  const primary = editor.locator("video").first();
  const player = primary.locator("..");
  await expect(page.getByText("Separate layers unavailable · showing combined recording")).toBeVisible();
  await expect(primary).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeDisabled();

  await primary.evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    video.pause();
  });
  const [combinedPixel] = await sampleScreenshot(page, await player.screenshot(), [{ x: 0.3, y: 0.24 }]);
  expectColor(combinedPixel, PRIMARY);
});
