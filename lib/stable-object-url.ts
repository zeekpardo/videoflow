const urls = new WeakMap<Blob, string>();
const keyedUrls = new Map<string, string>();

/**
 * Object URLs are scoped to the current page, so the browser releases them on
 * navigation. Caching by Blob avoids React development-mode effect cleanup
 * revoking a URL that a mounted media element is still using. A stable key is
 * useful for immutable IndexedDB media because reads return new Blob objects.
 */
export function stableObjectUrl(blob: Blob | null | undefined, stableKey?: string) {
  if (!blob || typeof window === "undefined") return "";
  if (stableKey) {
    const keyed = keyedUrls.get(stableKey);
    if (keyed) return keyed;
    const url = window.URL.createObjectURL(blob);
    keyedUrls.set(stableKey, url);
    return url;
  }
  const existing = urls.get(blob);
  if (existing) return existing;
  const url = window.URL.createObjectURL(blob);
  urls.set(blob, url);
  return url;
}
