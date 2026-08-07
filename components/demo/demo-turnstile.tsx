"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { demoConfig } from "@/lib/config";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export function DemoTurnstile({ onTokenChange }: { onTokenChange: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile || !demoConfig.turnstileSiteKey) return;
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: demoConfig.turnstileSiteKey,
      action: "demo-access",
      theme: "light",
      size: "flexible",
      callback: (token: string) => onTokenChange(token),
      "expired-callback": () => onTokenChange(""),
      "error-callback": () => onTokenChange(""),
    });
    return () => {
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
      onTokenChange("");
    };
  }, [onTokenChange, scriptReady]);

  if (!demoConfig.turnstileSiteKey) {
    return <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">The security check is not configured. Please contact us for demo access.</p>;
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <div ref={containerRef} className="min-h-16 overflow-hidden rounded-xl" aria-label="Security check" />
    </>
  );
}
