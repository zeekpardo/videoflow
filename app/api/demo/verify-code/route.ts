import { makeFunctionReference } from "convex/server";
import { after, NextRequest, NextResponse } from "next/server";
import { assertDemoPost, demoApiError, demoConvexClient, demoIngestToken, demoModeEnabled, demoNotFound, demoRateKey } from "@/lib/demo-api";
import {
  DEMO_ACCESS_COOKIE,
  signDemoAccessSession,
  type DemoAccessSession,
} from "@/lib/demo-access-session";
import { sendDemoAnalytics } from "@/lib/demo-analytics-server";
import { sendDemoEntryNotification } from "@/lib/demo-entry-notification";

export const runtime = "nodejs";

const verifyCode = makeFunctionReference<"action", {
  ingestToken: string; challengeToken: string; code: string; rateKey: string;
}, {
  sessionId: string; emailHash: string; name: string; email: string; marketingConsent: boolean;
  demoStartedAt: number; demoExpiresAt: number;
}>("videoFlowDemoAccess:verifyCode");

export async function POST(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  let analyticsContext: Record<string, unknown> = {};
  try {
    assertDemoPost(request);
    const body = await request.json() as Record<string, unknown>;
    analyticsContext = body.analytics && typeof body.analytics === "object" ? body.analytics as Record<string, unknown> : {};
    const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken.trim() : "";
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
    if (challengeToken.length < 16 || challengeToken.length > 256) throw new Error("Request a new access code");
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your email");

    const verified = await demoConvexClient().action(verifyCode, {
      ingestToken: demoIngestToken(),
      challengeToken,
      code,
      rateKey: demoRateKey(request),
    });
    const session: DemoAccessSession = {
      version: 1,
      sessionId: verified.sessionId,
      emailHash: verified.emailHash,
      name: verified.name,
      startedAt: verified.demoStartedAt,
      expiresAt: verified.demoExpiresAt,
    };
    const secret = process.env.DEMO_SESSION_SECRET;
    if (!secret) throw new Error("The demo session secret is not configured");

    const analytics = analyticsContext;
    const visitorId = typeof analytics.visitorId === "string" ? analytics.visitorId.slice(0, 100) : crypto.randomUUID();
    await sendDemoAnalytics({
      eventName: "demo_verified", sessionId: session.sessionId, visitorId, emailHash: session.emailHash,
      email: verified.email, name: verified.name, marketingConsent: verified.marketingConsent,
      demoStartedAt: session.startedAt, demoExpiresAt: session.expiresAt, path: "/demo/access",
      entryPath: typeof analytics.entryPath === "string" ? analytics.entryPath : undefined,
      source: typeof analytics.source === "string" ? analytics.source : undefined,
      medium: typeof analytics.medium === "string" ? analytics.medium : undefined,
      campaign: typeof analytics.campaign === "string" ? analytics.campaign : undefined,
      referrer: typeof analytics.referrer === "string" ? analytics.referrer : undefined,
      deviceType: typeof analytics.deviceType === "string" ? analytics.deviceType : undefined,
      browser: typeof analytics.browser === "string" ? analytics.browser : undefined,
      os: typeof analytics.os === "string" ? analytics.os : undefined,
      country: request.headers.get("x-vercel-ip-country") || undefined,
      region: request.headers.get("x-vercel-ip-country-region") || undefined,
      city: request.headers.get("x-vercel-ip-city") || undefined,
    });

    after(async () => {
      await sendDemoEntryNotification({
        name: verified.name,
        email: verified.email,
        enteredAt: session.startedAt,
        city: request.headers.get("x-vercel-ip-city") || undefined,
        region: request.headers.get("x-vercel-ip-country-region") || undefined,
        country: request.headers.get("x-vercel-ip-country") || undefined,
        source: typeof analytics.source === "string" ? analytics.source : undefined,
        deviceType: typeof analytics.deviceType === "string" ? analytics.deviceType : undefined,
        browser: typeof analytics.browser === "string" ? analytics.browser : undefined,
        os: typeof analytics.os === "string" ? analytics.os : undefined,
      });
    });

    const response = NextResponse.json({ ok: true, expiresAt: session.expiresAt, redirectTo: "/demo" });
    response.cookies.set(DEMO_ACCESS_COOKIE, signDemoAccessSession(session, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Do not create unauthenticated analytics writes for failed verification
    // requests. Attackers can choose arbitrary visitor IDs; the access ledger
    // already records and caps guesses against the opaque challenge token.
    return demoApiError(error, "That code could not be verified. Please try again.");
  }
}
