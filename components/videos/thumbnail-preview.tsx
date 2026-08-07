"use client";

import { stableObjectUrl } from "@/lib/stable-object-url";

export function ThumbnailPreview({ blob, className = "h-16 w-28" }: { blob: Blob; className?: string }) {
  const url = stableObjectUrl(blob);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="Selected thumbnail preview" className={`${className} rounded-lg object-cover shadow-sm`} />
  );
}
