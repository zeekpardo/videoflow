import { afterEach, describe, expect, it } from "vitest";
import { isDemoAnalyticsEvent, sanitizeDemoAnalyticsProperties, sendDemoAnalytics } from "@/lib/demo-analytics-server";

const originalUrl = process.env.DEVLAUNCH_CONVEX_URL;
const originalToken = process.env.VIDEOFLOW_DEMO_INGEST_TOKEN;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.DEVLAUNCH_CONVEX_URL; else process.env.DEVLAUNCH_CONVEX_URL = originalUrl;
  if (originalToken === undefined) delete process.env.VIDEOFLOW_DEMO_INGEST_TOKEN; else process.env.VIDEOFLOW_DEMO_INGEST_TOKEN = originalToken;
});

describe("demo analytics boundary", () => {
  it("accepts only the product event allow-list", () => {
    expect(isDemoAnalyticsEvent("recording_saved")).toBe(true);
    expect(isDemoAnalyticsEvent("purchase_clicked")).toBe(true);
    expect(isDemoAnalyticsEvent("arbitrary_event")).toBe(false);
  });

  it("keeps only flat, bounded primitive properties", () => {
    expect(sanitizeDemoAnalyticsProperties({
      mode: "screen_camera",
      durationMs: 1234,
      successful: true,
      nested: { secret: "discarded" },
      list: ["discarded"],
      "bad key!": "kept under a safe key",
    })).toEqual({ mode: "screen_camera", durationMs: 1234, successful: true, badkey: "kept under a safe key" });
  });

  it("is non-blocking when the seller analytics connection is not configured", async () => {
    delete process.env.DEVLAUNCH_CONVEX_URL;
    delete process.env.VIDEOFLOW_DEMO_INGEST_TOKEN;
    await expect(sendDemoAnalytics({ eventName: "page_viewed", sessionId: "session-123", visitorId: "visitor-123" })).resolves.toBe(false);
  });
});
