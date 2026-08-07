import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/v(.*)", "/test(.*)"]);

const configuredProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect();
});

const setupProxy = () => NextResponse.next();
const testModeProxy = (request: NextRequest) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/test")) return NextResponse.next();
  url.pathname = "/test";
  url.search = "";
  return NextResponse.redirect(url);
};

const demoModeProxy = (request: NextRequest) => {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/demo")
    || url.pathname.startsWith("/api/demo")
    || url.pathname === "/robots.txt"
    || url.pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }
  url.pathname = "/demo";
  url.search = "";
  return NextResponse.redirect(url);
};

export default process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ? demoModeProxy
  : process.env.NEXT_PUBLIC_TEST_MODE === "true"
    ? testModeProxy
    : !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      ? setupProxy
      : configuredProxy;

export const config = { matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)", "/(api|trpc)(.*)"] };
