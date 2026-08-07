"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useMemo } from "react";
import { AppLogo } from "@/components/app-logo";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const testMode = process.env.NEXT_PUBLIC_TEST_MODE === "true";
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function ConvexBridge({ children }: { children: ReactNode }) {
  const client = useMemo(() => new ConvexReactClient(convexUrl!), []);
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}>{children}</ConvexProviderWithClerk>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  // The sales demo uses Convex only through server routes for lead verification.
  // Media and editor state stay in IndexedDB, so it must not mount Clerk or the
  // authenticated product Convex client.
  if (testMode || demoMode) return children;
  if (!convexUrl) return <SetupRequired missing="NEXT_PUBLIC_CONVEX_URL" />;
  if (!clerkKey) return <SetupRequired missing="NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" />;
  return <ClerkProvider publishableKey={clerkKey}><ConvexBridge>{children}</ConvexBridge></ClerkProvider>;
}

function SetupRequired({ missing }: { missing: string }) {
  return <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6"><div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_28px_90px_rgba(37,44,81,.10)] sm:p-10"><AppLogo href="/" /><div className="my-8 h-px bg-slate-100" /><p className="text-xs font-bold uppercase tracking-[.22em] text-primary">One-time setup</p><h1 className="mt-3 text-2xl font-bold tracking-[-.04em] text-slate-950">VideoFlow needs configuration</h1><p className="mt-3 text-sm leading-6 text-slate-500">Run the guided installer to connect Clerk, Convex, Cloudflare R2, and optional transcription. It will collect and validate <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{missing}</code> for you.</p><pre className="mt-6 overflow-x-auto rounded-2xl bg-[#171827] px-5 py-4 text-sm text-slate-200"><code>npm run setup{`\n`}npm run doctor{`\n`}npm run dev</code></pre><p className="mt-5 text-xs leading-5 text-slate-400">Secrets are hidden during input and server credentials are sent directly to your linked Convex deployment.</p></div></main>;
}
