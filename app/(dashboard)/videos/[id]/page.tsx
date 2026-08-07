"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCircle2, ExternalLink, Eye, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { VideoEditorWorkspace, type EditorProject } from "@/components/videos/video-editor-workspace";
import { VideoOwnerSettingsPanel } from "@/components/videos/video-owner-settings-panel";
import { VideoShareLinksPanel } from "@/components/videos/video-share-links-panel";
import { VideoV2Panel } from "@/components/videos/video-v2-panel";
import { useResumableUpload } from "@/components/videos/use-resumable-upload";
import { appConfig } from "@/lib/config";
import { useBrowserOrigin } from "@/lib/use-browser-origin";
import { captureVideoFrame, captureVideoFrameAt, generateTitleThumbnail, validateThumbnailFile } from "@/lib/video-thumbnail";
import { readVideoGraphicDimensions, validateVideoGraphicFile } from "@/lib/video-assets";
import { videoFilename } from "@/lib/media-format";

type VideoGet = NonNullable<FunctionReturnType<typeof api.videos.get>>;

export default function VideoDetailPage() {
  const router = useRouter();
  const params = useParams();
  const videoId = params.id as Id<"videos">;
  const video = useQuery(api.videos.get, { videoId });
  const [leavingAfterDelete, setLeavingAfterDelete] = useState(false);

  if (leavingAfterDelete) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Returning to your video library…
      </div>
    );
  }

  if (video === undefined) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (video === null) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Video not found.</p>
        <Button variant="link" onClick={() => router.push("/videos")}>Back to videos</Button>
      </div>
    );
  }
  return <VideoDetail key={videoId} video={video} videoId={videoId} onDeleteStateChange={setLeavingAfterDelete} />;
}

