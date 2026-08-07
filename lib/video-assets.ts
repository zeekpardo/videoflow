export const MAX_VIDEO_GRAPHIC_BYTES = 10 * 1024 * 1024;
export const VIDEO_GRAPHIC_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type VideoGraphicMimeType = (typeof VIDEO_GRAPHIC_TYPES)[number];

export function isVideoGraphicMimeType(value: string): value is VideoGraphicMimeType {
  return (VIDEO_GRAPHIC_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function validateVideoGraphicFile(file: File): File {
  if (!isVideoGraphicMimeType(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP graphic");
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("The graphic file is empty");
  }
  if (file.size > MAX_VIDEO_GRAPHIC_BYTES) {
    throw new Error("Graphics must be under 10 MB");
  }
  return file;
}

export async function readVideoGraphicDimensions(file: File) {
  validateVideoGraphicFile(file);
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("The graphic image could not be read"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
