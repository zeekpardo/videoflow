"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, ChevronRight, Copy, ExternalLink, Loader2, Plus, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { appConfig } from "@/lib/config";

const ZERNIO_PLATFORMS = [
  ["twitter", "X / Twitter"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"],
  ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["bluesky", "Bluesky"], ["threads", "Threads"],
  ["reddit", "Reddit"], ["pinterest", "Pinterest"], ["telegram", "Telegram"], ["snapchat", "Snapchat"],
  ["googlebusiness", "Google Business"], ["discord", "Discord"],
] as const;
type ZernioPlatform = typeof ZERNIO_PLATFORMS[number][0];
type SocialProvider = "youtube" | "linkedin" | "zernio";

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function VideoSocialPublishing({ videoId, defaultTitle }: { videoId: Id<"videos">; defaultTitle: string }) {
  const connections = useQuery(api.videoFlowV2.listSocialConnections, {});
  const jobs = useQuery(api.videoFlowV2.listSocialPublishJobs, { videoId });
  const createConnection = useMutation(api.videoFlowV2.createSocialConnection);
  const updateConnection = useMutation(api.videoFlowV2.updateSocialConnection);
  const enqueue = useMutation(api.videoFlowV2.enqueueSocialPublish);
  const cancel = useMutation(api.videoFlowV2.cancelSocialPublish);
  const [provider, setProvider] = useState<SocialProvider>("youtube");
  const [targetPlatform, setTargetPlatform] = useState<ZernioPlatform>("instagram");
  const [connectionName, setConnectionName] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [lastSetup, setLastSetup] = useState<{ connectionId: string; secret: string; provider: SocialProvider } | null>(null);
  const availableConnections = connections?.filter((connection) => connection.provider !== "zernio" || appConfig.features.zernioSocial);

  const addConnection = async () => {
    const secret = randomSecret();
    setBusy(true);
    try {
      const connectionId = await createConnection({
        provider,
        name: connectionName || (provider === "youtube" ? "YouTube" : provider === "linkedin" ? "LinkedIn" : `Zernio · ${targetPlatform}`),
        accountRef: accountRef || undefined,
        targetPlatform: provider === "zernio" ? targetPlatform : undefined,
        workerBindingSecret: secret,
      });
      setLastSetup({ connectionId: String(connectionId), secret, provider });
      setConnectionName("");
      setAccountRef("");
      toast.success("Connection record created—configure its worker next");
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create social connection"); }
    finally { setBusy(false); }
  };

  return <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white">
    <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Share2 className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">Social publishing</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-400">Queue a current MP4 for an owner-bound YouTube or LinkedIn worker.</span></span><ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" /></summary>
    <div className="space-y-3 border-t border-slate-100 p-3.5">
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] leading-4 text-indigo-800"><strong className="block">Provider tokens stay on the worker</strong>VideoFlow stores only this owner’s connection metadata and a hash of the worker-binding secret. Direct access tokens and optional Zernio API keys never enter the browser or Convex database.</div>
      <div className="grid grid-cols-2 gap-2"><select value={provider} onChange={(event) => setProvider(event.target.value as SocialProvider)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="youtube">YouTube direct</option><option value="linkedin">LinkedIn direct</option>{appConfig.features.zernioSocial && <option value="zernio">Zernio</option>}</select><Input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} className="h-9 text-xs" placeholder="Connection name" /></div>
      {provider === "linkedin" && <Input value={accountRef} onChange={(event) => setAccountRef(event.target.value)} className="h-9 text-xs" placeholder="urn:li:person:… or urn:li:organization:…" />}
      {provider === "zernio" && <div className="grid grid-cols-2 gap-2"><select value={targetPlatform} onChange={(event) => setTargetPlatform(event.target.value as ZernioPlatform)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs">{ZERNIO_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Input value={accountRef} onChange={(event) => setAccountRef(event.target.value)} className="h-9 text-xs" placeholder="Zernio account ID" /></div>}
      {provider === "zernio" && <p className="text-[10px] leading-4 text-slate-400">Connect the social account in Zernio first, then copy its <code>_id</code> from Zernio’s account list. One VideoFlow connection targets one platform/account pair.</p>}
      <Button size="sm" variant="outline" className="w-full" disabled={busy || (provider === "zernio" && !accountRef.trim())} onClick={() => void addConnection()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Create worker-bound connection</Button>
      {lastSetup && <div className="rounded-lg bg-slate-950 p-3 text-[10px] leading-5 text-slate-200"><div className="flex items-center justify-between"><strong>Copy now—this secret is shown once</strong><button type="button" onClick={async () => { await navigator.clipboard.writeText(`SOCIAL_CONNECTION_ID=${lastSetup.connectionId}\nSOCIAL_CONNECTION_SECRET=${lastSetup.secret}\n${lastSetup.provider === "zernio" ? "ZERNIO_API_KEY" : "SOCIAL_PROVIDER_ACCESS_TOKEN"}=replace_me`); toast.success("Worker settings copied"); }}><Copy className="h-3.5 w-3.5" /></button></div><code className="mt-2 block break-all">SOCIAL_CONNECTION_ID={lastSetup.connectionId}<br />SOCIAL_CONNECTION_SECRET={lastSetup.secret}<br />{lastSetup.provider === "zernio" ? "ZERNIO_API_KEY" : "SOCIAL_PROVIDER_ACCESS_TOKEN"}=replace_me</code></div>}
      {!!availableConnections?.length && <div className="space-y-3 border-t border-slate-100 pt-3"><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="h-9 text-xs" placeholder="Social title" /><Textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2_200} rows={3} className="text-xs" placeholder="Caption or description" /><select value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="private">Private / connections</option><option value="unlisted">Unlisted (YouTube)</option><option value="public">Public</option></select><p className="text-[9px] leading-4 text-slate-400">Privacy is applied by direct providers and Zernio→YouTube. Other Zernio destinations follow their connected account and platform rules.</p>{availableConnections.map((connection) => <div key={connection._id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-slate-700">{connection.name}</span><span className="block text-[9px] capitalize text-slate-400">{connection.provider}{connection.targetPlatform ? ` → ${connection.targetPlatform}` : ""} · {connection.status}</span></span><Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => void updateConnection({ connectionId: connection._id, status: connection.status === "active" ? "disabled" : "active" })}>{connection.status === "active" ? "Disable" : "Enable"}</Button><Button size="sm" className="h-7 px-2 text-[10px]" disabled={connection.status !== "active"} onClick={async () => { if (!window.confirm(`Publish the current MP4 to ${connection.name}?`)) return; try { await enqueue({ videoId, connectionId: connection._id, title, caption, privacy }); toast.success("Social publish queued"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not queue social publish"); } }}><Send className="h-3 w-3" />Publish</Button></div>)}</div>}
      <div className="space-y-2">{jobs?.map((job) => <div key={job._id} className="rounded-lg border border-slate-200 p-2.5"><div className="flex items-center gap-2"><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-[11px] font-semibold capitalize text-slate-700">{job.status === "published" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}{job.provider} · {job.status.replace("_", " ")}</span><span className="block truncate text-[9px] text-slate-400">{job.title}</span></span>{job.providerPostUrl && <a href={job.providerPostUrl} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}{!["published", "failed", "canceled", "superseded"].includes(job.status) && <button type="button" onClick={() => void cancel({ jobId: job._id })} className="text-[10px] font-semibold text-red-500">Cancel</button>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>{job.errorMessage && <p className="mt-1 text-[9px] text-red-500">{job.errorMessage}</p>}</div>)}</div>
    </div>
  </details>;
}
