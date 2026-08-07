import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  assertDemoPost,
  demoRateKey,
  normalizeDemoEmail,
  normalizeDemoName,
  validateDemoTurnstile,
} from "@/lib/demo-api";

const originalRateSecret = process.env.DEMO_RATE_LIMIT_SECRET;
const originalTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  if (originalRateSecret === undefined) delete process.env.DEMO_RATE_LIMIT_SECRET;
  else process.env.DEMO_RATE_LIMIT_SECRET = originalRateSecret;
  if (originalTurnstileSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
  vi.restoreAllMocks();
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://demo.example.com/api/demo/request-code", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://demo.example.com", ...headers },
  });
}

describe("demo API boundary", () => {
  it("normalizes identity values before they reach Convex", () => {
    expect(normalizeDemoName("  Demo   Buyer ")).toBe("Demo Buyer");
    expect(normalizeDemoEmail(" Buyer@Example.COM ")).toBe("buyer@example.com");
    expect(() => normalizeDemoEmail("not-an-email")).toThrow("valid email");
  });

  it("accepts only small same-origin JSON requests", () => {
    expect(() => assertDemoPost(request())).not.toThrow();
    expect(() => assertDemoPost(request({ origin: "https://attacker.example" }))).toThrow("origin is not allowed");
    expect(() => assertDemoPost(request({ "content-type": "text/plain" }))).toThrow("use JSON");
    expect(() => assertDemoPost(request({ "content-length": "9000" }))).toThrow("too large");
    expect(() => assertDemoPost(request({ origin: "" }))).toThrow("origin is required");
  });

  it("does not expose arbitrary backend errors to public visitors", async () => {
    const { demoApiError } = await import("@/lib/demo-api");
    const response = demoApiError(
      new Error("[Request ID: secret-id] Server Error: database internals and provider credentials"),
      "We could not complete that request.",
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "We could not complete that request." });
  });

  it("preserves allowlisted UX errors inside wrapped Convex failures", async () => {
    const { demoApiError } = await import("@/lib/demo-api");
    const response = demoApiError(
      new Error("[Request ID: hidden] Server Error\nUncaught Error: This demo trial has expired\n    at handler (convex/videoFlowDemoAccess.ts:102:45)"),
      "That code could not be verified. Please try again.",
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "This demo trial has expired" });
  });

  it("rate-limits by platform IP without attacker-controlled User-Agent buckets", () => {
    process.env.DEMO_RATE_LIMIT_SECRET = "rate-limit-secret-that-is-at-least-thirty-two-characters";
    const first = demoRateKey(request({ "x-real-ip": "203.0.113.4", "user-agent": "browser-a" }));
    const rotatedAgent = demoRateKey(request({ "x-real-ip": "203.0.113.4", "user-agent": "browser-b" }));
    const otherAddress = demoRateKey(request({ "x-real-ip": "203.0.113.5", "user-agent": "browser-a" }));
    expect(rotatedAgent).toBe(first);
    expect(otherAddress).not.toBe(first);
  });

  it("requires a server-verified, host-bound Turnstile token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      hostname: "demo.example.com",
      action: "demo-access",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(validateDemoTurnstile(request({ "x-real-ip": "203.0.113.4" }), "fresh-token")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      secret: "turnstile-test-secret",
      response: "fresh-token",
      remoteip: "203.0.113.4",
    });
  });

  it("fails closed for missing, rejected, or wrong-host Turnstile responses", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
    await expect(validateDemoTurnstile(request(), "")).rejects.toThrow("Complete the security check");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(validateDemoTurnstile(request(), "rejected-token")).rejects.toThrow("Complete the security check");

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: "attacker.example", action: "demo-access" }), { status: 200 }));
    await expect(validateDemoTurnstile(request(), "wrong-host-token")).rejects.toThrow("Complete the security check");
  });
});
