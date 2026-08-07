import { NextRequest, NextResponse } from "next/server";
import { getDemoAccessSession } from "@/lib/demo-access-session";
import { assertDemoAiConsent, generateDemoContent, normalizeDemoAiRequestId, reserveDemoAi, settleDemoAi } from "@/lib/demo-ai-server";
import { assertDemoAiJsonPost, demoApiError, demoModeEnabled, demoNotFound } from "@/lib/demo-api";
import { sendDemoAnalytics } from "@/lib/demo-analytics-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  let requestId = "";
  try {
    assertDemoAiJsonPost(request);
    const session = await getDemoAccessSession();
    if (!session) return NextResponse.json({ error: "Demo access expired" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const body = await request.json() as Record<string, unknown>;
    assertDemoAiConsent(body);
    requestId = normalizeDemoAiRequestId(body.requestId);
    const mode = body.mode === "polish" || body.mode === "document" || body.mode === "answer" ? body.mode : null;
    if (!mode) throw new Error("AI request could not be validated");
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const transcript = typeof body.transcript === "string" ? body.transcript.trim().slice(0, 20_000) : "";
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : undefined;
    if (!title || transcript.length < 3) throw new Error("Add or generate captions before using this AI feature");
    if (mode === "answer" && (!question || question.length < 3)) throw new Error("Ask a more specific question");
    const quota = await reserveDemoAi(request, session, requestId, "generation");
    try {
      const result = await generateDemoContent({ mode, title, transcript, question });
      await settleDemoAi(requestId, "completed", result.metadata);
      await sendDemoAnalytics({ eventName: "ai_generation_completed", sessionId: session.sessionId, visitorId: session.emailHash, emailHash: session.emailHash, properties: { mode, model: result.metadata.model } });
      return NextResponse.json({ result: result.value, remaining: quota.remaining }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await settleDemoAi(requestId, "failed");
      throw error;
    }
  } catch (error) {
    return demoApiError(error, "We could not generate that AI result. Please try again later.");
  }
}
