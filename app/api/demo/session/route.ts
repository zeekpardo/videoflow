import { DEMO_ACCESS_COOKIE, getDemoAccessSession } from "@/lib/demo-access-session";
import { assertDemoPost, demoModeEnabled, demoNotFound } from "@/lib/demo-api";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  if (!demoModeEnabled()) return demoNotFound();
  const session = await getDemoAccessSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({
    authenticated: true,
    name: session.name,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  if (!demoModeEnabled()) return demoNotFound();
  try {
    assertDemoPost(request);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEMO_ACCESS_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
