"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VideoOwnerSettingsPanel } from "@/components/videos/video-owner-settings-panel";
import { VideoEditorWorkspace, type EditorProject } from "@/components/videos/video-editor-workspace";
import {
  beginLocalFinishedRendition,
  currentLocalFinishedRendition,
  deleteLocalVideo,
  disableLocalShare,
  enableLocalShare,
  failLocalFinishedRendition,
  finalizeLocalFinishedRendition,
  getLocalVideo,
  listLocalGraphicAssets,
  patchLocalVideo,
  saveLocalEditorProject,
  saveLocalGraphicAsset,
  type LocalVideo,
  type LocalVideoGraphicAsset,
} from "@/lib/local-video-store";
import { createLocalPassword } from "@/lib/local-password";
import { appConfig } from "@/lib/config";
import { stableObjectUrl } from "@/lib/stable-object-url";
import { captureVideoBlobFrame, captureVideoFrame, generateTitleThumbnail, validateThumbnailFile } from "@/lib/video-thumbnail";
import { readVideoGraphicDimensions, validateVideoGraphicFile } from "@/lib/video-assets";

export function LocalVideoEditor({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [video, setVideo] = useState<LocalVideo | null | undefined>(undefined);
  const [graphicAssets, setGraphicAssets] = useState<LocalVideoGraphicAsset[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [ctaBusy, setCtaBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getLocalVideo(videoId), listLocalGraphicAssets(videoId)]).then(([row, assets]) => {
      if (!active) return;
      setVideo(row);
      setGraphicAssets(assets);
      setTitle(row?.title ?? "");
      setDescription(row?.description ?? "");
      setCtaLabel(row?.cta?.label ?? "");
      setCtaUrl(row?.cta?.url ?? "");
    });
    return () => { active = false; };
  }, [videoId]);

  if (video === undefined) {
    return <div className="grid min-h-screen place-items-center bg-[#f6f8fc]"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!video) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6">
        <div className="max-w-md text-center"><h1 className="text-2xl font-bold">Recording not found</h1><p className="mt-2 text-sm text-slate-500">Test-mode recordings exist only in the browser profile where they were created.</p><Button asChild className="mt-5"><Link href="/test?view=library"><ArrowLeft className="h-4 w-4" /> Back to library</Link></Button></div>
      </main>
    );
  }

  const videoUrl = stableObjectUrl(video.videoBlob, `local:${video.id}:video`);
  const screenUrl = stableObjectUrl(video.screenBlob, `local:${video.id}:screen`);
  const cameraUrl = stableObjectUrl(video.cameraBlob, `local:${video.id}:camera`);
  const posterUrl = stableObjectUrl(video.thumbnailBlob);
  const shareUrl = video.shareToken ? `/test/v/${video.shareToken}` : null;
  const graphicUrls = Object.fromEntries(
    graphicAssets.map((asset) => [asset.assetId, stableObjectUrl(asset.blob)]),
  );

  const update = async (patch: Partial<LocalVideo>) => {
    const updated = await patchLocalVideo(video.id, patch);
    setVideo(updated);
    return updated;
  };

  const save = async (project: EditorProject) => {
    const saved = await saveLocalEditorProject(video.id, { editState: project.editState, zoomEffects: project.zoomEffects });
    setVideo(saved);
    return { editRevision: saved.editRevision ?? 0 };
  };

  const addGraphic = async (requested: File) => {
    const file = validateVideoGraphicFile(requested);
    const { width, height } = await readVideoGraphicDimensions(file);
    const assetId = crypto.randomUUID();
    const asset = await saveLocalGraphicAsset(video.id, { assetId, blob: file, width, height });
    setGraphicAssets((current) => [...current.filter((item) => item.assetId !== assetId), asset]);
    return { assetId, url: stableObjectUrl(asset.blob), width, height };
  };

  const currentRendition = currentLocalFinishedRendition(video);
  const publishAdapter = {
    current: !!currentRendition,
    status: video.finishedRenditionStatus,
    error: video.finishedRenditionError,
    prepare: async (project: EditorProject) => {
      const saved = await saveLocalEditorProject(video.id, { editState: project.editState, zoomEffects: project.zoomEffects });
      const editRevision = saved.editRevision ?? 0;
      const rendering = await beginLocalFinishedRendition(video.id, editRevision);
      setVideo(rendering);
      return editRevision;
    },
    complete: async ({ blob, editRevision, durationMs }: { blob: Blob; editRevision: number; durationMs: number }) => {
      setVideo(await finalizeLocalFinishedRendition(video.id, { blob, editRevision, durationMs }));
    },
    fail: async ({ editRevision, message }: { editRevision: number; message: string }) => {
      setVideo(await failLocalFinishedRendition(video.id, editRevision, message));
    },
  } as const;

  const commitTitle = async () => {
    const next = title.trim().slice(0, 200);
    if (!next) {
      setTitle(video.title);
      toast.error("Enter a video title");
      return;
    }
    if (next === video.title) return;
    setTitle(next);
    await update({ title: next });
    toast.success("Title updated");
  };

  const commitDescription = async () => {
    const next = description.trim().slice(0, 5000);
    if (next === (video.description ?? "")) return;
    setDescription(next);
    await update({ description: next || undefined });
    toast.success("Description updated");
  };

  const changeThumbnail = async (create: () => Promise<Blob>) => {
    setThumbnailBusy(true);
    try {
      await update({ thumbnailBlob: await create() });
      toast.success("Thumbnail updated");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update thumbnail");
    } finally {
      setThumbnailBusy(false);
    }
  };

  const toggleShare = async (enabled: boolean) => {
    setShareBusy(true);
    try {
      const updated = enabled ? await enableLocalShare(video.id) : await disableLocalShare(video.id);
      setVideo(updated);
      toast.success(enabled ? "Share link enabled in this browser" : "Share link disabled");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update sharing");
    } finally {
      setShareBusy(false);
    }
  };

  const regenerateShare = async () => {
    setShareBusy(true);
    try {
      setVideo(await enableLocalShare(video.id));
      toast.success("A new share link was created");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not create a new link");
    } finally {
      setShareBusy(false);
    }
  };

  const setSharePassword = async () => {
    setPasswordBusy(true);
    try {
      await update(await createLocalPassword(password));
      setPassword("");
      toast.success("Password protection enabled");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not set password");
    } finally {
      setPasswordBusy(false);
    }
  };

  const removeSharePassword = async () => {
    setPasswordBusy(true);
    try {
      await update({ passwordHash: undefined, passwordSalt: undefined });
      toast.success("Password protection removed");
    } finally {
      setPasswordBusy(false);
    }
  };

  const saveCta = async () => {
    const label = ctaLabel.trim();
    const rawUrl = ctaUrl.trim();
    setCtaBusy(true);
    try {
      if (!label && !rawUrl) {
        await update({ cta: undefined });
        toast.success("Call to action removed");
        return;
      }
      if (!label || !rawUrl) throw new Error("Enter both a button label and URL");
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Call to action must use http or https");
      const cta = { label: label.slice(0, 80), url: url.toString() };
      await update({ cta });
      setCtaLabel(cta.label);
      setCtaUrl(cta.url);
      toast.success("Call to action saved");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save the call to action");
    } finally {
      setCtaBusy(false);
    }
  };

  const removeVideo = async () => {
    if (!window.confirm(`Delete “${video.title}” from this browser?`)) return;
    setDeleteBusy(true);
    try {
      await deleteLocalVideo(video.id);
      toast.success("Video deleted");
      router.push("/test?view=library");
    } catch (caught) {
      setDeleteBusy(false);
      toast.error(caught instanceof Error ? caught.message : "Could not delete video");
    }
  };

  const views = video.views ?? [];
  const completedViews = views.filter((view) => view.completed).length;
  const viewers = new Set(views.map((view) => view.viewerKey)).size;
  const avgPercentWatched = views.length ? Math.round(views.reduce((sum, view) => sum + view.percentWatched, 0) / views.length) : 0;
  const completionRate = views.length ? Math.round(completedViews / views.length * 100) : 0;
  const absoluteShareUrl = video.shareToken && typeof window !== "undefined" ? `${window.location.origin}/test/v/${video.shareToken}` : undefined;

  const ownerSettings = (
    <VideoOwnerSettingsPanel
      title={title}
      description={description}
      onTitleChange={setTitle}
      onDescriptionChange={setDescription}
      onTitleCommit={commitTitle}
      onDescriptionCommit={commitDescription}
      onThumbnailCurrentFrame={() => changeThumbnail(async () => {
        if (!playerRef.current) throw new Error("Video preview is not ready");
        return captureVideoFrame(playerRef.current);
      })}
      onThumbnailUpload={() => thumbnailInputRef.current?.click()}
      onThumbnailTitleCard={() => changeThumbnail(async () => generateTitleThumbnail(
        await captureVideoBlobFrame(video.videoBlob, video.durationMs),
        title.trim() || video.title,
        appConfig.brandColor,
      ))}
      thumbnailBusy={thumbnailBusy}
      shareEnabled={!!video.shareToken}
      onShareEnabledChange={toggleShare}
      shareUrl={absoluteShareUrl}
      onCopyShareUrl={absoluteShareUrl ? async () => { await navigator.clipboard.writeText(absoluteShareUrl); toast.success("Share link copied"); } : undefined}
      onOpenShareUrl={absoluteShareUrl ? () => window.open(absoluteShareUrl, "_blank") : undefined}
      onRegenerateShareUrl={absoluteShareUrl ? regenerateShare : undefined}
      shareBusy={shareBusy}
      allowComments={video.allowComments !== false}
      onAllowCommentsChange={async (allowed) => { await update({ allowComments: allowed }); }}
      allowReactions={video.allowReactions !== false}
      onAllowReactionsChange={async (allowed) => { await update({ allowReactions: allowed }); }}
      allowDownload={video.allowDownload === true}
      onAllowDownloadChange={async (allowed) => { await update({ allowDownload: allowed }); }}
      passwordActive={!!video.passwordHash}
      passwordValue={password}
      onPasswordValueChange={setPassword}
      onSetPassword={setSharePassword}
      onRemovePassword={removeSharePassword}
      passwordBusy={passwordBusy}
      passwordNote="PBKDF2-hashed in this browser. Test-mode passwords are not a server security boundary."
      cta={{
        label: ctaLabel,
        url: ctaUrl,
        onLabelChange: setCtaLabel,
        onUrlChange: setCtaUrl,
        onSave: saveCta,
        busy: ctaBusy,
      }}
      analytics={{ views: views.length, viewers, avgPercentWatched, completionRate, completedViews }}
      activityContent={<p className="text-xs leading-5 text-slate-500">{video.comments?.length ?? 0} comments and {video.reactions?.length ?? 0} reactions on this browser-only share page.</p>}
      onDelete={removeVideo}
      deleteBusy={deleteBusy}
      localMode
      localModeNote="Everything on this device stays local. AI and real external delivery remain off."
    />
  );

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void changeThumbnail(async () => validateThumbnailFile(file));
          event.currentTarget.value = "";
        }}
      />
      <main className="w-full">
        <VideoEditorWorkspace
          key={video.id}
          videoKey={video.id}
          title={video.title}
          mode={video.mode}
          durationMs={video.durationMs}
          src={videoUrl}
          sourceMimeType={video.mimeType}
          screenSrc={screenUrl || undefined}
          cameraSrc={cameraUrl || undefined}
          poster={posterUrl || undefined}
          initialEditState={video.editState}
          initialZoomEffects={video.zoomEffects}
          transcript={{ status: "none", localMode: true }}
          backHref="/test?view=library"
          environmentLabel="Test mode editor"
          className="min-h-[100dvh] lg:h-[100dvh] lg:min-h-[720px]"
          onSave={save}
          onPlayerReady={(player) => { playerRef.current = player; }}
          ownerSettings={ownerSettings}
          graphicUrls={graphicUrls}
          onUploadGraphic={addGraphic}
          publishAdapter={publishAdapter}
          headerActions={<><span title="Everything on this device stays local. AI and real external delivery remain off." className="hidden h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 sm:inline-flex"><ShieldCheck className="h-3.5 w-3.5" /> Test mode</span>{shareUrl && <Button asChild size="sm" className="h-9"><Link href={shareUrl} target="_blank"><ExternalLink className="h-3.5 w-3.5" /> Viewer preview</Link></Button>}</>}
        />
      </main>
    </div>
  );
}
