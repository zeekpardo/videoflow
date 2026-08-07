"use node";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import OpenAI from "openai";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib/auth";
import { createDirectorPlan, proposeVideoTasks, rankTranscriptSegments, suggestVisualSopFrames, type VideoTaskProposalCandidate } from "../lib/video-v2";

const scrypt = promisify(scryptCallback);
const documentKind = v.union(v.literal("sop"), v.literal("tutorial"), v.literal("release_notes"), v.literal("recap"), v.literal("email"));
const VIEWER_AI_CONSENT_VERSION = "2026-07-16-viewer-ai-v1";

async function derive(password: string, salt: string) {
  return Buffer.from(await scrypt(password, Buffer.from(salt, "hex"), 32) as Buffer).toString("hex");
}

export const setShareLinkPassword = action({
  args: { shareLinkId: v.id("videoShareLinks"), password: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const info = await ctx.runQuery(internal.videoFlowV2.shareLinkOwnerInfo, { shareLinkId: args.shareLinkId });
    if (!info || info.ownerId !== user.ownerId) throw new Error("Not authorized");
    if (args.password === null || args.password === "") {
      await ctx.runMutation(internal.videoFlowV2.setShareLinkPasswordHash, { shareLinkId: args.shareLinkId, ownerId: user.ownerId });
      return;
    }
    if (args.password.length < 8 || args.password.length > 128) throw new Error("Password must be 8–128 characters");
    const salt = randomBytes(16).toString("hex");
    const hash = await derive(args.password, salt);
    await ctx.runMutation(internal.videoFlowV2.setShareLinkPasswordHash, { shareLinkId: args.shareLinkId, ownerId: user.ownerId, salt, hash });
  },
});

