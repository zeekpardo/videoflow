"use client";

import { useSyncExternalStore } from "react";
import { appConfig } from "@/lib/config";

const subscribe = () => () => {};
const configuredOrigin = appConfig.url.replace(/\/$/, "");

/**
 * Returns the active browser origin without rendering a different value during
 * server hydration. The origin itself is immutable for the lifetime of a page.
 */
export function useBrowserOrigin() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => configuredOrigin,
  );
}
