import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const DEMO_ACCESS_COOKIE = "videoflow-demo-access";

const MAX_SESSION_AGE_MS = 72 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface DemoAccessSession {
  version: 1;
  sessionId: string;
  emailHash: string;
  name: string;
  startedAt: number;
  expiresAt: number;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function validSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export function signDemoAccessSession(session: DemoAccessSession, secret: string) {
  if (!validSecret(secret)) throw new Error("DEMO_SESSION_SECRET must contain at least 32 characters");
  const payload = base64url(JSON.stringify(session));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyDemoAccessSession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): DemoAccessSession | null {
  if (!token || token.length > 4096 || !validSecret(secret)) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expected = Buffer.from(signature(payload, secret), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DemoAccessSession>;
    if (
      parsed.version !== 1
      || typeof parsed.sessionId !== "string"
      || parsed.sessionId.length < 16
      || parsed.sessionId.length > 256
      || typeof parsed.emailHash !== "string"
      || !/^[a-f0-9]{64}$/i.test(parsed.emailHash)
      || typeof parsed.name !== "string"
      || parsed.name.length < 1
      || parsed.name.length > 120
      || typeof parsed.startedAt !== "number"
      || !Number.isFinite(parsed.startedAt)
      || typeof parsed.expiresAt !== "number"
      || !Number.isFinite(parsed.expiresAt)
      || parsed.expiresAt <= now
      || parsed.startedAt > now + CLOCK_SKEW_MS
      || parsed.expiresAt < parsed.startedAt
      || parsed.expiresAt - parsed.startedAt > MAX_SESSION_AGE_MS + CLOCK_SKEW_MS
    ) return null;

    return parsed as DemoAccessSession;
  } catch {
    return null;
  }
}

export async function getDemoAccessSession(now = Date.now()) {
  const token = (await cookies()).get(DEMO_ACCESS_COOKIE)?.value;
  return verifyDemoAccessSession(token, process.env.DEMO_SESSION_SECRET, now);
}
