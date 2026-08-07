import type {
  VideoClickOverlay,
  VideoEditStateV2,
  VideoKeyOverlay,
  VideoObjectOverlay,
} from "@/lib/video-edits";

export type VideoGraphicSources = Readonly<Record<string, CanvasImageSource | undefined>>;

export function activeVideoObjects(objects: readonly VideoObjectOverlay[], sourceTimeMs: number) {
  return objects
    .filter((item) => sourceTimeMs >= item.startMs && sourceTimeMs < item.endMs)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}

export function activeVideoClicks(clicks: readonly VideoClickOverlay[], sourceTimeMs: number) {
  return clicks.filter((item) => sourceTimeMs >= item.startMs && sourceTimeMs < item.endMs);
}

export function activeVideoKeys(keys: readonly VideoKeyOverlay[], sourceTimeMs: number) {
  return keys.filter((item) => sourceTimeMs >= item.startMs && sourceTimeMs < item.endMs);
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
      if (lines.length >= 7) break;
    }
    if (lines.length >= 7) break;
    lines.push(line || " ");
  }
  return lines.slice(0, 8);
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  item: VideoObjectOverlay,
  width: number,
  height: number,
  graphics: VideoGraphicSources,
) {
  const objectWidth = Math.max(2, item.width * width);
  const objectHeight = Math.max(2, item.height * height);
  const strokeWidth = Math.max(0, item.strokeWidth * Math.min(width, height) / 1_080);
  ctx.save();
  ctx.globalAlpha = item.opacity;
  ctx.translate(item.x * width, item.y * height);
  ctx.rotate(item.rotation * Math.PI / 180);
  ctx.fillStyle = item.fill;
  ctx.strokeStyle = item.stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (item.kind === "rectangle" || item.kind === "callout") {
    roundedRectPath(ctx, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight, Math.min(objectWidth, objectHeight) * 0.12);
    if (item.fill !== "transparent") ctx.fill();
    if (strokeWidth > 0 && item.stroke !== "transparent") ctx.stroke();
    if (item.kind === "callout") {
      ctx.beginPath();
      ctx.moveTo(objectWidth * 0.18, objectHeight / 2 - strokeWidth / 2);
      ctx.lineTo(objectWidth * 0.38, objectHeight * 0.72);
      ctx.lineTo(objectWidth * 0.42, objectHeight / 2 - strokeWidth / 2);
      ctx.closePath();
      if (item.fill !== "transparent") ctx.fill();
      if (strokeWidth > 0 && item.stroke !== "transparent") ctx.stroke();
    }
  } else if (item.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(0, 0, objectWidth / 2, objectHeight / 2, 0, 0, Math.PI * 2);
    if (item.fill !== "transparent") ctx.fill();
    if (strokeWidth > 0 && item.stroke !== "transparent") ctx.stroke();
  } else if (item.kind === "arrow") {
    const endX = objectWidth / 2;
    const head = Math.max(10, Math.min(objectWidth * 0.24, objectHeight * 0.65));
    ctx.beginPath();
    ctx.moveTo(-objectWidth / 2, 0);
    ctx.lineTo(endX, 0);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX - head, -head * 0.62);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX - head, head * 0.62);
    ctx.lineWidth = Math.max(strokeWidth, Math.min(width, height) * 0.006);
    ctx.strokeStyle = item.stroke === "transparent" ? item.fill : item.stroke;
    ctx.stroke();
  } else if (item.kind === "image" && item.assetId) {
    const graphic = graphics[item.assetId];
    if (graphic) ctx.drawImage(graphic, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight);
  }

  if (item.text && (item.kind === "callout" || item.kind === "rectangle" || item.kind === "ellipse")) {
    const fontSize = Math.max(10, (item.fontSize ?? 32) * width / 1_280);
    ctx.fillStyle = item.textColor ?? "#ffffff";
    ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrapText(ctx, item.text, objectWidth * 0.8);
    const lineHeight = fontSize * 1.16;
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight, objectWidth * 0.86);
    });
  }
  ctx.restore();
}

function drawClick(ctx: CanvasRenderingContext2D, item: VideoClickOverlay, sourceTimeMs: number, width: number, height: number) {
  const progress = Math.min(1, Math.max(0, (sourceTimeMs - item.startMs) / Math.max(1, item.endMs - item.startMs)));
  const base = item.size * Math.min(width, height) / 1_080;
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = Math.max(2, base * 0.08);
  ctx.globalAlpha = 1 - progress * 0.8;
  ctx.beginPath();
  ctx.arc(item.x * width, item.y * height, Math.max(3, base * (0.35 + progress * 0.65)), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = Math.max(0, 0.55 - progress * 0.55);
  ctx.beginPath();
  ctx.arc(item.x * width, item.y * height, Math.max(2, base * 0.2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawKey(ctx: CanvasRenderingContext2D, item: VideoKeyOverlay, width: number, height: number) {
  const fontSize = Math.max(12, width / 48);
  ctx.save();
  ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const boxWidth = Math.min(width * 0.62, Math.max(fontSize * 2.3, ctx.measureText(item.label).width + fontSize * 1.3));
  const boxHeight = fontSize * 2.05;
  const x = item.x * width - boxWidth / 2;
  const y = item.y * height - boxHeight / 2;
  ctx.fillStyle = "#0f172ee6";
  ctx.strokeStyle = "#ffffff66";
  ctx.lineWidth = Math.max(1, width / 1_280);
  roundedRectPath(ctx, x, y, boxWidth, boxHeight, fontSize * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(item.label, item.x * width, item.y * height);
  ctx.restore();
}

/** Draws timed objects and manual interaction badges in final z-order. */
export function drawVideoOverlays(
  ctx: CanvasRenderingContext2D,
  editState: VideoEditStateV2,
  sourceTimeMs: number,
  width: number,
  height: number,
  graphics: VideoGraphicSources = {},
) {
  for (const item of activeVideoObjects(editState.objects, sourceTimeMs)) {
    drawObject(ctx, item, width, height, graphics);
  }
  if (editState.interactions.clicksEnabled) {
    for (const click of activeVideoClicks(editState.interactions.clicks, sourceTimeMs)) drawClick(ctx, click, sourceTimeMs, width, height);
  }
  if (editState.interactions.keysEnabled) {
    for (const key of activeVideoKeys(editState.interactions.keys, sourceTimeMs)) drawKey(ctx, key, width, height);
  }
}
