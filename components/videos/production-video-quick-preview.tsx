"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VideoQuickPreview } from "@/components/videos/video-quick-preview";
import { useBrowserOrigin } from "@/lib/use-browser-origin";
import { videoEditorHref } from "@/lib/video-routes";
import { appConfig } from "@/lib/config";

interface ProductionVideoQuickPreviewProps {
  videoId: Id<"videos"> | null;
  onClose: () => void;
  onDeleted?: (videoId: Id<"videos">) => void;
}

export function ProductionVideoQuickPreview({ videoId, onClose, onDeleted }: ProductionVideoQuickPreviewProps) {
  const router = useRouter();
  const video = useQuery(api.videos.get, videoId ? { videoId } : "skip");
  const remove = useMutation(api.videos.remove);
  const [deleting, setDeleting] = useState(false);
  const origin = useBrowserOrigin();
  const shareUrl = video?.shareToken ? `${origin}/v/${video.shareToken}` : "";
  const modeLabel = video?.mode === "screen_camera"
    ? "Screen + camera"
    : video?.mode === "screen"
      ? "Screen + microphone"
      : "Camera only";

  const openEditor = () => {
    if (!videoId) return;
    onClose();
    router.push(videoEditorHref(videoId));
  };

  const deleteVideo = async () => {
    if (!videoId || deleting || !window.confirm(`Delete “${video?.title ?? "this video"}” permanently?`)) return;
    setDeleting(true);
    try {
      await remove({ videoId });
      onClose();
      onDeleted?.(videoId);
      toast.success("Video deleted");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete the video");
      setDeleting(false);
    }
  };

  return (
    <VideoQuickPreview
      open={videoId !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      loading={video === undefined}
      title={video?.title ?? "Loading preview…"}
      description={video?.description}
      src={video?.url}
      screenSrc={video?.screenUrl ?? undefined}
      cameraSrc={video?.cameraUrl ?? undefined}
      poster={video?.thumbnailUrl ?? undefined}
      editState={video?.editState}
      zoomEffects={video?.zoomEffects}
      durationLabel={video ? formatDuration(video.durationMs) : undefined}
      sizeLabel={video ? formatSize(video.sizeBytes) : undefined}
      modeLabel={video ? modeLabel : undefined}
      stats={video ? [
        { label: "Views", value: video.viewCount },
        { label: "Transcript", value: transcriptLabel(video.transcriptStatus) },
      ] : []}
      shareEnabled={video?.visibility === "public" && !!shareUrl}
      shareLabel={shareUrl ? "Public viewer link is ready" : "Enable sharing in the editor"}
      onOpenEditor={openEditor}
      onOpenViewer={shareUrl ? () => window.open(shareUrl, "_blank", "noopener,noreferrer") : undefined}
      onCopyShare={shareUrl ? async () => {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Share link copied");
      } : undefined}
      onDelete={appConfig.features.libraryDelete ? () => void deleteVideo() : undefined}
      deleteBusy={deleting}
    />
  );
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function transcriptLabel(status: "none" | "pending" | "done" | "error" | "too_large") {
  if (status === "done") return "Ready";
  if (status === "pending") return "Processing";
  return "Not available";
}
