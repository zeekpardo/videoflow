"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI, { toFile } from "openai";

type Segment = { start?: number; end?: number; text?: string };
type VerboseTranscript = { text?: string; language?: string; segments?: Segment[] };

type Provider = "openai" | "openrouter";

function providerConfig(): { provider: Provider; apiKey: string; model: string } | null {
  const selected = process.env.TRANSCRIPTION_PROVIDER;
  if (selected === "none") return null;
  if (selected === "openrouter" && process.env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_TRANSCRIPTION_MODEL || "openai/whisper-large-v3",
    };
  }
  if (selected === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, model: "whisper-1" };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: "openrouter", apiKey: process.env.OPENROUTER_API_KEY, model: "openai/whisper-large-v3" };
  }
  return null;
}

async function transcribeWithOpenRouter(buffer: Buffer, durationMs: number, apiKey: string, model: string) {
  const openrouter = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-OpenRouter-Title": process.env.APP_NAME || "VideoFlow",
    },
  });
  const file = await toFile(buffer, "audio.webm", { type: "audio/webm" });
  const result = await openrouter.audio.transcriptions.create({ file, model }) as unknown as { text?: string };
  const text = result.text?.trim() || "";
  return {
    fullText: text,
    segments: text ? [{ start: 0, end: durationMs, text }] : [],
  };
}

export const start = internalAction({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const config = providerConfig();
    if (!config) {
      await ctx.runMutation(internal.videos.setTranscriptStatus, { videoId, status: "none" });
      return;
    }
    try {
      const audio = await ctx.runQuery(internal.videos.getAudioUrl, { videoId });
      if (!audio) {
        await ctx.runMutation(internal.videos.setTranscriptStatus, { videoId, status: "too_large" });
        return;
      }
      const response = await fetch(audio.url);
      if (!response.ok) throw new Error(`Audio fetch failed (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength >= 25 * 1024 * 1024) {
        await ctx.runMutation(internal.videos.setTranscriptStatus, { videoId, status: "too_large" });
        return;
      }
      if (config.provider === "openrouter") {
        const result = await transcribeWithOpenRouter(buffer, audio.durationMs, config.apiKey, config.model);
        await ctx.runMutation(internal.videos.saveTranscript, { videoId, ...result });
      } else {
        const openai = new OpenAI({ apiKey: config.apiKey });
        const file = await toFile(buffer, "audio.webm", { type: "audio/webm" });
        const result = await openai.audio.transcriptions.create({
          file,
          model: config.model,
          response_format: "verbose_json",
          timestamp_granularities: ["segment"],
        }) as unknown as VerboseTranscript;
        const segments = (result.segments || []).map((segment) => ({
          start: Math.round((segment.start || 0) * 1000),
          end: Math.round((segment.end || 0) * 1000),
          text: (segment.text || "").trim(),
        })).filter((segment) => segment.text);
        await ctx.runMutation(internal.videos.saveTranscript, {
          videoId,
          language: result.language,
          fullText: result.text?.trim() || segments.map((segment) => segment.text).join(" "),
          segments,
        });
      }
    } catch (error) {
      console.error("Transcription failed", error instanceof Error ? error.message : "Unknown error");
      await ctx.runMutation(internal.videos.setTranscriptStatus, { videoId, status: "error" });
    }
  },
});
