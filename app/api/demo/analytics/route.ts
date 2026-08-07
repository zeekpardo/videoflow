import { NextRequest, NextResponse } from "next/server";
import { assertDemoPost, demoModeEnabled, demoNotFound } from "@/lib/demo-api";
import { getDemoAccessSession } from "@/lib/demo-access-session";
import { isDemoAnalyticsEvent, sanitizeDemoAnalyticsProperties, sendDemoAnalytics } from "@/lib/demo-analytics-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  try {
    assertDemoPost(request);
    const session = await getDemoAccessSession();
    if (!session) return NextResponse.json({ error: "Demo access expired" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const body = await request.json() as Record<string, unknown>;
    if (!isDemoAnalyticsEvent(body.eventName)) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 100) : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.slice(0, 100) : "";
    if (visitorId.length < 8 || eventId.length < 8) return NextResponse.json({ error: "Invalid event identity" }, { status: 400 });
    await sendDemoAnalytics({
      eventId, eventName: body.eventName, sessionId: session.sessionId, visitorId, emailHash: session.emailHash,
      name: session.name, demoStartedAt: session.startedAt, demoExpiresAt: session.expiresAt,
      occurredAt: typeof body.occurredAt === "number" ? body.occurredAt : Date.now(),
      path: typeof body.path === "string" ? body.path : "/demo",
      properties: sanitizeDemoAnalyticsProperties(body.properties),
      engagedMs: typeof body.engagedMs === "number" ? body.engagedMs : undefined,
      entryPath: typeof body.entryPath === "string" ? body.entryPath : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      medium: typeof body.medium === "string" ? body.medium : undefined,
      campaign: typeof body.campaign === "string" ? body.campaign : undefined,
      referrer: typeof body.referrer === "string" ? body.referrer : undefined,
      deviceType: typeof body.deviceType === "string" ? body.deviceType : undefined,
      browser: typeof body.browser === "string" ? body.browser : undefined,
      os: typeof body.os === "string" ? body.os : undefined,
      country: request.headers.get("x-vercel-ip-country") || undefined,
      region: request.headers.get("x-vercel-ip-country-region") || undefined,
      city: request.headers.get("x-vercel-ip-city") || undefined,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Invalid analytics request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
