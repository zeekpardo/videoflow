import { makeFunctionReference } from "convex/server";
import {
  demoApiError,
  assertDemoPost,
  demoConvexClient,
  demoIngestToken,
  demoModeEnabled,
  demoNotFound,
  demoPrivacyUrl,
  demoRateKey,
  DEMO_TERMS_VERSION,
  normalizeDemoEmail,
  normalizeDemoName,
  validateDemoTurnstile,
} from "@/lib/demo-api";
import { NextRequest, NextResponse } from "next/server";
import { sendDemoAnalytics } from "@/lib/demo-analytics-server";

export const runtime = "nodejs";

const requestCode = makeFunctionReference<"action", {
  ingestToken: string; name: string; email: string; rateKey: string; source: string;
  tags: string[]; termsVersion: string; marketingConsent: boolean;
}, { challengeToken: string; expiresAt: number; resendAvailableAt: number }>("videoFlowDemoAccess:requestCode");

export async function POST(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  let analyticsContext: Record<string, unknown> = {};
  let securityCheckPassed = false;
  try {
    assertDemoPost(request);
    const body = await request.json() as Record<string, unknown>;
    analyticsContext = body.analytics && typeof body.analytics === "object" ? body.analytics as Record<string, unknown> : {};
    if (body.website) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    if (body.acceptedTerms !== true) throw new Error("Please accept the demo terms and privacy notice");
    demoPrivacyUrl();
    const marketingConsent = body.marketingConsent === true;
    await validateDemoTurnstile(request, body.turnstileToken);
    securityCheckPassed = true;

    const result = await demoConvexClient().action(requestCode, {
      ingestToken: demoIngestToken(),
      name: normalizeDemoName(body.name),
      email: normalizeDemoEmail(body.email),
      rateKey: demoRateKey(request),
      source: "videoflow-sales-demo",
      tags: ["videoflow-demo", "email-verified", "sales-lead", marketingConsent ? "marketing-opt-in" : "marketing-opt-out"],
      termsVersion: DEMO_TERMS_VERSION,
      marketingConsent,
    });

    const analytics = analyticsContext;
    const visitorId = typeof analytics.visitorId === "string" ? analytics.visitorId.slice(0, 100) : crypto.randomUUID();
    await sendDemoAnalytics({
      eventName: "code_requested", sessionId: `pre:${visitorId}`, visitorId, path: "/demo/access",
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
      properties: { marketingConsent },
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const visitorId = typeof analyticsContext.visitorId === "string" ? analyticsContext.visitorId.slice(0, 100) : "unknown-visitor";
    if (securityCheckPassed && visitorId.length >= 8) await sendDemoAnalytics({
      eventName: "code_request_failed", sessionId: `pre:${visitorId}`, visitorId, path: "/demo/access",
      properties: { reason: error instanceof Error ? error.message.slice(0, 120) : "request_failed" },
    });
    return demoApiError(error, "We could not send your access code. Please try again.");
  }
}
