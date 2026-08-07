import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const DEMO_ANALYTICS_EVENTS = [
  "code_requested", "code_request_failed", "verification_failed", "demo_verified", "page_viewed", "heartbeat", "ui_clicked", "purchase_clicked",
  "recording_setup_opened", "recording_devices_ready", "recording_started", "recording_paused", "recording_resumed",
  "recording_stopped", "recording_saved", "recording_deleted", "recording_failed", "library_viewed", "video_opened",
  "editor_opened", "editor_saved", "graphic_uploaded", "thumbnail_updated", "export_started", "export_completed",
  "export_failed", "demo_expired",
  "ai_transcription_completed", "ai_generation_completed",
] as const;

export type DemoAnalyticsEventName = typeof DEMO_ANALYTICS_EVENTS[number];
const eventSet = new Set<string>(DEMO_ANALYTICS_EVENTS);
const ingest = makeFunctionReference<"mutation">("videoFlowDemoAnalytics:ingest");

export function isDemoAnalyticsEvent(value: unknown): value is DemoAnalyticsEventName {
  return typeof value === "string" && eventSet.has(value);
}

function cleanString(value: unknown, max = 200) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : undefined;
}

export function sanitizeDemoAnalyticsProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = rawKey.replace(/[^a-z0-9_]/gi, "").slice(0, 40);
    if (!key) continue;
    if (typeof rawValue === "string") result[key] = cleanString(rawValue, 240) ?? "";
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) result[key] = Math.max(-1_000_000_000, Math.min(1_000_000_000, rawValue));
    else if (typeof rawValue === "boolean" || rawValue === null) result[key] = rawValue;
  }
  return Object.keys(result).length ? result : undefined;
}

export interface DemoAnalyticsInput {
  eventId?: string;
  eventName: DemoAnalyticsEventName;
  sessionId: string;
  visitorId: string;
  emailHash?: string;
  email?: string;
  name?: string;
  marketingConsent?: boolean;
  demoStartedAt?: number;
  demoExpiresAt?: number;
  occurredAt?: number;
  path?: string;
  properties?: unknown;
  engagedMs?: number;
  entryPath?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  country?: string;
  region?: string;
  city?: string;
}

export async function sendDemoAnalytics(input: DemoAnalyticsInput) {
  const url = process.env.DEVLAUNCH_CONVEX_URL;
  const ingestToken = process.env.VIDEOFLOW_DEMO_INGEST_TOKEN;
  if (!url || !ingestToken || ingestToken.length < 32) return false;
  try {
    const client = new ConvexHttpClient(url);
    await client.mutation(ingest, {
      ingestToken,
      eventId: input.eventId || crypto.randomUUID(),
      eventName: input.eventName,
      sessionId: cleanString(input.sessionId, 256) || "unknown-session",
      visitorId: cleanString(input.visitorId, 100) || "unknown-visitor",
      emailHash: cleanString(input.emailHash, 128), email: cleanString(input.email, 254), name: cleanString(input.name, 120),
      marketingConsent: input.marketingConsent, demoStartedAt: input.demoStartedAt, demoExpiresAt: input.demoExpiresAt,
      occurredAt: Number.isFinite(input.occurredAt) ? input.occurredAt! : Date.now(), path: cleanString(input.path, 300) || "/demo",
      properties: sanitizeDemoAnalyticsProperties(input.properties), engagedMs: Number.isFinite(input.engagedMs) ? Math.max(0, input.engagedMs!) : undefined,
      entryPath: cleanString(input.entryPath, 300), source: cleanString(input.source, 100), medium: cleanString(input.medium, 100),
      campaign: cleanString(input.campaign, 160), referrer: cleanString(input.referrer, 300), deviceType: cleanString(input.deviceType, 40),
      browser: cleanString(input.browser, 80), os: cleanString(input.os, 80), country: cleanString(input.country, 80),
      region: cleanString(input.region, 80), city: cleanString(input.city, 80),
    });
    return true;
  } catch {
    // Analytics must never interrupt verification, recording, or editing.
    return false;
  }
}
