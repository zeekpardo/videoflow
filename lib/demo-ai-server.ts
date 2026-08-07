import { makeFunctionReference } from "convex/server";
import type { NextRequest } from "next/server";
import type { DemoAccessSession } from "@/lib/demo-access-session";
import { demoConvexClient, demoIngestToken, demoRateKey } from "@/lib/demo-api";

export const DEMO_AI_CONSENT_VERSION = "2026-07-16-ai-v1";
export const DEMO_AI_GENERATION_MODEL = "openai/gpt-5.4-nano";
export const DEMO_AI_TRANSCRIPTION_MODEL = "openai/whisper-large-v3";

type AiKind = "transcription" | "generation";

const reserveReference = makeFunctionReference<"action", {
  ingestToken: string; requestId: string; sessionId: string; emailHash: string; rateKey: string;
  kind: AiKind; consentVersion: string; startedAt: number; expiresAt: number;
}, { remaining: number }>("videoFlowDemoAi:reserve");

const settleReference = makeFunctionReference<"action", {
  ingestToken: string; requestId: string; status: "completed" | "failed"; model?: string;
  inputUnits?: number; outputUnits?: number; providerCost?: number;
}, boolean>("videoFlowDemoAi:settle");

function apiKey() {
  const value = process.env.DEMO_OPENROUTER_API_KEY;
  if (!value || value.length < 20) throw new Error("Demo AI is unavailable");
  return value;
}

function configuredModel(variable: "DEMO_OPENROUTER_GENERATION_MODEL" | "DEMO_OPENROUTER_TRANSCRIPTION_MODEL", expected: string) {
  const configured = process.env[variable] || expected;
  if (configured !== expected) throw new Error("Demo AI model is not allowed");
  return configured;
}

export function assertDemoAiConsent(body: Record<string, unknown> | FormData) {
  const accepted = body instanceof FormData ? body.get("acceptedAiTerms") : body.acceptedAiTerms;
  const version = body instanceof FormData ? body.get("consentVersion") : body.consentVersion;
  if ((accepted !== true && accepted !== "true") || version !== DEMO_AI_CONSENT_VERSION) throw new Error("AI consent is required");
}

export function normalizeDemoAiRequestId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(value)) throw new Error("AI request could not be validated");
  return value;
}

export async function reserveDemoAi(request: NextRequest, session: DemoAccessSession, requestId: string, kind: AiKind) {
  // Fail before consuming quota if the provider is not configured.
  apiKey();
  return demoConvexClient().action(reserveReference, {
    ingestToken: demoIngestToken(), requestId, sessionId: session.sessionId, emailHash: session.emailHash,
    rateKey: demoRateKey(request), kind, consentVersion: DEMO_AI_CONSENT_VERSION,
    startedAt: session.startedAt, expiresAt: session.expiresAt,
  });
}

export async function settleDemoAi(requestId: string, status: "completed" | "failed", metadata: { model?: string; inputUnits?: number; outputUnits?: number; providerCost?: number } = {}) {
  try {
    await demoConvexClient().action(settleReference, { ingestToken: demoIngestToken(), requestId, status, ...metadata });
  } catch {
    // The quota was already consumed. A ledger metadata failure must not leak
    // provider details or cause an automatic paid retry.
  }
}

async function openRouter(path: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-OpenRouter-Title": "VideoFlow private demo",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !result) throw new Error("The AI provider is temporarily unavailable");
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "The AI provider is temporarily unavailable") throw error;
    throw new Error("The AI provider is temporarily unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeDemoAudio(audio: Buffer) {
  const model = configuredModel("DEMO_OPENROUTER_TRANSCRIPTION_MODEL", DEMO_AI_TRANSCRIPTION_MODEL);
  const result = await openRouter("audio/transcriptions", {
    model,
    input_audio: { data: audio.toString("base64"), format: "wav" },
    language: "en",
    provider: { zdr: true, data_collection: "deny", allow_fallbacks: false },
  }, 45_000);
  const text = typeof result.text === "string" ? result.text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20_000) : "";
  if (!text) throw new Error("The AI provider returned no transcript");
  return { text, metadata: usageMetadata(result, model) };
}

