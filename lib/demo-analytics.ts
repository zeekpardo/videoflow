"use client";

import type { DemoAnalyticsEventName } from "@/lib/demo-analytics-server";

const VISITOR_KEY = "videoflow-demo-analytics-visitor";
const START_KEY = "videoflow-demo-analytics-start";

export function demoAnalyticsVisitorId() {
  let value = localStorage.getItem(VISITOR_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, value);
  }
  return value;
}

export function demoAnalyticsContext() {
  const params = new URLSearchParams(location.search);
  const ua = navigator.userAgent;
  return {
    visitorId: demoAnalyticsVisitorId(),
    entryPath: sessionStorage.getItem(START_KEY) || `${location.pathname}${location.search}`,
    source: params.get("utm_source") || undefined,
    medium: params.get("utm_medium") || undefined,
    campaign: params.get("utm_campaign") || undefined,
    referrer: document.referrer || undefined,
    deviceType: /Mobi|Android/i.test(ua) ? "mobile" : /iPad|Tablet/i.test(ua) ? "tablet" : "desktop",
    browser: /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other",
    os: /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "Other",
  };
}

export function trackDemoEvent(eventName: DemoAnalyticsEventName, properties?: Record<string, string | number | boolean | null>) {
  if (typeof window === "undefined") return;
  const context = demoAnalyticsContext();
  const started = Number(sessionStorage.getItem(START_KEY + ":at") || Date.now());
  const body = JSON.stringify({
    eventId: crypto.randomUUID(), eventName, occurredAt: Date.now(), path: `${location.pathname}${location.search}`,
    properties, engagedMs: Math.max(0, Date.now() - started), ...context,
  });
  void fetch("/api/demo/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}
