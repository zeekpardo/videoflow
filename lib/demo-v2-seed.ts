import { defaultVideoEditState } from "@/lib/video-edits";
import type { DemoMediaStore, DemoVideo } from "@/lib/demo-video-store";
import { normalizeCaptionStyle } from "@/lib/video-v2";

export const DEMO_V2_SAMPLE_ID = "videoflow-v2-guided-sample";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create sample thumbnail")), "image/jpeg", .88));
}

function drawScene(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, progress: number) {
  const { width, height } = canvas;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#eef1ff");
  gradient.addColorStop(1, "#f8fafc");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.font = "700 34px system-ui";
  ctx.fillText("Acme product workspace", 82, 84);
  ctx.fillStyle = "#6d5bfc";
  ctx.fillRect(82, 124, 210, 52);
  ctx.fillStyle = "white";
  ctx.font = "600 20px system-ui";
  ctx.fillText("Create new project", 102, 157);
  ctx.fillStyle = "white";
  ctx.shadowColor = "rgba(15,23,42,.16)";
  ctx.shadowBlur = 28;
  ctx.fillRect(82, 214, width - 164, 420);
  ctx.shadowBlur = 0;
  const cards = ["Research", "Prototype", "Launch"];
  cards.forEach((label, index) => {
    const x = 120 + index * 350;
    ctx.fillStyle = ["#ddd6fe", "#bfdbfe", "#bbf7d0"][index];
    ctx.fillRect(x, 270, 290, 230);
    ctx.fillStyle = "#1f2937";
    ctx.font = "700 24px system-ui";
    ctx.fillText(label, x + 24, 320);
    ctx.fillStyle = "#64748b";
    ctx.font = "500 17px system-ui";
    ctx.fillText(`${index + 3} tasks`, x + 24, 354);
  });
  const cursorX = 170 + progress * 650;
  const cursorY = 160 + Math.sin(progress * Math.PI) * 240;
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.moveTo(cursorX, cursorY);
  ctx.lineTo(cursorX + 10, cursorY + 30);
  ctx.lineTo(cursorX + 17, cursorY + 19);
  ctx.lineTo(cursorX + 31, cursorY + 33);
  ctx.lineTo(cursorX + 38, cursorY + 26);
  ctx.lineTo(cursorX + 23, cursorY + 13);
  ctx.lineTo(cursorX + 38, cursorY + 8);
  ctx.closePath();
  ctx.fill();
}

async function createSampleMedia() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.captureStream || typeof MediaRecorder === "undefined") throw new Error("This browser cannot create the guided sample");
  drawScene(ctx, canvas, 0);
  const thumbnailBlob = await canvasBlob(canvas);
  const stream = canvas.captureStream(24);
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1.42E01E", "video/mp4"];
  const type = typeof MediaRecorder.isTypeSupported === "function"
    ? candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ""
    : "video/mp4";
  if (!type) throw new Error("This browser cannot encode the guided sample");
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Could not create the guided sample"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || type }));
  });
  recorder.start(250);
  const started = performance.now();
  const durationMs = 3_600;
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      drawScene(ctx, canvas, progress);
      if (progress < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  return { videoBlob: await stopped, thumbnailBlob, durationMs };
}

export async function ensureDemoV2Sample(store: DemoMediaStore): Promise<DemoVideo> {
  const existing = await store.getVideo(DEMO_V2_SAMPLE_ID);
  if (existing) return existing;
  const media = await createSampleMedia();
  const editState = defaultVideoEditState("screen");
  editState.interactions.clicks = [
    { id: "sample-click-1", startMs: 700, endMs: 1_100, x: .2, y: .22, color: "#6d5bfc", size: 52 },
    { id: "sample-click-2", startMs: 2_050, endMs: 2_450, x: .64, y: .48, color: "#6d5bfc", size: 52 },
  ];
  return store.saveVideo({
    id: DEMO_V2_SAMPLE_ID,
    title: "Guided V2 product demo",
    description: "A safe sample project for trying Magic Polish, captions, Smart Focus, interactive chapters, templates, and publishing.",
    createdAt: Date.now(),
    durationMs: media.durationMs,
    mode: "screen",
    mimeType: media.videoBlob.type,
    sizeBytes: media.videoBlob.size,
    width: 1280,
    height: 720,
    videoBlob: media.videoBlob,
    thumbnailBlob: media.thumbnailBlob,
    editState,
    captionTrack: {
      language: "en",
      revision: 1,
      style: { ...normalizeCaptionStyle(), preset: "karaoke" },
      cues: [
        { id: "sample-caption-1", startMs: 150, endMs: 1_700, text: "Create a polished product walkthrough." },
        { id: "sample-caption-2", startMs: 1_700, endMs: 3_450, text: "Then publish an interactive video." },
      ],
    },
    interactiveElements: [
      { id: "sample-chapter", kind: "chapter", startMs: 0, endMs: 500, label: "Workspace overview" },
      { id: "sample-cta", kind: "cta", startMs: 2_350, endMs: 3_450, label: "Explore the product", url: "https://example.com" },
    ],
    templateName: "Product demo",
  });
}
