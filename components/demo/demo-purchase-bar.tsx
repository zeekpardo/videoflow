"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const DEMO_DISCLOSURE = "Test mode — Recording, editing, and publishing stay local. AI is optional: after consent, only the first 60 seconds of audio or the caption transcript is sent for processing.";

export function DemoPurchaseBar({ compact = false, className }: { compact?: boolean; className?: string }) {
  const purchaseUrl = process.env.NEXT_PUBLIC_DEMO_PURCHASE_URL;
  return (
    <div className={cn("relative z-50 border-b border-violet-200/70 bg-[linear-gradient(90deg,#f5f3ff,#eef2ff,#faf5ff)] text-slate-900", className)}>
      <div className={cn("mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-2 px-4 py-2.5 sm:flex-row sm:px-6", compact && "lg:px-4") }>
        <p className="flex min-w-0 items-center gap-2 text-center text-xs font-semibold text-slate-700 sm:text-left">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary text-white"><Sparkles className="h-3.5 w-3.5" /></span>
          <span className="truncate sm:whitespace-normal">You’re exploring the private VideoFlow product demo.</span>
        </p>
        {purchaseUrl ? (
          <a href={purchaseUrl} data-demo-analytics="purchase" target="_blank" rel="noopener noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white shadow-sm shadow-primary/20 transition hover:-translate-y-px hover:shadow-md">
            Get VideoFlow <ArrowRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="rounded-lg border border-violet-200 bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-slate-500">Purchase link available from the seller</span>
        )}
      </div>
    </div>
  );
}

export function DemoDisclosure({ className }: { className?: string }) {
  return <div role="status" className={cn("rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold leading-5 text-amber-800", className)}>{DEMO_DISCLOSURE}</div>;
}

export function DemoTimeRemaining({ expiresAt, className }: { expiresAt: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const label = minutes >= 24 * 60
    ? `${Math.ceil(minutes / (24 * 60))}d left`
    : minutes >= 60
      ? `${Math.ceil(minutes / 60)}h left`
      : `${minutes}m left`;
  return <span title={`Demo access ends ${new Date(expiresAt).toLocaleString()}`} className={cn("whitespace-nowrap text-xs font-semibold text-slate-500", className)}>Demo · {label}</span>;
}