function stamp(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function fallbackDocument(title: string, kind: string, segments: Array<{ start: number; text: string }>) {
  const label = kind === "sop" ? "Standard operating procedure" : kind === "tutorial" ? "Tutorial" : kind === "release_notes" ? "Release notes" : kind === "recap" ? "Video recap" : "Email summary";
  return {
    title: `${title} — ${label}`,
    body: [`# ${title}`, "", `_${label} generated from the transcript._`, "", ...segments.filter((segment) => segment.text.trim()).slice(0, 50).map((segment, index) => `${index + 1}. [${stamp(segment.start)}] ${segment.text.trim()}`)].join("\n"),
  };
}

export const generateDocument = action({
  args: { videoId: v.id("videos"), kind: documentKind },
  handler: async (ctx, args): Promise<{ documentId: string; usedAi: boolean; visuals: Array<{ timestampMs: number; caption: string }> }> => {
    const user = await requireUser(ctx);
    const context = await ctx.runQuery(internal.videoFlowV2.documentContext, { videoId: args.videoId, ownerId: user.ownerId });
    if (!context.transcript?.segments.length) throw new Error("A transcript is required to generate a document");
    const fallback = fallbackDocument(context.title, args.kind, context.transcript.segments);
    const apiKey = process.env.OPENAI_API_KEY;
    let result = fallback;
    let usedAi = false;
    if (apiKey) {
      try {
        const client = new OpenAI({ apiKey });
        const transcript = context.transcript.segments.map((segment) => `[${stamp(segment.start)}] ${segment.text}`).join("\n").slice(0, 80_000);
        const response = await client.responses.create({
          model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-4.1-mini",
          input: `Create a concise ${args.kind.replaceAll("_", " ")} from this video transcript. Preserve useful timestamps in [m:ss] format. Return Markdown only.\n\nTitle: ${context.title}\n\n${transcript}`,
          max_output_tokens: 3_000,
        });
        const body = response.output_text.trim();
        if (body) {
          result = { title: fallback.title, body };
          usedAi = true;
        }
      } catch {
        // Document generation remains useful when the optional provider fails.
      }
    }
    const documentId = await ctx.runMutation(internal.videoFlowV2.saveGeneratedDocument, { videoId: args.videoId, ownerId: user.ownerId, kind: args.kind, ...result });
    return { documentId: String(documentId), usedAi, visuals: suggestVisualSopFrames(context.transcript.segments, context.durationMs, 4) };
  },
});

export const generateDirectorPlan = action({
  args: {
    videoId: v.id("videos"), instruction: v.string(),
    silenceRanges: v.array(v.object({ startMs: v.number(), endMs: v.number() })),
    hasCaptionTrack: v.boolean(), hasTemplate: v.boolean(), hasClickMarkers: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const context = await ctx.runQuery(internal.videoFlowV2.documentContext, { videoId: args.videoId, ownerId: user.ownerId });
    if (!context.transcript?.segments.length) throw new Error("A transcript is required for AI Director");
    const durationMs = context.durationMs;
    const plan = createDirectorPlan({
      title: context.title, instruction: args.instruction.slice(0, 1_000), durationMs,
      transcript: context.transcript.segments, silenceRanges: args.silenceRanges.slice(0, 100),
      hasCaptionTrack: args.hasCaptionTrack, hasTemplate: args.hasTemplate, hasClickMarkers: args.hasClickMarkers,
    });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ...plan, usedAi: false };
    try {
      const client = new OpenAI({ apiKey });
      const transcript = context.transcript.segments.map((segment) => `[${stamp(segment.start)}] ${segment.text}`).join("\n").slice(0, 80_000);
      const response = await client.responses.create({
        model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-4.1-mini",
        input: `You are an AI video director. Given the editor's goal and transcript, return JSON with headline, rationale, suggestedTitle, and suggestedSummary. Be faithful to the recording and do not claim edits were applied.\nGoal: ${args.instruction.slice(0, 1_000)}\n\n${transcript}`,
        max_output_tokens: 900,
      });
      const parsed = JSON.parse(response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "")) as Record<string, unknown>;
      return {
        ...plan,
        headline: typeof parsed.headline === "string" ? parsed.headline.trim().slice(0, 160) : plan.headline,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 800) : plan.rationale,
        suggestedTitle: typeof parsed.suggestedTitle === "string" ? parsed.suggestedTitle.trim().slice(0, 200) : plan.suggestedTitle,
        suggestedSummary: typeof parsed.suggestedSummary === "string" ? parsed.suggestedSummary.trim().slice(0, 2_000) : plan.suggestedSummary,
        usedAi: true,
      };
    } catch {
      return { ...plan, usedAi: false };
    }
  },
});

export const askVideo = action({
  args: { token: v.string(), sessionToken: v.optional(v.string()), question: v.string(), viewerKey: v.string(), acceptedAiTerms: v.boolean(), consentVersion: v.string() },
  handler: async (ctx, args) => {
    if (!args.acceptedAiTerms || args.consentVersion !== VIEWER_AI_CONSENT_VERSION) throw new Error("AI consent is required");
    const question = args.question.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
    if (question.length < 3) throw new Error("Ask a more specific question");
    const context = await ctx.runQuery(internal.videosPublic.askContext, { token: args.token.slice(0, 200), sessionToken: args.sessionToken?.slice(0, 256) });
    await ctx.runMutation(internal.videosPublic.consumeAskQuota, { videoId: context.videoId, viewerKey: createHash("sha256").update(args.viewerKey.slice(0, 200)).digest("hex") });
    const evidence = rankTranscriptSegments(question, context.segments, 3);
    const citations = evidence.map((segment) => ({ startMs: segment.start, endMs: segment.end, label: segment.text.trim().slice(0, 120) }));
    const fallback = evidence.length ? evidence.map((segment) => segment.text.trim()).join(" ").slice(0, 1_500) : "The recording does not appear to answer that question.";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !evidence.length) return { answer: fallback, citations, usedAi: false };
    try {
      const client = new OpenAI({ apiKey });
      const evidenceText = evidence.map((segment, index) => `[${index + 1} @ ${stamp(segment.start)}] ${segment.text}`).join("\n");
      const response = await client.responses.create({
        model: process.env.OPENAI_VIEWER_MODEL || process.env.OPENAI_DOCUMENT_MODEL || "gpt-4.1-mini",
        input: `Answer the viewer's question using only the evidence below. Be concise. If it is not answered, say so. Cite evidence inline as [1], [2], or [3].\nQuestion: ${question}\n\nEvidence:\n${evidenceText}`,
        max_output_tokens: 450,
      });
      const answer = response.output_text.trim().slice(0, 2_000);
      return { answer: answer || fallback, citations, usedAi: !!answer };
    } catch {
      return { answer: fallback, citations, usedAi: false };
    }
  },
});

