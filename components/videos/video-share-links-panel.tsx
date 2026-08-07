"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BellRing, CalendarCheck2, CheckCircle2, Copy, ExternalLink, Link2, Loader2, Lock, Plus, RefreshCw, Save, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { appConfig } from "@/lib/config";

type ShareLink = FunctionReturnType<typeof api.videoFlowV2.listShareLinks>[number];
type ReviewRequest = FunctionReturnType<typeof api.videoFlowV2.listReviewRequests>[number];

function ReviewRequestCard({ request, origin }: { request: ReviewRequest; origin: string }) {
  const updateLink = useMutation(api.videoFlowV2.updateShareLink);
  const remind = useMutation(api.videoFlowV2.remindReviewRequest);
  const cancel = useMutation(api.videoFlowV2.cancelReviewRequest);
  const setPassword = useAction(api.videoFlowV2Actions.setShareLinkPassword);
  const [busy, setBusy] = useState(false);
  const url = request.token ? `${origin}/v/${request.token}` : "";
  const status = request.status === "approved" ? "Approved" : request.status === "changes_requested" ? "Changes requested" : request.status === "canceled" ? "Canceled" : "Waiting for review";
  const StatusIcon = request.status === "approved" ? CheckCircle2 : request.status === "changes_requested" ? TriangleAlert : request.status === "canceled" ? XCircle : CalendarCheck2;
  return <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
    <div className="flex items-start gap-2"><StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${request.status === "approved" ? "text-emerald-500" : request.status === "changes_requested" ? "text-amber-500" : "text-primary"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{request.recipientName}</p><p className="truncate text-[10px] text-slate-400">{request.recipientEmail}</p></div><span className="text-[10px] font-semibold text-slate-500">{status}</span></div>
    {request.message && <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-slate-500">{request.message}</p>}
    {request.responseNote && <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[11px] leading-4 text-slate-600"><strong>{request.responseName ?? "Reviewer"}:</strong> {request.responseNote}</p>}
    <p className="mt-2 text-[10px] text-slate-400">{request.dueAt ? `Due ${new Date(request.dueAt).toLocaleDateString()}` : "No due date"}{request.reminderCount ? ` · ${request.reminderCount} reminder${request.reminderCount === 1 ? "" : "s"}` : ""}</p>
    <div className="mt-3 grid grid-cols-2 gap-2"><label className="flex items-center justify-between rounded-lg bg-white px-2 py-2 text-[10px] text-slate-600"><span>Verify assigned email</span><Switch checked={request.requireEmail} disabled={busy} onCheckedChange={async (requireEmail) => { setBusy(true); try { await updateLink({ shareLinkId: request.shareLinkId, requireEmail }); toast.success(requireEmail ? "Email verification enabled" : "Email verification disabled"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update review access"); } finally { setBusy(false); } }} /></label><Button size="sm" variant="outline" className="h-auto min-h-8 text-[10px]" disabled={busy} onClick={async () => { const password = window.prompt(request.hasPassword ? "Enter a replacement password, or leave blank to remove" : "Password (at least 8 characters)"); if (password === null) return; setBusy(true); try { await setPassword({ shareLinkId: request.shareLinkId, password: password || null }); toast.success(password ? "Review password set" : "Review password removed"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update review password"); } finally { setBusy(false); } }}>{request.hasPassword ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}{request.hasPassword ? "Replace password" : "Add password"}</Button></div>
    <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="h-8 flex-1" disabled={!url} onClick={async () => { await navigator.clipboard.writeText(url); toast.success("Review link copied"); }}><Copy className="h-3.5 w-3.5" />Copy link</Button><Button size="sm" variant="outline" className={`h-8 flex-1 ${request.linkStatus === "active" ? "text-red-500" : "text-emerald-600"}`} disabled={busy} onClick={async () => { setBusy(true); try { await updateLink({ shareLinkId: request.shareLinkId, status: request.linkStatus === "active" ? "revoked" : "active" }); toast.success(request.linkStatus === "active" ? "Review link revoked" : "Review link restored"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update review link"); } finally { setBusy(false); } }}>{request.linkStatus === "active" ? "Revoke" : "Restore"}</Button></div>
    {request.status === "pending" && <div className="mt-2 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" className="h-8" disabled={busy || request.linkStatus !== "active"} onClick={async () => { setBusy(true); try { await remind({ reviewRequestId: request._id }); toast.success("Review reminder sent"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not send reminder"); } finally { setBusy(false); } }}><BellRing className="h-3.5 w-3.5" />Remind</Button><Button size="sm" variant="outline" className="h-8 text-red-500" disabled={busy} onClick={async () => { if (!window.confirm(`Cancel the review request for ${request.recipientName}?`)) return; setBusy(true); try { await cancel({ reviewRequestId: request._id }); toast.success("Review request canceled"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not cancel review"); } finally { setBusy(false); } }}><XCircle className="h-3.5 w-3.5" />Cancel</Button></div>}
  </div>;
}

function ReviewRequests({ videoId, origin }: { videoId: Id<"videos">; origin: string }) {
  const requests = useQuery(api.videoFlowV2.listReviewRequests, { videoId });
  const create = useMutation(api.videoFlowV2.createReviewRequest);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!recipientName.trim() || !recipientEmail.trim()) return toast.error("Reviewer name and email are required");
    setBusy(true);
    try {
      const result = await create({ videoId, recipientName, recipientEmail, message: message || undefined, dueAt: due ? new Date(`${due}T23:59:59`).getTime() : undefined });
      await navigator.clipboard.writeText(`${origin}/v/${result.token}`).catch(() => {});
      setRecipientName(""); setRecipientEmail(""); setMessage(""); setDue("");
      toast.success("Review request created and link copied");
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create review request"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/[.03] p-3">
    <div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><CalendarCheck2 className="h-4 w-4 text-primary" />No-login review requests</h3><p className="mt-1 text-xs leading-5 text-slate-500">Send a private link that lets one reviewer approve the video or request changes without an account.</p></div>
    <div className="grid grid-cols-2 gap-2"><Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="h-8 text-xs" placeholder="Reviewer name" /><Input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} className="h-8 text-xs" placeholder="Reviewer email" /></div>
    <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={2_000} className="text-xs" placeholder="Optional review instructions" />
    <div className="flex gap-2"><Input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="h-8 flex-1 text-xs" aria-label="Review due date" /><Button size="sm" className="h-8 flex-1" disabled={busy} onClick={() => void submit()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck2 className="h-3.5 w-3.5" />}Request review</Button></div>
    {requests === undefined ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-primary" /> : requests.map((request) => <ReviewRequestCard key={request._id} request={request} origin={origin} />)}
  </div>;
}

function LinkEditor({ link, origin }: { link: ShareLink; origin: string }) {
  const update = useMutation(api.videoFlowV2.updateShareLink);
  const rotate = useMutation(api.videoFlowV2.rotateShareLink);
  const setPassword = useAction(api.videoFlowV2Actions.setShareLinkPassword);
  const [name, setName] = useState(link.name);
  const [expires, setExpires] = useState(link.expiresAt ? new Date(link.expiresAt).toISOString().slice(0, 16) : "");
  const [maxViews, setMaxViews] = useState(link.maxViews ? String(link.maxViews) : "");
  const [domains, setDomains] = useState(link.allowedDomains.join(", "));
  const [embedDomains, setEmbedDomains] = useState(link.embedDomains.join(", "));
  const [busy, setBusy] = useState(false);
  const url = `${origin}/v/${link.token}`;

  const patch = async (values: Parameters<typeof update>[0], message?: string) => {
    setBusy(true);
    try { await update(values); if (message) toast.success(message); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update share link"); }
    finally { setBusy(false); }
  };

  return <details className="rounded-xl border border-slate-200 bg-slate-50/60">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3"><span className={`h-2 w-2 rounded-full ${link.status === "active" ? "bg-emerald-400" : "bg-slate-300"}`} /><span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{link.name}</span><span className="text-[10px] text-slate-400">{link.viewCount} views</span></summary>
    <div className="space-y-3 border-t border-slate-200 p-3">
      <div className="flex gap-2"><Input value={url} readOnly className="h-8 min-w-0 text-[10px]" /><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={async () => { await navigator.clipboard.writeText(url); toast.success("Link copied"); }}><Copy className="h-3.5 w-3.5" /></Button><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => window.open(url, "_blank")}><ExternalLink className="h-3.5 w-3.5" /></Button></div>
      <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8 text-xs" placeholder="Link name" />
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Expires<Input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} className="mt-1 h-8 text-[10px]" /></label><label className="text-[10px] text-slate-500">Maximum views<Input type="number" min={1} value={maxViews} onChange={(event) => setMaxViews(event.target.value)} className="mt-1 h-8 text-[10px]" /></label></div>
      <Input value={domains} onChange={(event) => setDomains(event.target.value)} className="h-8 text-xs" placeholder="Allowed email domains" />
      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">{[
        ["Email gate", link.requireEmail, "requireEmail"], ["Comments", link.allowComments, "allowComments"], ["Reactions", link.allowReactions, "allowReactions"], ["Downloads", link.allowDownload, "allowDownload"], ["Embedding", link.allowEmbed, "allowEmbed"],
      ].map(([label, checked, field]) => <label key={String(field)} className="flex items-center justify-between rounded-lg bg-white px-2 py-2"><span>{String(label)}</span><Switch checked={Boolean(checked)} disabled={busy} onCheckedChange={(value) => void patch({ shareLinkId: link._id, [String(field)]: value })} /></label>)}</div>
      {link.allowEmbed && <Input value={embedDomains} onChange={(event) => setEmbedDomains(event.target.value)} className="h-8 text-xs" placeholder="Allowed embed domains" />}
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void patch({ shareLinkId: link._id, name, expiresAt: expires ? new Date(expires).getTime() : null, maxViews: maxViews ? Number(maxViews) : null, allowedDomains: domains.split(","), embedDomains: embedDomains.split(",") }, "Share controls saved")}><Save className="h-3.5 w-3.5" />Save</Button><Button size="sm" variant="outline" disabled={busy} onClick={async () => { const password = window.prompt(link.hasPassword ? "Enter a replacement password, or leave blank to remove" : "Password (at least 8 characters)"); if (password === null) return; setBusy(true); try { await setPassword({ shareLinkId: link._id, password: password || null }); toast.success(password ? "Password set" : "Password removed"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update password"); } finally { setBusy(false); } }}>{link.hasPassword ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}Password</Button><Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await rotate({ shareLinkId: link._id }); toast.success("Link rotated"); } finally { setBusy(false); } }}><RefreshCw className="h-3.5 w-3.5" />Rotate</Button><Button size="sm" variant="outline" disabled={busy} className={link.status === "active" ? "text-red-500" : "text-emerald-600"} onClick={() => void patch({ shareLinkId: link._id, status: link.status === "active" ? "revoked" : "active" }, link.status === "active" ? "Link revoked" : "Link restored")}>{link.status === "active" ? "Revoke" : "Restore"}</Button></div>
    </div>
  </details>;
}

export function VideoShareLinksPanel({ videoId, origin }: { videoId: Id<"videos">; origin: string }) {
  const links = useQuery(api.videoFlowV2.listShareLinks, { videoId });
  const reviewRequests = useQuery(api.videoFlowV2.listReviewRequests, appConfig.features.reviewRequests ? { videoId } : "skip");
  const create = useMutation(api.videoFlowV2.createShareLink);
  const [busy, setBusy] = useState(false);
  const reviewLinkIds = new Set((reviewRequests ?? []).map((request) => String(request.shareLinkId)));
  const ordinaryLinks = links === undefined || (appConfig.features.reviewRequests && reviewRequests === undefined)
    ? undefined
    : links.filter((link) => !reviewLinkIds.has(String(link._id)));
  return <div className="space-y-3">
    {appConfig.features.reviewRequests && <ReviewRequests videoId={videoId} origin={origin} />}
    <div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Link2 className="h-4 w-4 text-primary" />V2 share links</h3><p className="mt-1 text-xs leading-5 text-slate-500">Create separate links for reviewers, customers, embeds, or public campaigns.</p></div>
    {ordinaryLinks === undefined ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-primary" /> : ordinaryLinks.map((link) => <LinkEditor key={link._id} link={link} origin={origin} />)}
    <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={async () => { const name = window.prompt("Share link name", "Customer link"); if (!name) return; setBusy(true); try { await create({ videoId, name }); toast.success("Share link created"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create link"); } finally { setBusy(false); } }}><Plus className="h-3.5 w-3.5" />Create controlled link</Button>
  </div>;
}
