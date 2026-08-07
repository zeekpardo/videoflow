"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { DemoPurchaseBar } from "@/components/demo/demo-purchase-bar";
import { DemoTurnstile } from "@/components/demo/demo-turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoConfig } from "@/lib/config";
import { clearExpiredDemoMediaStorage } from "@/lib/demo-video-store";
import { demoAnalyticsContext } from "@/lib/demo-analytics";

type Step = "identity" | "code";

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; redirectTo?: string; challengeToken?: string; resendAvailableAt?: number };
  if (!response.ok) throw new Error(payload.error || payload.message || "Something went wrong. Please try again.");
  return payload;
}

export function DemoAccessForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  useEffect(() => {
    // A closed tab cannot erase IndexedDB at the instant its cookie expires.
    // The access screen is the next safe opportunity to clear an expired demo.
    void clearExpiredDemoMediaStorage().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (step !== "code" || resendAvailableAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt, step]);

  const sendCode = async () => {
    if (!name.trim() || !email.trim() || !acceptedTerms || !turnstileToken) return;
    setBusy(true); setError(null);
    try {
      const payload = await post("/api/demo/request-code", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        acceptedTerms,
        marketingConsent,
        website,
        turnstileToken,
        analytics: demoAnalyticsContext(),
      });
      if (!payload.challengeToken) throw new Error("The access email could not be prepared. Please try again.");
      setChallengeToken(payload.challengeToken);
      setResendAvailableAt(payload.resendAvailableAt ?? Date.now());
      setNow(Date.now());
      setCode("");
      setStep("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the access code");
    } finally {
      setTurnstileToken("");
      setTurnstileResetKey((value) => value + 1);
      setBusy(false);
    }
  };

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendCode();
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || !challengeToken) return;
    setBusy(true); setError(null);
    try {
      const payload = await post("/api/demo/verify-code", { challengeToken, code, analytics: demoAnalyticsContext() });
      router.replace(payload.redirectTo || "/demo");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code could not be verified");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
      <DemoPurchaseBar />
      <main className="grid min-h-[calc(100vh-53px)] place-items-center px-5 py-10">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_32px_100px_rgba(31,38,70,.12)] lg:grid-cols-[1.05fr_.95fr]">
          <section className="hidden min-h-[580px] bg-[radial-gradient(circle_at_30%_10%,rgba(139,92,246,.32),transparent_40%),linear-gradient(145deg,#13162b,#262451_55%,#5138a6)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <AppLogo href="/demo/access" className="[&_span]:text-white" />
            <div><span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5" /> Private product preview</span><h1 className="mt-5 max-w-md text-4xl font-bold tracking-[-.05em]">Record, edit, and experience VideoFlow before you buy.</h1><p className="mt-4 max-w-md text-sm leading-7 text-white/65">This guided demo runs entirely in your browser. Your recordings are never uploaded, and public delivery is disabled.</p></div>
            <p className="text-xs text-white/45">Access is verified by a one-time six-digit email code.</p>
          </section>
          <section className="flex min-h-[580px] flex-col justify-center p-7 sm:p-12">
            <div className="lg:hidden"><AppLogo href="/demo/access" /></div>
            <p className="mt-10 text-[11px] font-bold uppercase tracking-[.2em] text-primary lg:mt-0">VideoFlow demo</p>
            <h2 className="mt-3 text-3xl font-bold tracking-[-.04em]">{step === "identity" ? "Get private access" : "Check your inbox"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{step === "identity" ? "Enter your details and we’ll email a one-time access code." : `We sent a six-digit code to ${email}.`}</p>

            {step === "identity" ? (
              <form className="mt-8 space-y-4" onSubmit={requestCode}>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                  <span>Name</span>
                  <Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" maxLength={120} required className="h-11 rounded-xl" />
                </label>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                  <span>Work email</span>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" maxLength={254} required className="h-11 rounded-xl pl-10" />
                  </div>
                </label>
                <label className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                  Website
                  <Input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs leading-5 text-slate-600">
                  <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                  <span>I agree to the 72-hour demo terms and receive the one-time access email.{demoConfig.privacyUrl && <> Read the <a href={demoConfig.privacyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">privacy notice</a>.</>}</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 px-1 text-xs leading-5 text-slate-500">
                  <input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                  <span>Also send me occasional VideoFlow product tips and offers. I can unsubscribe at any time. <span className="font-semibold text-slate-400">Optional</span></span>
                </label>
                <DemoTurnstile key={turnstileResetKey} onTokenChange={handleTurnstileToken} />
                <Button type="submit" disabled={busy || !name.trim() || !email.trim() || !acceptedTerms || !turnstileToken} className="h-11 w-full rounded-xl font-bold">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Email my code <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </form>
            ) : (
              <form className="mt-8 space-y-4" onSubmit={verifyCode}>
                <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                  <span>Six-digit code</span>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6} required className="h-14 rounded-xl pl-11 text-center font-mono text-2xl font-bold tracking-[.35em]" />
                  </div>
                </label>
                <Button type="submit" disabled={busy || !challengeToken || !/^\d{6}$/.test(code)} className="h-11 w-full rounded-xl font-bold">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Open the demo <ArrowRight className="h-4 w-4" /></>}
                </Button>
                <div className="flex items-center justify-center gap-3 text-xs font-semibold">
                  <button type="button" disabled={busy || now < resendAvailableAt} className="text-primary disabled:cursor-not-allowed disabled:text-slate-400" onClick={() => { setStep("identity"); setCode(""); setChallengeToken(""); setError("Complete the security check again to resend your code."); }}>{now < resendAvailableAt ? `Resend in ${Math.max(1, Math.ceil((resendAvailableAt - now) / 1_000))}s` : "Resend code"}</button>
                  <span className="text-slate-300">·</span>
                  <button type="button" className="text-slate-500 hover:text-primary" onClick={() => { setStep("identity"); setCode(""); setChallengeToken(""); setError(null); }}>Use a different email</button>
                </div>
              </form>
            )}
            {error && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-600">{error}</p>}
            <p className="mt-7 text-center text-[11px] leading-5 text-slate-400">The code expires after 10 minutes. Your private 72-hour demo starts only after verification.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