export const generateMetadata = action({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args): Promise<{ title: string; summary: string; chapters: Array<{ startMs: number; label: string }>; usedAi: boolean }> => {
    const user = await requireUser(ctx);
    const context = await ctx.runQuery(internal.videoFlowV2.documentContext, { videoId: args.videoId, ownerId: user.ownerId });
    if (!context.transcript?.segments.length) throw new Error("A transcript is required for metadata suggestions");
    const segments = context.transcript.segments;
    const firstWords = segments.map((segment) => segment.text).join(" ").trim().split(/\s+/).slice(0, 9).join(" ");
    const fallback = {
      title: firstWords ? `${firstWords}${firstWords.endsWith(".") ? "" : "…"}`.slice(0, 100) : context.title,
      summary: segments.slice(0, 4).map((segment) => segment.text.trim()).join(" ").slice(0, 600),
      chapters: segments.filter((_, index) => index % Math.max(1, Math.ceil(segments.length / 6)) === 0).slice(0, 8).map((segment) => ({ startMs: segment.start, label: segment.text.trim().split(/\s+/).slice(0, 7).join(" ") })),
      usedAi: false,
    };
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return fallback;
    try {
      const client = new OpenAI({ apiKey });
      const transcript = segments.map((segment) => `[${stamp(segment.start)}] ${segment.text}`).join("\n").slice(0, 80_000);
      const response = await client.responses.create({
        model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-4.1-mini",
        input: `Return JSON with keys title, summary, and chapters. chapters is an array of {startMs,label}. Create a concise title, a two-sentence summary, and no more than 8 useful chapters from this timestamped transcript. Return JSON only.\n\n${transcript}`,
        max_output_tokens: 1_500,
      });
      const parsed = JSON.parse(response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "")) as { title?: unknown; summary?: unknown; chapters?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : fallback.title;
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 5_000) : fallback.summary;
      const chapters = Array.isArray(parsed.chapters) ? parsed.chapters.flatMap((chapter) => {
        if (!chapter || typeof chapter !== "object") return [];
        const row = chapter as { startMs?: unknown; label?: unknown };
        return typeof row.startMs === "number" && Number.isFinite(row.startMs) && typeof row.label === "string" && row.label.trim()
          ? [{ startMs: Math.max(0, row.startMs), label: row.label.trim().slice(0, 120) }]
          : [];
      }).slice(0, 8) : fallback.chapters;
      return { title, summary, chapters, usedAi: true };
    } catch {
      return fallback;
    }
  },
});