export async function generateDemoContent(input: { mode: "polish" | "document" | "answer"; title: string; transcript: string; question?: string }) {
  const model = configuredModel("DEMO_OPENROUTER_GENERATION_MODEL", DEMO_AI_GENERATION_MODEL);
  const schema = input.mode === "polish" ? {
    name: "videoflow_polish",
    strict: true,
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" }, summary: { type: "string" },
        captionPhrases: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 18 },
        plan: { type: "array", minItems: 3, maxItems: 6, items: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["title", "captions", "template", "smart_focus"] }, label: { type: "string" }, description: { type: "string" } }, required: ["kind", "label", "description"] } },
      }, required: ["title", "summary", "captionPhrases", "plan"],
    },
  } : input.mode === "document" ? {
    name: "videoflow_document",
    strict: true,
    schema: {
      type: "object", additionalProperties: false,
      properties: { title: { type: "string" }, body: { type: "string" } },
      required: ["title", "body"],
    },
  } : {
    name: "videoflow_answer",
    strict: true,
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        answer: { type: "string" },
        citations: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { startMs: { type: "number" }, endMs: { type: "number" }, label: { type: "string" } }, required: ["startMs", "endMs", "label"] } },
      }, required: ["answer", "citations"],
    },
  };
  const instruction = input.mode === "polish"
    ? "Return a proposed edit plan, concise improved title, two-sentence summary, and short caption phrases. The plan is a preview and must use only the allowed kinds. Do not invent claims."
    : input.mode === "document"
      ? "Turn the transcript into a concise SOP in Markdown with an overview, numbered steps, and key takeaways. Preserve timestamps and do not invent facts or URLs."
      : "Answer the question using only the timestamped transcript. If it is not answered, say so. Return 1-3 exact timestamp citations.";
  const result = await openRouter("chat/completions", {
    model,
    messages: [
      { role: "system", content: `You edit product walkthroughs. ${instruction}` },
      { role: "user", content: `Current title: ${input.title}${input.question ? `\nQuestion: ${input.question}` : ""}\n\nTranscript:\n${input.transcript}` },
    ],
    response_format: { type: "json_schema", json_schema: schema },
    max_completion_tokens: input.mode === "polish" ? 900 : input.mode === "document" ? 1_200 : 500,
    provider: { zdr: true, data_collection: "deny", allow_fallbacks: false, require_parameters: true },
  }, 30_000);
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = typeof first?.message?.content === "string" ? first.message.content : "";
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("The AI provider returned an invalid result"); }
  return { value: normalizeGenerated(input.mode, parsed), metadata: usageMetadata(result, model) };
}

function normalizeGenerated(mode: "polish" | "document" | "answer", value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The AI provider returned an invalid result");
  const record = value as Record<string, unknown>;
  if (mode === "answer") {
    const answer = typeof record.answer === "string" ? record.answer.trim().slice(0, 2_000) : "";
    const citations = Array.isArray(record.citations) ? record.citations.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const citation = item as Record<string, unknown>;
      return typeof citation.startMs === "number" && Number.isFinite(citation.startMs) && typeof citation.endMs === "number" && Number.isFinite(citation.endMs) && typeof citation.label === "string"
        ? [{ startMs: Math.max(0, citation.startMs), endMs: Math.max(citation.startMs, citation.endMs), label: citation.label.trim().slice(0, 160) }]
        : [];
    }).slice(0, 3) : [];
    if (!answer || !citations.length) throw new Error("The AI provider returned an invalid result");
    return { answer, citations };
  }
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
  if (!title) throw new Error("The AI provider returned an invalid result");
  if (mode === "document") {
    const body = typeof record.body === "string" ? record.body.trim().slice(0, 12_000) : "";
    if (!body) throw new Error("The AI provider returned an invalid result");
    return { title, body };
  }
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 1_000) : "";
  const captionPhrases = Array.isArray(record.captionPhrases)
    ? record.captionPhrases.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 160)).filter(Boolean).slice(0, 18)
    : [];
  const allowedKinds = new Set(["title", "captions", "template", "smart_focus"]);
  const plan = Array.isArray(record.plan) ? record.plan.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.kind === "string" && allowedKinds.has(row.kind) && typeof row.label === "string" && typeof row.description === "string"
      ? [{ id: `demo-plan-${index}`, kind: row.kind as "title" | "captions" | "template" | "smart_focus", label: row.label.trim().slice(0, 120), description: row.description.trim().slice(0, 300), selected: true }]
      : [];
  }).slice(0, 6) : [];
  if (!summary || !captionPhrases.length || !plan.length) throw new Error("The AI provider returned an invalid result");
  return { title, summary, captionPhrases, plan };
}

function usageMetadata(result: Record<string, unknown>, model: string) {
  const usage = result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {};
  return {
    model,
    inputUnits: finiteNumber(usage.prompt_tokens) ?? finiteNumber(usage.input_tokens),
    outputUnits: finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.output_tokens),
    providerCost: finiteNumber(usage.cost),
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
