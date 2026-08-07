const WIDTH = 1280;
const HEIGHT = 720;
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create thumbnail")), "image/jpeg", quality);
  });
}

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  ctx.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error("Wait for the video preview to load");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Thumbnail creation is unavailable in this browser");
  ctx.fillStyle = "#0b0d14";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawCover(ctx, video, video.videoWidth || WIDTH, video.videoHeight || HEIGHT, 0, 0, WIDTH, HEIGHT);
  return canvasBlob(canvas);
}

export async function captureVideoFrameAt(video: HTMLVideoElement, timestampMs: number): Promise<Blob> {
  if (!Number.isFinite(video.duration)) throw new Error("Wait for the video preview to load");
  const wasPaused = video.paused;
  const previousTime = video.currentTime;
  const target = Math.min(Math.max(0, timestampMs / 1_000), Math.max(0, video.duration - 0.05));
  video.pause();
  try {
    if (Math.abs(video.currentTime - target) > 0.03) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Frame capture timed out")), 8_000);
        const finish = () => { window.clearTimeout(timeout); resolve(); };
        video.addEventListener("seeked", finish, { once: true });
        video.currentTime = target;
      });
    }
    return await captureVideoFrame(video);
  } finally {
    video.currentTime = previousTime;
    if (!wasPaused) void video.play().catch(() => undefined);
  }
}

export async function captureVideoBlobFrame(videoBlob: Blob, durationMs: number): Promise<Blob> {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Thumbnail preview timed out")), 8_000);
      video.onloadedmetadata = () => {
        const target = Math.min(Math.max(0.15, durationMs / 1000 * 0.2), Math.max(0, video.duration - 0.05));
        const safeTarget = Number.isFinite(target) ? target : 0;
        if (safeTarget <= 0.01) {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { window.clearTimeout(timeout); resolve(); }
          else video.onloadeddata = () => { window.clearTimeout(timeout); resolve(); };
        } else video.currentTime = safeTarget;
      };
      video.onseeked = () => { window.clearTimeout(timeout); resolve(); };
      video.onerror = () => { window.clearTimeout(timeout); reject(new Error("Could not read a frame from this recording")); };
    });
    return await captureVideoFrame(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function captureVideoBlobFrameAt(videoBlob: Blob, timestampMs: number): Promise<Blob> {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Frame capture timed out")), 8_000);
      video.onloadedmetadata = () => {
        const target = Math.min(Math.max(0, timestampMs / 1_000), Math.max(0, video.duration - 0.05));
        if (target <= 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { window.clearTimeout(timeout); resolve(); }
        else video.currentTime = target;
      };
      video.onseeked = () => { window.clearTimeout(timeout); resolve(); };
      video.onerror = () => { window.clearTimeout(timeout); reject(new Error("Could not read a frame from this recording")); };
    });
    return await captureVideoFrame(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function wrapTitle(ctx: CanvasRenderingContext2D, title: string, maxWidth: number) {
  const words = (title.trim() || "Untitled video").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
    if (lines.length === 3) break;
  }
  if (line && lines.length < 4) lines.push(line);
  return lines.slice(0, 4);
}

export async function generateTitleThumbnail(frame: Blob, title: string, accent = "#6d5bfc"): Promise<Blob> {
  const image = await createImageBitmap(frame);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Thumbnail creation is unavailable in this browser");

    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, "#111529");
    gradient.addColorStop(0.58, accent);
    gradient.addColorStop(1, "#a69bff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.shadowColor = "rgba(4,7,20,.42)";
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 18;
    ctx.beginPath();
    ctx.roundRect(480, 82, 730, 556, 28);
    ctx.clip();
    drawCover(ctx, image, image.width, image.height, 480, 82, 730, 556);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.font = "700 22px Arial, sans-serif";
    ctx.fillText("VIDEO", 72, 108);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 58px Arial, sans-serif";
    const lines = wrapTitle(ctx, title, 340);
    lines.forEach((line, index) => ctx.fillText(line, 72, 222 + index * 68));
    ctx.fillStyle = "rgba(255,255,255,.76)";
    ctx.font = "500 22px Arial, sans-serif";
    ctx.fillText("Watch the recording", 72, 620);
    return canvasBlob(canvas, 0.9);
  } finally {
    image.close();
  }
}

export function validateThumbnailFile(file: File): Blob {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, or WebP image");
  if (file.size > MAX_THUMBNAIL_BYTES) throw new Error("Thumbnail images must be under 10 MB");
  return file;
}