export const generateTaskProposals = action({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args): Promise<{ count: number; usedAi: boolean }> => {
    const user = await requireUser(ctx);
    const context = await ctx.runQuery(internal.videoFlowV2.taskContext, { videoId: args.videoId, ownerId: user.ownerId });
    let proposals = proposeVideoTasks({ transcript: context.transcript, comments: context.comments, reviews: context.reviews });
    let usedAi = false;
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const client = new OpenAI({ apiKey });
        const sources = [
          ...context.transcript.map((segment) => `[transcript @ ${segment.start}ms] ${segment.text}`),
          ...context.comments.map((comment) => `[comment ${comment.id}${comment.timestampMs === undefined ? "" : ` @ ${comment.timestampMs}ms`}] ${comment.text}`),
          ...context.reviews.map((review) => `[review ${review.id}] ${review.text}`),
        ].join("\n").slice(0, 80_000);
        const response = await client.responses.create({
          model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-4.1-mini",
          input: `Extract concrete work items from the video evidence below. Return JSON only: {"tasks":[{"sourceKind":"transcript|comment|review","sourceId":"optional id","sourceTimestampMs":0,"title":"imperative task","description":"brief evidence-grounded context","confidence":0.0}]}. Do not invent tasks. Return at most 20.\n\n${sources}`,
          max_output_tokens: 2_000,
        });
        const parsed = JSON.parse(response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "")) as { tasks?: unknown };
        if (Array.isArray(parsed.tasks)) {
          const ai: VideoTaskProposalCandidate[] = parsed.tasks.flatMap((candidate, index) => {
            if (!candidate || typeof candidate !== "object") return [];
            const row = candidate as Record<string, unknown>;
            const sourceKind = row.sourceKind === "comment" || row.sourceKind === "review" ? row.sourceKind : "transcript";
            const title = typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim().slice(0, 180) : "";
            if (!title) return [];
            const sourceId = typeof row.sourceId === "string" ? row.sourceId.slice(0, 200) : undefined;
            const sourceTimestampMs = typeof row.sourceTimestampMs === "number" && Number.isFinite(row.sourceTimestampMs) ? Math.max(0, row.sourceTimestampMs) : undefined;
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
            return [{
              fingerprint: `ai:${sourceKind}:${sourceId ?? sourceTimestampMs ?? index}:${slug}`.slice(0, 240),
              sourceKind,
              sourceId,
              sourceTimestampMs,
              title,
              description: typeof row.description === "string" ? row.description.trim().slice(0, 2_000) || undefined : undefined,
              confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? Math.min(1, Math.max(0, row.confidence)) : 0.75,
            }];
          });
          if (ai.length) {
            proposals = ai;
            usedAi = true;
          }
        }
      } catch {
        // Deterministic proposals remain available when optional AI is absent or fails.
      }
    }
    const ids = await ctx.runMutation(internal.videoFlowV2.saveTaskProposals, { videoId: args.videoId, ownerId: user.ownerId, proposals });
    return { count: ids.length, usedAi };
  },
});

export const issueShareLinkSession = action({
  args: { token: v.string(), password: v.optional(v.string()), viewerEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.videoFlowV2.shareLinkLockInfo, { token: args.token });
    if (!info) throw new Error("Share link not found or no longer available");
    if (info.passwordHash && info.passwordSalt) {
      if (!args.password) throw new Error("Password required");
      const candidate = await derive(args.password, info.passwordSalt);
      const candidateBuffer = Buffer.from(candidate, "hex");
      const expectedBuffer = Buffer.from(info.passwordHash, "hex");
      if (candidateBuffer.length !== expectedBuffer.length || !timingSafeEqual(candidateBuffer, expectedBuffer)) throw new Error("Incorrect password");
    }
    const email = args.viewerEmail?.trim().toLowerCase();
    if (info.requireEmail && !email) throw new Error("Email required");
    if (info.requireEmail && info.reviewerEmail && email !== info.reviewerEmail) throw new Error("Use the email address assigned to this review request");
    if (email && info.allowedDomains.length) {
      const domain = email.split("@")[1] || "";
      if (!info.allowedDomains.includes(domain)) throw new Error("This email domain is not allowed");
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const expiresAt = Date.now() + 12 * 60 * 60 * 1_000;
    await ctx.runMutation(internal.videoFlowV2.createShareLinkSession, { shareLinkId: info.shareLinkId, tokenHash, viewerEmail: email, expiresAt });
    return { sessionToken, expiresAt };
  },
});
