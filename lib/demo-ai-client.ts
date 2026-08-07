import type { CaptionCue } from "@/lib/video-v2";

export const DEMO_AI_CLIENT_CONSENT_VERSION = "2026-07-16-ai-v1";
const DEMO_AI_CONSENT_STORAGE_PREFIX = `videoflow-demo-ai-consent:${DEMO_AI_CLIENT_CONSENT_VERSION}`;

export function demoAiConsentStorageKey() {
  try {
    const value = JSON.parse(localStorage.getItem("videoflow-sales-demo:session") || "null") as { sessionId?: unknown } | null;
    const sessionId = typeof value?.sessionId === "string" ? value.sessionId.slice(0, 256) : "unknown-trial";
    return `${DEMO_AI_CONSENT_STORAGE_PREFIX}:${sessionId}`;
  } catch {
    return `${DEMO_AI_CONSENT_STORAGE_PREFIX}:unknown-trial`;
  }
}

export async function demoAudioExcerptAsWav(video: Blob, maxSeconds = 60) {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass || !window.OfflineAudioContext) throw new Error("This browser cannot prepare an audio excerpt for AI transcription");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData((await video.arrayBuffer()).slice(0));
    const duration = Math.min(maxSeconds, decoded.duration);
    if (!Number.isFinite(duration) || duration <= 0.1) throw new Error("This recording does not contain usable audio");
    const sampleRate = 16_000;
    const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
    const offline = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0, 0, duration);
    const rendered = await offline.startRendering();
    return pcm16Wav(rendered.getChannelData(0), sampleRate);
  } catch (error) {
    if (error instanceof Error && /cannot prepare|does not contain/.test(error.message)) throw error;
    throw new Error("This browser could not read the recording audio. Try a Chrome or Edge recording with microphone audio.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

function pcm16Wav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function demoCaptionCuesFromText(text: string, durationMs: number): CaptionCue[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const groups: string[] = [];
  for (let index = 0; index < words.length; index += 8) groups.push(words.slice(index, index + 8).join(" "));
  const usableDuration = Math.max(1_000, durationMs);
  const step = usableDuration / groups.length;
  return groups.map((phrase, index) => ({
    id: `ai-caption-${crypto.randomUUID()}`,
    startMs: Math.round(index * step),
    endMs: Math.round(index === groups.length - 1 ? usableDuration : (index + 1) * step),
    text: phrase.slice(0, 160),
  }));
}

export async function demoAiGenerate(input: { mode: "polish" | "document" | "answer"; title: string; transcript: string; question?: string }) {
  const response = await fetch("/api/demo/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      requestId: crypto.randomUUID(),
      acceptedAiTerms: true,
      consentVersion: DEMO_AI_CLIENT_CONSENT_VERSION,
    }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; result?: unknown; remaining?: number };
  if (!response.ok) throw new Error(body.error || "The AI request could not be completed");
  return body as { result: Record<string, unknown>; remaining: number };
}

export async function demoAiTranscribe(video: Blob) {
  const audio = await demoAudioExcerptAsWav(video);
  const form = new FormData();
  form.set("requestId", crypto.randomUUID());
  form.set("acceptedAiTerms", "true");
  form.set("consentVersion", DEMO_AI_CLIENT_CONSENT_VERSION);
  form.set("audio", audio, "videoflow-demo-excerpt.wav");
  const response = await fetch("/api/demo/ai/transcribe", { method: "POST", body: form });
  const body = await response.json().catch(() => ({})) as { error?: string; text?: string; remaining?: number };
  if (!response.ok || !body.text) throw new Error(body.error || "The audio could not be transcribed");
  return { text: body.text, remaining: typeof body.remaining === "number" ? body.remaining : 0 };
}
