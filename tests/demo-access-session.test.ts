import { describe, expect, it } from "vitest";
import {
  signDemoAccessSession,
  verifyDemoAccessSession,
  type DemoAccessSession,
} from "@/lib/demo-access-session";

const secret = "a-demo-session-secret-that-is-longer-than-thirty-two-characters";
const now = 1_800_000_000_000;
const session: DemoAccessSession = {
  version: 1,
  sessionId: "stable-demo-session-1234567890",
  emailHash: "a".repeat(64),
  name: "Demo User",
  startedAt: now,
  expiresAt: now + 72 * 60 * 60 * 1000,
};

describe("demo access sessions", () => {
  it("round-trips a valid fixed-expiry session", () => {
    const token = signDemoAccessSession(session, secret);
    expect(verifyDemoAccessSession(token, secret, now + 1_000)).toEqual(session);
  });

  it("rejects tampering and the wrong secret", () => {
    const token = signDemoAccessSession(session, secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(verifyDemoAccessSession(tampered, secret, now)).toBeNull();
    expect(verifyDemoAccessSession(token, `${secret}-wrong`, now)).toBeNull();
  });

  it("rejects an expired session instead of extending it", () => {
    const token = signDemoAccessSession(session, secret);
    expect(verifyDemoAccessSession(token, secret, session.expiresAt)).toBeNull();
  });

  it("rejects sessions whose claimed window exceeds 72 hours", () => {
    const token = signDemoAccessSession({ ...session, expiresAt: session.expiresAt + 10 * 60 * 1000 }, secret);
    expect(verifyDemoAccessSession(token, secret, now)).toBeNull();
  });

  it("rejects a session whose expiry precedes its start", () => {
    const token = signDemoAccessSession({ ...session, expiresAt: session.startedAt - 1 }, secret);
    expect(verifyDemoAccessSession(token, secret, session.startedAt - 2)).toBeNull();
  });

  it("fails closed when the signing secret is missing or weak", () => {
    const token = signDemoAccessSession(session, secret);
    expect(verifyDemoAccessSession(token, undefined, now)).toBeNull();
    expect(() => signDemoAccessSession(session, "too-short")).toThrow(/32 characters/);
  });
});