function VideoDetail({ video, videoId, onDeleteStateChange }: { video: VideoGet; videoId: Id<"videos">; onDeleteStateChange: (deleting: boolean) => void }) {
  const router = useRouter();
  const analytics = useQuery(api.videos.analytics, { videoId });
  const comments = useQuery(api.videos.ownerComments, { videoId });
  const reactionMoments = useQuery(api.videos.ownerReactions, { videoId });
  const graphicAssets = useQuery(api.videoAssets.list, { videoId });

  const update = useMutation(api.videos.update);
  const saveEditorProject = useMutation(api.videos.saveEditorProject);
  const setVisibility = useAction(api.videoShares.setVisibility);
  const regenerate = useAction(api.videoShares.regenerate);
  const setPassword = useAction(api.videoPasswords.setPassword);
  const remove = useMutation(api.videos.remove);
  const createTaskFromComment = useMutation(api.videoFlowV2.createTaskFromComment);
  const uploadFile = useResumableUpload();
  const replaceThumbnail = useAction(api.videoActions.replaceThumbnail);
  const uploadGraphicAsset = useAction(api.videoActions.uploadGraphicAsset);
  const beginFinishedRendition = useMutation(api.videos.beginFinishedRendition);
  const failFinishedRendition = useMutation(api.videos.failFinishedRendition);
  const finalizeFinishedRendition = useAction(api.videoActions.finalizeFinishedRendition);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(() => video.title);
  const [description, setDescription] = useState(() => video.description ?? "");
  const [ctaLabel, setCtaLabel] = useState(() => video.cta?.label ?? "");
  const [ctaUrl, setCtaUrl] = useState(() => video.cta?.url ?? "");
  const origin = useBrowserOrigin();
  const [deleting, setDeleting] = useState(false);
  const [password, setPasswordValue] = useState("");
  const [savingThumbnail, setSavingThumbnail] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [ctaBusy, setCtaBusy] = useState(false);
  const [pendingGraphicUrls, setPendingGraphicUrls] = useState<Record<string, string>>({});
  const pendingGraphicUrlsRef = useRef<Record<string, string>>({});
  const [mediaUrls] = useState(() => ({
    primary: video.url,
    screen: video.screenUrl ?? undefined,
    camera: video.cameraUrl ?? undefined,
  }));

  const isPublic = video.visibility === "public";
  const shareUrl = video.shareToken ? `${origin}/v/${video.shareToken}` : "";
  const graphicUrls = useMemo(() => ({
    ...Object.fromEntries((graphicAssets ?? []).map((asset) => [asset.assetId, asset.url])),
    ...pendingGraphicUrls,
  }), [graphicAssets, pendingGraphicUrls]);

  useEffect(() => () => {
    Object.values(pendingGraphicUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const seekTo = (ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
    videoRef.current.play().catch(() => {});
  };

  const handleDelete = async () => {
    if (!confirm("Delete this video permanently?")) return;
    setDeleting(true);
    onDeleteStateChange(true);
    try {
      await remove({ videoId });
      toast.success("Video deleted");
      router.replace("/videos");
    } catch {
      toast.error("Failed to delete");
      setDeleting(false);
      onDeleteStateChange(false);
    }
  };

  const saveThumbnail = async (blob: Blob) => {
    setSavingThumbnail(true);
    try {
      const storageId = await uploadFile(new File([blob], "thumbnail.jpg", { type: blob.type || "image/jpeg" }));
      await replaceThumbnail({ videoId, storageId });
      toast.success("Thumbnail updated");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not update thumbnail");
    } finally {
      setSavingThumbnail(false);
    }
  };

  const persistEditor = async (project: EditorProject) => {
    return saveEditorProject({
      videoId,
      editState: project.editState,
      zoomEffects: project.zoomEffects,
    });
  };

  const addGraphic = async (requested: File) => {
    const file = validateVideoGraphicFile(requested);
    const { width, height } = await readVideoGraphicDimensions(file);
    const assetId = crypto.randomUUID();
    const storageId = await uploadFile(file);
    await uploadGraphicAsset({ videoId, assetId, storageId, width, height });
    const url = URL.createObjectURL(file);
    pendingGraphicUrlsRef.current[assetId] = url;
    setPendingGraphicUrls((current) => ({ ...current, [assetId]: url }));
    return { assetId, url, width, height };
  };

  const captureSopVisual = async (timestampMs: number) => {
    if (!videoRef.current) throw new Error("Wait for the video preview to load");
    const frame = await captureVideoFrameAt(videoRef.current, timestampMs);
    return addGraphic(new File([frame], `sop-${Math.round(timestampMs)}.jpg`, { type: "image/jpeg" }));
  };

  const publishAdapter = {
    current: video.finishedRendition?.current === true,
    status: video.finishedRendition?.status,
    error: video.finishedRendition?.error,
    prepare: async (project: EditorProject) => {
      const saved = await saveEditorProject({ videoId, editState: project.editState, zoomEffects: project.zoomEffects });
      await beginFinishedRendition({ videoId, editRevision: saved.editRevision });
      return saved.editRevision;
    },
    complete: async ({ blob, editRevision, durationMs }: { blob: Blob; editRevision: number; durationMs: number }) => {
      const mimeType = blob.type || "video/webm";
      const storageId = await uploadFile(new File([blob], videoFilename(`videoflow-${editRevision}`, mimeType), { type: mimeType }));
      await finalizeFinishedRendition({ videoId, storageId, editRevision, durationMs });
    },
    fail: async ({ editRevision, message }: { editRevision: number; message: string }) => {
      await failFinishedRendition({ videoId, editRevision, message });
    },
  } as const;

  const commitTitle = async () => {
    const normalized = title.trim().slice(0, 200) || "Untitled recording";
    setTitle(normalized);
    if (normalized === video.title) return;
    try {
      await update({ videoId, title: normalized });
    } catch (caught) {
      setTitle(video.title);
      toast.error(errorMessage(caught, "Could not update the title"));
    }
  };

  const commitDescription = async () => {
    const normalized = description.trim().slice(0, 5_000);
    setDescription(normalized);
    if (normalized === (video.description ?? "")) return;
    try {
      await update({ videoId, description: normalized });
    } catch (caught) {
      setDescription(video.description ?? "");
      toast.error(errorMessage(caught, "Could not update the description"));
    }
  };

  const changeVisibility = async (enabled: boolean) => {
    setShareBusy(true);
    try {
      await setVisibility({ videoId, visibility: enabled ? "public" : "private" });
      toast.success(enabled ? "Sharing on" : "Sharing off");
    } catch (caught) {
      toast.error(errorMessage(caught, "Could not update sharing"));
    } finally {
      setShareBusy(false);
    }
  };

  const regenerateShareUrl = async () => {
    setShareBusy(true);
    try {
      await regenerate({ videoId });
      toast.success("New link generated");
    } catch (caught) {
      toast.error(errorMessage(caught, "Could not generate a new link"));
    } finally {
      setShareBusy(false);
    }
  };

  const changePermission = async (
    values: { allowComments: boolean } | { allowReactions: boolean } | { allowDownload: boolean },
    label: string,
    allowed: boolean,
  ) => {
    setPermissionsBusy(true);
    try {
      await update({ videoId, ...values });
      toast.success(`${label} ${allowed ? "enabled" : "disabled"}`);
    } catch (caught) {
      toast.error(errorMessage(caught, `Could not update ${label.toLowerCase()}`));
    } finally {
      setPermissionsBusy(false);
    }
  };

  const savePassword = async () => {
    setPasswordBusy(true);
    try {
      await setPassword({ videoId, password });
      setPasswordValue("");
      toast.success("Password set");
    } catch (caught) {
      toast.error(errorMessage(caught, "Could not set the password"));
    } finally {
      setPasswordBusy(false);
    }
  };

  const removePassword = async () => {
    setPasswordBusy(true);
    try {
      await setPassword({ videoId, password: null });
      setPasswordValue("");
      toast.success("Password removed");
    } catch (caught) {
      toast.error(errorMessage(caught, "Could not remove the password"));
    } finally {
      setPasswordBusy(false);
    }
  };

  const saveCta = async () => {
    setCtaBusy(true);
    try {
      const label = ctaLabel.trim().slice(0, 80);
      const rawUrl = ctaUrl.trim();
      if (!!label !== !!rawUrl) throw new Error("Enter both a button label and URL, or clear both fields.");

      let url = "";
      if (rawUrl) {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("CTA must use http or https.");
        url = parsed.toString();
      }

      setCtaLabel(label);
      setCtaUrl(url);
      await update({ videoId, cta: label && url ? { label, url } : null });
      toast.success(label ? "CTA saved" : "CTA removed");
    } catch (caught) {
      setCtaLabel(video.cta?.label ?? "");
      setCtaUrl(video.cta?.url ?? "");
      toast.error(errorMessage(caught, "Could not save the CTA"));
    } finally {
      setCtaBusy(false);
    }
  };

  const activityContent = (
    <div className="space-y-5">
      {analytics && analytics.recent.length > 0 && (
        <div>
          <h4 className="mb-3 text-xs font-bold text-slate-800">Recent views</h4>
          <div className="space-y-2.5">
            {analytics.recent.slice(0, 8).map((view) => (
              <div key={view._id} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Eye className="h-3.5 w-3.5" /> Anonymous viewer
                </span>
                <span className="flex items-center gap-1 font-medium text-slate-700">
                  {view.completed && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {view.percentWatched}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isPublic && reactionMoments && reactionMoments.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold text-slate-800">Reactions on the timeline</h4>
          <div className="flex flex-wrap gap-2">
            {reactionMoments.map((reaction) => (
              <button
                key={reaction._id}
                type="button"
                onClick={() => seekTo(reaction.timestampMs)}
                className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/15"
              >
                {reaction.emoji} {formatTimestamp(reaction.timestampMs)}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPublic && (
        <div>
          <h4 className="mb-3 text-xs font-bold text-slate-800">
            Comments {comments && comments.length > 0 && `(${comments.length})`}
          </h4>
          {!comments || comments.length === 0 ? (
            <p className="text-xs text-slate-500">No comments yet.</p>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment._id} className="flex gap-2.5">
                  <Avatar className="h-7 w-7 shrink-0">
                    {comment.authorImage && <AvatarImage src={comment.authorImage} />}
                    <AvatarFallback>{comment.authorName.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-800">{comment.authorName}</span>
                      {comment.isGuest && <span className="text-[10px] text-slate-400">guest</span>}
                      {comment.timestampMs !== undefined && (
                        <button
                          type="button"
                          onClick={() => seekTo(comment.timestampMs!)}
                          className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                        >
                          {formatTimestamp(comment.timestampMs)}
                        </button>
                      )}
                    </div>
                    <div className="mt-1 break-words text-xs leading-5 text-slate-600" dangerouslySetInnerHTML={{ __html: comment.bodyHtml }} />
                    {appConfig.features.automaticTasks && <div className="mt-2">{comment.resolvedAt ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><CheckCircle2 className="h-3 w-3" />Feedback resolved</span> : comment.taskId ? <span className="text-[10px] font-semibold text-primary">Task created</span> : <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={async () => { try { await createTaskFromComment({ commentId: comment._id }); toast.success("Comment added to tasks"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create task"); } }}><ListPlus className="h-3.5 w-3.5" />Create task</Button>}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(!analytics || analytics.recent.length === 0) && (!isPublic || ((!comments || comments.length === 0) && (!reactionMoments || reactionMoments.length === 0))) && (
        <p className="text-xs leading-5 text-slate-500">Viewer activity will appear here after you share this video.</p>
      )}
    </div>
  );

  const ownerSettings = (
    <VideoOwnerSettingsPanel
      title={title}
      description={description}
      onTitleChange={setTitle}
      onDescriptionChange={setDescription}
      onTitleCommit={commitTitle}
      onDescriptionCommit={commitDescription}
      onThumbnailCurrentFrame={async () => {
        if (videoRef.current) await saveThumbnail(await captureVideoFrame(videoRef.current));
      }}
      onThumbnailUpload={() => thumbnailInputRef.current?.click()}
      onThumbnailTitleCard={async () => {
        if (!videoRef.current) return;
        const frame = await captureVideoFrame(videoRef.current);
        await saveThumbnail(await generateTitleThumbnail(frame, title, appConfig.brandColor));
      }}
      thumbnailBusy={savingThumbnail}
      shareEnabled={isPublic}
      onShareEnabledChange={changeVisibility}
      shareUrl={shareUrl}
      onCopyShareUrl={async () => {
        if (!shareUrl) return;
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast.success("Link copied");
        } catch (caught) {
          toast.error(errorMessage(caught, "Could not copy the link"));
        }
      }}
      onOpenShareUrl={() => window.open(shareUrl, "_blank")}
      onRegenerateShareUrl={regenerateShareUrl}
      shareBusy={shareBusy}
      allowComments={video.allowComments !== false}
      onAllowCommentsChange={(allowed) => changePermission({ allowComments: allowed }, "Comments", allowed)}
      allowReactions={video.allowReactions !== false}
      onAllowReactionsChange={(allowed) => changePermission({ allowReactions: allowed }, "Reactions", allowed)}
      allowDownload={video.allowDownload === true}
      onAllowDownloadChange={(allowed) => changePermission({ allowDownload: allowed }, "Downloads", allowed)}
      permissionsBusy={permissionsBusy}
      passwordActive={video.hasPassword}
      passwordValue={password}
      onPasswordValueChange={setPasswordValue}
      onSetPassword={savePassword}
      onRemovePassword={removePassword}
      passwordBusy={passwordBusy}
      cta={{
        label: ctaLabel,
        url: ctaUrl,
        onLabelChange: setCtaLabel,
        onUrlChange: setCtaUrl,
        onSave: saveCta,
        busy: ctaBusy,
      }}
      analytics={{
        views: analytics?.totalViews ?? 0,
        viewers: analytics?.uniqueViewers ?? 0,
        avgPercentWatched: analytics?.avgPercentWatched ?? 0,
        completionRate: analytics?.completionRate ?? 0,
      }}
      activityContent={activityContent}
      advancedSharingContent={<VideoShareLinksPanel videoId={videoId} origin={origin} />}
      onDelete={handleDelete}
      deleteBusy={deleting}
    />
  );

  if (!mediaUrls.primary) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-semibold text-slate-900">This recording is not ready to edit.</p>
        <p className="text-sm text-slate-500">Return to your library and try again after the upload finishes.</p>
        <Button variant="outline" onClick={() => router.push("/videos")}>Back to videos</Button>
      </div>
    );
  }

  return (
    <div className="bg-[#f6f8fc]">
      <VideoEditorWorkspace
        key={videoId}
        videoKey={videoId}
        title={title || video.title}
        mode={video.mode}
        durationMs={video.durationMs}
        src={mediaUrls.primary}
        sourceMimeType={video.mimeType}
        screenSrc={mediaUrls.screen}
        cameraSrc={mediaUrls.camera}
        poster={video.thumbnailUrl ?? undefined}
        initialEditState={video.editState}
        initialZoomEffects={video.zoomEffects}
        transcript={{ status: video.transcriptStatus, segments: video.transcript?.segments }}
        backHref="/videos"
        environmentLabel="Video editor"
        className="min-h-[100dvh] lg:h-[100dvh] lg:min-h-[720px]"
        onSave={persistEditor}
        onPlayerReady={(player) => { videoRef.current = player; }}
        ownerSettings={ownerSettings}
        graphicUrls={graphicUrls}
        onUploadGraphic={addGraphic}
        publishAdapter={publishAdapter}
        renderEnhancePanel={(editor) => <VideoV2Panel videoId={videoId} title={title || video.title} durationMs={video.durationMs} primarySrc={mediaUrls.primary} transcript={{ status: video.transcriptStatus, segments: video.transcript?.segments }} editor={editor} onCaptureSopVisual={captureSopVisual} />}
        headerActions={isPublic && shareUrl ? (
          <Button size="sm" className="h-9" onClick={() => window.open(shareUrl, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5" /> Viewer preview
          </Button>
        ) : undefined}
      />
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            await saveThumbnail(validateThumbnailFile(file));
          } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : "Invalid thumbnail");
          }
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
