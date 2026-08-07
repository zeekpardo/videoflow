import { readFile, stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("the shared editor renders a playable edited WebM", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/test");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    const canvasStream = canvas.captureStream(30);
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const audioDestination = audioContext.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.03;
    oscillator.connect(gain).connect(audioDestination);
    await audioContext.resume();
    oscillator.start();
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((candidate) => MediaRecorder.isTypeSupported(candidate))!;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Fixture recording failed"));
    });
    recorder.start(100);
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (now: number) => {
        const elapsed = now - startedAt;
        const hue = Math.round((elapsed / 1_400) * 280);
        context.fillStyle = `hsl(${hue} 75% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.font = "700 46px sans-serif";
        context.fillText("VideoFlow export", 115, 195);
        if (elapsed >= 1_400) resolve();
        else requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    recorder.stop();
    await stopped;
    oscillator.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    const blob = new Blob(chunks, { type: mimeType });

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
        id: "edited-export-fixture",
        title: "Rendered product tour",
        createdAt: Date.now(),
        durationMs: 1_400,
        mode: "screen",
        mimeType,
        sizeBytes: blob.size,
        videoBlob: blob,
        views: [],
        comments: [],
        reactions: [],
        zoomEffects: [{ id: "zoom-export", startMs: 300, endMs: 1_100, x: 0.5, y: 0.5, scale: 1.4 }],
        editState: {
          version: 2,
          trim: { startMs: 100, endMs: 1_300 },
          cuts: [{ id: "cut-export", startMs: 650, endMs: 850 }],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 16 },
          textOverlays: [{ id: "text-export", startMs: 100, endMs: 600, text: "Edited in browser", x: 0.5, y: 0.2, fontSize: 42, color: "#ffffff", background: "#111827cc" }],
          audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
          objects: [],
          interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
        },
      });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });

  await page.goto("/test/videos/edited-export-fixture");
  await expect(page.getByLabel("Video edit timeline")).toBeVisible();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const fullResolution = page.getByRole("radio", { name: /Full resolution/ });
  const resolution720p = page.getByRole("radio", { name: /720p/ });
  await expect(fullResolution).toBeChecked();
  await expect(page.getByRole("radio", { name: /1080p/ })).toBeVisible();
  await resolution720p.click();
  await expect(resolution720p).toBeChecked();
  await fullResolution.click();
  await expect(fullResolution).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Edited WebM/ }).click();
  await expect(page.getByRole("progressbar", { name: "Edited video export progress" })).toBeVisible();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Rendered-product-tour-edited.webm");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect((await stat(path!)).size).toBeGreaterThan(2_000);

  const base64 = (await readFile(path!)).toString("base64");
  const metadata = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    const result = await new Promise<{ duration: number; width: number; height: number; audioTracks: number }>((resolve, reject) => {
      video.onloadedmetadata = () => {
        const captured = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, audioTracks: captured?.getAudioTracks().length ?? 0 });
      };
      video.onerror = () => reject(new Error("Downloaded edited WebM is not playable"));
    });
    URL.revokeObjectURL(url);
    return result;
  }, base64);
  expect(metadata.width).toBe(640);
  expect(metadata.height).toBe(360);
  expect(metadata.audioTracks).toBe(1);
  // 1.4s source - 0.1s trim-in - 0.1s trim-out - 0.2s cut = 1.0s.
  // These bounds reject both an untrimmed and an uncut export.
  expect(metadata.duration).toBeGreaterThan(0.92);
  expect(metadata.duration).toBeLessThan(1.12);
});
