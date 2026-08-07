import { createHmac, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DEMO_TERMS_VERSION = "2026-07-16-ai-v1";

export function demoModeEnabled() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export function demoNotFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function demoConvexClient() {
  const url = process.env.DEVLAUNCH_CONVEX_URL;
  if (!url) throw new Error("The DevLaunch Convex URL is not configured");
  return new ConvexHttpClient(url);
}

export function demoIngestToken() {
  const value = process.env.VIDEOFLOW_DEMO_INGEST_TOKEN;
  if (!value) throw new Error("The demo ingest token is not configured");
  return value;
}

export function demoPrivacyUrl() {
  const value = process.env.NEXT_PUBLIC_DEMO_PRIVACY_URL;
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) throw new Error();
    return url.toString();
  } catch {
    throw new Error("The demo privacy notice is not configured");
  }
}

export function assertDemoPost(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error("Demo requests must use JSON");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) throw new Error("Demo request is too large");
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("Demo request origin is required");
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error("Demo request origin is not allowed");
  } catch (error) {
    if (error instanceof Error && error.message === "Demo request origin is not allowed") throw error;
    throw new Error("Demo request origin is invalid");
  }
}

export function assertDemoAiJsonPost(request: NextRequest) {
  assertDemoSameOrigin(request);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error("Demo AI requests must use JSON");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 32_768) throw new Error("Demo AI request is too large");
}

export function assertDemoAiFormPost(request: NextRequest) {
  assertDemoSameOrigin(request);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("Demo transcription requests must use form data");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 2_300_000) throw new Error("Demo audio excerpt is too large");
}

function assertDemoSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("Demo request origin is required");
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error("Demo request origin is not allowed");
  } catch (error) {
    if (error instanceof Error && error.message === "Demo request origin is not allowed") throw error;
    throw new Error("Demo request origin is invalid");
  }
}

export function normalizeDemoName(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter your name");
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 100) throw new Error("Enter a name between 2 and 100 characters");
  return name;
}

export function normalizeDemoEmail(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter your email address");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new Error("Enter a valid email address");
  return email;
}

export function demoClientAddress(request: NextRequest) {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return vercelForwarded || request.headers.get("x-real-ip") || forwarded || "unknown";
}

export function demoRateKey(request: NextRequest) {
  const secret = process.env.DEMO_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) throw new Error("The demo rate-limit secret is not configured");
  // User-Agent is attacker-controlled and must not create a fresh rate bucket.
  return createHmac("sha256", secret).update(demoClientAddress(request)).digest("hex");
}

export async function validateDemoTurnstile(request: NextRequest, value: unknown) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error("The demo security check is not configured");
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    throw new Error("Complete the security check and try again");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: value,
        remoteip: demoClientAddress(request) === "unknown" ? undefined : demoClientAddress(request),
        idempotency_key: randomUUID(),
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null) as null | { success?: boolean; hostname?: string; action?: string };
    if (!response.ok || !result?.success || result.action !== "demo-access" || (result.hostname && result.hostname !== request.nextUrl.hostname)) {
      throw new Error("Complete the security check and try again");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Complete the security check and try again") throw error;
    throw new Error("The security check is temporarily unavailable. Please try again");
  } finally {
    clearTimeout(timeout);
  }
}

export function demoApiError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : "";
  let safe = fallback;
  let status = 400;

  // Never reflect arbitrary provider, Convex, configuration, or stack details to
  // an unauthenticated visitor. Match the complete wrapped provider/Convex error
  // only against this allowlist; never return the wrapped text itself.
  if (/accept the demo terms/i.test(raw)) safe = "Please accept the demo terms and privacy notice";
  else if (/name between 2 and 100|enter your name/i.test(raw)) safe = "Enter a name between 2 and 100 characters";
  else if (/valid email|email address/i.test(raw)) safe = "Enter a valid email address";
  else if (/complete the security check/i.test(raw)) { safe = "Complete the security check and try again"; status = 403; }
  else if (/security check is temporarily unavailable/i.test(raw)) { safe = "The security check is temporarily unavailable. Please try again"; status = 503; }
  else if (/trial has expired/i.test(raw)) { safe = "This demo trial has expired"; status = 410; }
  else if (/too many|please wait|capacity|incorrect verification codes/i.test(raw)) { safe = "Too many attempts. Please wait and try again."; status = 429; }
  else if (/all 3 transcription demo uses/i.test(raw)) { safe = "All 3 transcription demo uses have been used"; status = 429; }
  else if (/all 3 generation demo uses/i.test(raw)) { safe = "All 3 generation demo uses have been used"; status = 429; }
  else if (/AI consent is required/i.test(raw)) { safe = "Accept the AI privacy notice before using this feature"; status = 403; }
  else if (/AI request was already used/i.test(raw)) { safe = "This AI request was already processed"; status = 409; }
  else if (/AI request is too large|audio excerpt is too large/i.test(raw)) { safe = "The selected AI input is too large"; status = 413; }
  else if (/six-digit code/i.test(raw)) safe = "Enter the six-digit code from your email";
  else if (/request a new access code/i.test(raw)) safe = "Request a new access code";
  else if (/verification code is invalid or expired/i.test(raw)) safe = "Verification code is invalid or expired";
  else if (/verification email could not be sent/i.test(raw)) { safe = "We could not send your access code. Please try again."; status = 503; }
  else if (/not configured|unavailable|not authorized|provider returned|invalid result/i.test(raw)) status = 503;

  return NextResponse.json({ error: safe }, { status, headers: { "Cache-Control": "no-store" } });
}
