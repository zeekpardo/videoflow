"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download, Eye, Loader2, Lock, MessageSquare, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addLocalComment, addLocalReaction, currentLocalFinishedRendition, getLocalVideoByShareToken, listLocalGraphicAssets, recordLocalView, updateLocalViewProgress, type LocalVideo, type LocalVideoGraphicAsset } from "@/lib/local-video-store";
import { verifyLocalPassword } from "@/lib/local-password";
import { stableObjectUrl } from "@/lib/stable-object-url";
import { VideoPlayer } from "@/components/videos/player/video-player";
import { VideoDownloadMenu } from "@/components/videos/video-download-menu";
import { normalizeVideoEditState } from "@/lib/video-edits";
import { buildFinishedTimeline, finishedTimeToSourceMs, sourceTimeToFinishedMs } from "@/convex/lib/videoTimeline";

const reactions = ["👍", "❤️", "🎉", "😮", "👏"];

function viewerKey() {
  const key = "videoflow-local-viewer";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

export function LocalSharePage({ token }: { token: string }) {
  const [video, setVideo] = useState<LocalVideo | null | undefined>(undefined);
  const [graphicAssets, setGraphicAssets] = useState<LocalVideoGraphicAsset[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [guestName, setGuestName] = useState("Guest viewer");
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [activeMs, setActiveMs] = useState(0);
  const lastProgressRef = useRef(0);
  const playerRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let active = true;
    getLocalVideoByShareToken(token).then((row) => {
      if (!active) return;
      setVideo(row);
      const sessionUnlocked = sessionStorage.getItem(`videoflow-local-unlocked:${token}`) === "true";
      setUnlocked(!row?.passwordHash || sessionUnlocked);
    });
    return () => { active = false; };
  }, [token]);

  const videoId = video?.id;
  useEffect(() => {
    if (!videoId || !unlocked) return;
    recordLocalView(token, viewerKey()).then((updated) => updated && setVideo(updated));
    listLocalGraphicAssets(videoId).then(setGraphicAssets).catch(() => setGraphicAssets([]));
  }, [token, unlocked, videoId]);

  const finishedRendition = video ? currentLocalFinishedRendition(video) : null;
  const finishedTimeline = video && finishedRendition ? buildFinishedTimeline(video.durationMs, video.editState) : null;
  const playbackDurationMs = finishedRendition?.durationMs ?? video?.durationMs ?? 0;
  const videoBlob = finishedRendition?.blob ?? video?.videoBlob;
  const thumbnailBlob = video?.thumbnailBlob;
  const videoUrl = stableObjectUrl(videoBlob);
  const thumbnailUrl = stableObjectUrl(thumbnailBlob);
  const screenUrl = stableObjectUrl(finishedRendition ? undefined : video?.screenBlob);
  const cameraUrl = stableObjectUrl(finishedRendition ? undefined : video?.cameraBlob);
  const graphicUrls = finishedRendition ? {} : Object.fromEntries(
    graphicAssets.map((asset) => [asset.assetId, stableObjectUrl(asset.blob)]),
  );

  if (video === undefined) return <div className="grid min-h-screen place-items-center bg-[#f6f8fc]"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!video) return <div className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6"><div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm"><h1 className="text-xl font-bold">Link unavailable</h1><p className="mt-2 text-sm text-slate-500">Test-mode share links exist only in the browser profile where they were created.</p></div></div>;

  const unlock = async () => {
    if (!video.passwordHash || !video.passwordSalt) return setUnlocked(true);
    setUnlocking(true);
    const valid = await verifyLocalPassword(password, video.passwordSalt, video.passwordHash);
    setUnlocking(false);
    if (!valid) return toast.error("Incorrect password");
    sessionStorage.setItem(`videoflow-local-unlocked:${token}`, "true");
    setUnlocked(true);
    toast.success("Video unlocked");
  };

  const react = async (emoji: string) => {
    const sourceTimestampMs = finishedTimeline ? finishedTimeToSourceMs(activeMs, finishedTimeline) : activeMs;
    try { setVideo(await addLocalReaction(token, viewerKey(), emoji, sourceTimestampMs)); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not add reaction"); }
  };

  const submitComment = async () => {
    setCommenting(true);
    try {
      const sourceTimestampMs = finishedTimeline ? finishedTimeToSourceMs(activeMs, finishedTimeline) : activeMs;
      setVideo(await addLocalComment(token, guestName, comment, sourceTimestampMs));
      setComment("");
      toast.success("Comment added");
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not add comment"); }
    finally { setCommenting(false); }
  };

  const simulateViewer = () => {
    localStorage.setItem("videoflow-local-viewer", crypto.randomUUID());
    sessionStorage.removeItem(`videoflow-local-unlocked:${token}`);
    window.location.reload();
  };

  if (!unlocked) return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_28px_90px_rgba(37,44,81,.10)]">
        <AppLogo href="/test" className="justify-center" />
        <span className="mx-auto mb-5 mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Lock className="h-6 w-6" /></span>
        <h1 className="text-2xl font-bold tracking-[-.04em]">This video is protected</h1>
        <p className="mt-2 text-sm text-slate-500">Enter the password to watch this video.</p>
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"><strong>Test mode:</strong> this password is checked only in this browser profile.</p>
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && unlock()} placeholder="Password" className="mt-6 h-11 rounded-xl" />
        <Button onClick={unlock} disabled={unlocking || !password} className="mt-3 h-11 w-full rounded-xl">{unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock video"}</Button>
        <Button variant="ghost" onClick={simulateViewer} className="mt-3 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Simulate a new viewer</Button>
      </div>
    </main>
  );

  const reactionCounts = reactions.map((emoji) => ({ emoji, count: (video.reactions ?? []).filter((reaction) => reaction.emoji === emoji).length }));
  const reactionMoments = [...(video.reactions ?? [])]
    .filter((reaction) => reaction.timestampMs !== undefined)
    .flatMap((reaction) => {
      const timestampMs = finishedTimeline ? sourceTimeToFinishedMs(reaction.timestampMs!, finishedTimeline) : reaction.timestampMs!;
      return timestampMs === null ? [] : [{ ...reaction, timestampMs }];
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const displayedComments = (video.comments ?? []).flatMap((row) => {
    if (row.timestampMs === undefined || !finishedTimeline) return [row];
    const timestampMs = sourceTimeToFinishedMs(row.timestampMs, finishedTimeline);
    return timestampMs === null ? [] : [{ ...row, timestampMs }];
  });
  const seekTo = (timestampMs: number) => { if (playerRef.current) { playerRef.current.currentTime = timestampMs / 1000; playerRef.current.play().catch(() => {}); } };

  return (
    <div className="min-h-screen bg-[#f6f8fc]">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" /> <strong>Test mode.</strong> Everything on this device stays local. AI and real external delivery remain off. This link works only in this browser profile. <button onClick={simulateViewer} className="ml-2 font-bold underline underline-offset-2">Simulate a new viewer</button></div>
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between px-5 sm:px-8"><AppLogo href="/test" /><span className="flex items-center gap-1.5 text-xs text-slate-400"><Eye className="h-3.5 w-3.5" />{video.views?.length ?? 0} viewers</span></div></header>
      <main className="mx-auto grid max-w-[1600px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <VideoPlayer ref={playerRef} src={videoUrl} screenSrc={screenUrl || undefined} cameraSrc={cameraUrl || undefined} poster={thumbnailUrl || undefined} zoomEffects={finishedRendition ? [] : video.zoomEffects ?? []} editState={finishedRendition ? undefined : video.editState} graphicUrls={graphicUrls} wrapperClassName="shadow-[0_20px_60px_rgba(26,31,60,.18)]" onTimeUpdate={(event) => { const position = event.currentTarget.currentTime * 1000; setActiveMs(position); if (position - lastProgressRef.current >= 2000) { lastProgressRef.current = position; updateLocalViewProgress(token, viewerKey(), position); } }} onEnded={() => updateLocalViewProgress(token, viewerKey(), playbackDurationMs)} />
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h1 className="text-2xl font-bold tracking-[-.035em]">{video.title}</h1>{video.description && <p className="mt-2 text-sm leading-6 text-slate-500">{video.description}</p>}{video.cta && <a href={video.cta.url} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-lg shadow-primary/15">{video.cta.label}<ArrowRight className="h-4 w-4" /></a>}<div className="mt-5 flex flex-wrap items-center gap-2">{video.allowReactions && <span className="mr-1 text-xs font-medium text-slate-400">React at {Math.floor(activeMs / 1000)}s</span>}{video.allowReactions && reactionCounts.map(({ emoji, count }) => <button key={emoji} onClick={() => react(emoji)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition hover:border-primary/30 hover:bg-primary/5">{emoji}{count > 0 && <span className="ml-1.5 text-xs text-slate-500">{count}</span>}</button>)}{video.allowDownload && <VideoDownloadMenu title={video.title} mode={video.mode} durationMs={playbackDurationMs} primarySrc={videoUrl} primaryMimeType={finishedRendition?.mimeType ?? video.mimeType} screenSrc={screenUrl || undefined} cameraSrc={cameraUrl || undefined} finishedSrc={finishedRendition ? videoUrl : undefined} finishedMimeType={finishedRendition?.mimeType} graphicUrls={graphicUrls} project={{ editState: normalizeVideoEditState(finishedRendition ? undefined : video.editState, playbackDurationMs, !!screenUrl && !!cameraUrl), zoomEffects: finishedRendition ? [] : video.zoomEffects ?? [] }} scope="viewer" trigger={<button type="button" className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> Download</button>} />}</div>{reactionMoments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{reactionMoments.map((reaction) => <button key={`${reaction.viewerKey}-${reaction.emoji}`} onClick={() => seekTo(reaction.timestampMs)} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{reaction.emoji} {Math.floor(reaction.timestampMs / 1000)}s</button>)}</div>}</div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 text-sm font-bold"><MessageSquare className="h-4 w-4 text-primary" /> Comments <span className="text-slate-400">{displayedComments.length}</span></h2>{video.allowComments ? <><div className="mt-4 space-y-3"><Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Your name" className="h-10 rounded-xl" /><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={`Comment at ${Math.floor(activeMs / 1000)}s…`} rows={3} className="rounded-xl" /><Button onClick={submitComment} disabled={commenting || !comment.trim() || !guestName.trim()} className="w-full rounded-xl">{commenting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> Add comment at {Math.floor(activeMs / 1000)}s</>}</Button></div><div className="mt-5 space-y-4 border-t border-slate-100 pt-5">{displayedComments.length ? displayedComments.map((row) => <div key={row.id}><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-700">{row.guestName}</p>{row.timestampMs !== undefined && <button onClick={() => seekTo(row.timestampMs!)} className="text-[11px] font-medium text-primary">{Math.floor(row.timestampMs / 1000)}s</button>}</div><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-500">{row.body}</p></div>) : <p className="text-xs text-slate-400">No comments yet.</p>}</div></> : <p className="mt-3 text-xs text-slate-400">Comments are disabled for this link.</p>}</div>
        </aside>
      </main>
    </div>
  );
}
