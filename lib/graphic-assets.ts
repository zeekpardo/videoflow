export const MAX_GRAPHIC_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_GRAPHIC_ASSET_DIMENSION = 8_192;
export const MAX_GRAPHIC_ASSET_PIXELS = 40_000_000;
export const MAX_GRAPHIC_ASSETS_PER_VIDEO = 50;

const GRAPHIC_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface GraphicAssetMetadataInput {
  assetId: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface GraphicAssetMetadata {
  assetId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
}

export function normalizeGraphicAssetId(value: string) {
  const assetId = value.trim();
  if (!ASSET_ID.test(assetId)) throw new Error("Graphic asset ID is invalid");
  return assetId;
}

export function normalizeGraphicAssetMetadata(input: GraphicAssetMetadataInput): GraphicAssetMetadata {
  const assetId = normalizeGraphicAssetId(input.assetId);
  const mimeType = input.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (!GRAPHIC_MIME_TYPES.has(mimeType)) throw new Error("Graphic must be a PNG, JPG, or WebP image");
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_GRAPHIC_ASSET_BYTES) {
    throw new Error("Graphic must be under 10 MB");
  }
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.width > MAX_GRAPHIC_ASSET_DIMENSION ||
    input.height > MAX_GRAPHIC_ASSET_DIMENSION ||
    input.width * input.height > MAX_GRAPHIC_ASSET_PIXELS
  ) {
    throw new Error("Graphic dimensions are invalid or too large");
  }
  return {
    assetId,
    mimeType: mimeType as GraphicAssetMetadata["mimeType"],
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
  };
}

/** Only image objects referenced by the saved v2 project may reach viewers. */
export function referencedGraphicAssetIds(editState: unknown): Set<string> {
  if (!editState || typeof editState !== "object") return new Set();
  const value = editState as { version?: unknown; objects?: unknown };
  if (value.version !== 2 || !Array.isArray(value.objects)) return new Set();
  const ids = new Set<string>();
  for (const item of value.objects) {
    if (!item || typeof item !== "object") continue;
    const object = item as { kind?: unknown; assetId?: unknown };
    if (object.kind !== "image" || typeof object.assetId !== "string") continue;
    const assetId = object.assetId.trim();
    if (ASSET_ID.test(assetId)) ids.add(assetId);
  }
  return ids;
}
