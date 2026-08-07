import { describe, expect, it } from "vitest";
import {
  MAX_GRAPHIC_ASSET_BYTES,
  normalizeGraphicAssetMetadata,
  referencedGraphicAssetIds,
} from "@/lib/graphic-assets";

describe("graphic asset validation", () => {
  it("accepts only bounded PNG, JPEG, and WebP metadata", () => {
    expect(normalizeGraphicAssetMetadata({
      assetId: "asset-1",
      mimeType: " IMAGE/JPEG; charset=binary ",
      sizeBytes: MAX_GRAPHIC_ASSET_BYTES,
      width: 1920,
      height: 1080,
    })).toEqual({
      assetId: "asset-1",
      mimeType: "image/jpeg",
      sizeBytes: MAX_GRAPHIC_ASSET_BYTES,
      width: 1920,
      height: 1080,
    });
    expect(() => normalizeGraphicAssetMetadata({ assetId: "asset", mimeType: "image/svg+xml", sizeBytes: 10, width: 100, height: 100 })).toThrow("PNG, JPG, or WebP");
    expect(() => normalizeGraphicAssetMetadata({ assetId: "asset", mimeType: "image/png", sizeBytes: MAX_GRAPHIC_ASSET_BYTES + 1, width: 100, height: 100 })).toThrow("under 10 MB");
    expect(() => normalizeGraphicAssetMetadata({ assetId: "asset", mimeType: "image/png", sizeBytes: 10, width: 20_000, height: 100 })).toThrow("dimensions");
  });

  it("returns only valid image asset IDs referenced by v2 objects", () => {
    expect([...referencedGraphicAssetIds({
      version: 2,
      objects: [
        { kind: "image", assetId: "used_asset" },
        { kind: "image", assetId: "used_asset" },
        { kind: "rectangle", assetId: "not-an-image" },
        { kind: "image", assetId: "bad id!" },
      ],
    })]).toEqual(["used_asset"]);
    expect(referencedGraphicAssetIds({ version: 1, objects: [{ kind: "image", assetId: "legacy" }] }).size).toBe(0);
  });
});
