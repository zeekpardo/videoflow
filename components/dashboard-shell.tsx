"use client";

import { UserButton } from "@clerk/nextjs";
import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Captions, Library, Menu, MonitorUp, Sparkles } from "lucide-react";
import { useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { appConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/record", label: "Record", icon: MonitorUp },
  { href: "/videos", label: "Library", icon: Library },
  { href: "/transcripts", label: "Transcripts", icon: Captions },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1.5" aria-label="Workspace navigation">
      {nav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/videos" && pathname.startsWith("/videos/"));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "group flex h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition-all",
              active
                ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_14%,transparent)]"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "text-slate-400 group-hover:text-slate-600")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isVideoEditor = /^\/videos\/[^/]+\/?$/.test(pathname);
  let host = "your workspace";
  try { host = new URL(appConfig.url).host; } catch { /* use neutral fallback */ }

  return (
    <>
      <AuthLoading>
        <div className="grid min-h-screen place-items-center bg-[#f6f8fc] text-sm text-slate-500">Loading your workspace…</div>
      </AuthLoading>
      <Unauthenticated>
        <div className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_24px_80px_rgba(36,43,76,.08)]">
            <AppLogo className="justify-center" />
            <p className="mb-6 mt-6 text-sm leading-6 text-slate-500">Sign in to record, manage, and share your videos.</p>
            <Link href="/sign-in" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-lg shadow-primary/20">Sign in</Link>
          </div>
        </div>
      </Unauthenticated>
      <Authenticated>
        <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
          {!isVideoEditor && <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] border-r border-slate-200/80 bg-white lg:flex lg:flex-col">
            <div className="flex h-[88px] items-center border-b border-slate-100 px-7"><AppLogo /></div>
            <div className="flex-1 px-5 py-7"><Navigation /></div>
            <div className="m-5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[.08] to-white p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-primary shadow-sm"><Sparkles className="h-4 w-4" /></div>
              <p className="text-sm font-semibold text-slate-800">Your video workspace</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Private media storage and share links, under your brand.</p>
            </div>
          </aside>}

          {!isVideoEditor && mobileOpen && (
            <button className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
          )}
          {!isVideoEditor && <aside className={cn("fixed inset-y-0 left-0 z-50 w-[280px] bg-white p-5 shadow-2xl transition-transform lg:hidden", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
            <AppLogo className="mb-8 px-2" />
            <Navigation onNavigate={() => setMobileOpen(false)} />
          </aside>}

          <div className={cn(!isVideoEditor && "lg:pl-[252px]")}>
            {!isVideoEditor && <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200/70 bg-[#f6f8fc]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
              <div className="flex items-center gap-3">
                <button onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
                <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-400 shadow-sm sm:flex">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {host}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link href="/record" className="hidden h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-lg shadow-primary/15 sm:inline-flex"><MonitorUp className="h-4 w-4" /> New recording</Link>
                <div className="rounded-full border-2 border-white shadow-sm"><UserButton /></div>
              </div>
            </header>}
            <main className={cn("w-full", isVideoEditor ? "p-0" : "mx-auto max-w-[1500px] p-4 sm:p-7 lg:p-10")}>{children}</main>
          </div>
        </div>
      </Authenticated>
    </>
  );
}
