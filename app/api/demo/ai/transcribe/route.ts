import { NextRequest, NextResponse } from "next/server";
import { getDemoAccessSession } from "@/lib/demo-access-session";
import { assertDemoAiConsent, normalizeDemoAiRequestId, reserveDemoAi, settleDemoAi, transcribeDemoAudio } from "@/lib/demo-ai-server";
import { assertDemoAiFormPost, demoApiError, demoModeEnabled, demoNotFound } from "@/lib/demo-api";
import { sendDemoAnalytics } from "@/lib/demo-analytics-server";
import { validateDemoAiWav } from "@/lib/demo-ai-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  let requestId = "";
  try {
    assertDemoAiFormPost(request);
    const session = await getDemoAccessSession();
    if (!session) return NextResponse.json({ error: "Demo access expired" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const body = await request.formData();
    assertDemoAiConsent(body);
    requestId = normalizeDemoAiRequestId(body.get("requestId"));
    const file = body.get("audio");
    if (!(file instanceof File) || file.type !== "audio/wav") throw new Error("Demo audio excerpt is too large or invalid");
    const audio = validateDemoAiWav(Buffer.from(await file.arrayBuffer()));
    const quota = await reserveDemoAi(request, session, requestId, "transcription");
    try {
      const result = await transcribeDemoAudio(audio);
      await settleDemoAi(requestId, "completed", result.metadata);
      await sendDemoAnalytics({ eventName: "ai_transcription_completed", sessionId: session.sessionId, visitorId: session.emailHash, emailHash: session.emailHash, properties: { model: result.metadata.model } });
      return NextResponse.json({ text: result.text, remaining: quota.remaining }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await settleDemoAi(requestId, "failed");
      throw error;
    }
  } catch (error) {
    return demoApiError(error, "We could not transcribe that audio. Please try again later.");
  }
}
