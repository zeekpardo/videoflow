"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Camera,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Smile,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface VideoOwnerAnalytics {
  views: number;
  viewers: number;
  avgPercentWatched: number;
  completionRate: number;
  completedViews?: number;
}

export interface VideoOwnerCtaControls {
  label: string;
  url: string;
  onLabelChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  busy?: boolean;
}

export interface VideoOwnerSettingsPanelProps {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTitleCommit?: () => void | Promise<void>;
  onDescriptionCommit?: () => void | Promise<void>;

  onThumbnailCurrentFrame: () => void | Promise<void>;
  onThumbnailUpload: () => void;
  onThumbnailTitleCard: () => void | Promise<void>;
  thumbnailBusy?: boolean;

  shareEnabled: boolean;
  onShareEnabledChange: (enabled: boolean) => void | Promise<void>;
  shareUrl?: string;
  onCopyShareUrl?: () => void | Promise<void>;
  onOpenShareUrl?: () => void;
  onRegenerateShareUrl?: () => void | Promise<void>;
  shareBusy?: boolean;

  allowComments: boolean;
  onAllowCommentsChange: (allowed: boolean) => void | Promise<void>;
  allowReactions: boolean;
  onAllowReactionsChange: (allowed: boolean) => void | Promise<void>;
  allowDownload: boolean;
  onAllowDownloadChange: (allowed: boolean) => void | Promise<void>;
  permissionsBusy?: boolean;

  passwordActive: boolean;
  passwordValue: string;
  onPasswordValueChange: (value: string) => void;
  onSetPassword: () => void | Promise<void>;
  onRemovePassword: () => void | Promise<void>;
  passwordBusy?: boolean;
  passwordNote?: string;

  cta?: VideoOwnerCtaControls;
  analytics: VideoOwnerAnalytics;
  activityContent?: ReactNode;
  advancedSharingContent?: ReactNode;

  onDelete: () => void | Promise<void>;
  deleteBusy?: boolean;
  localMode?: boolean;
  localModeNote?: string;
  defaultTab?: OwnerSettingsTab;
  className?: string;
}

export type OwnerSettingsTab = "details" | "share" | "activity";

const tabs: { id: OwnerSettingsTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "share", label: "Share" },
  { id: "activity", label: "Activity" },
];

function PanelHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
    </div>
  );
}

function PermissionRow({ icon, label, checked, disabled, onChange }: { icon: ReactNode; label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void | Promise<void> }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="flex items-center gap-2.5 text-sm text-slate-700">
        <span className="text-slate-400">{icon}</span>
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 py-3">
      <p className="text-xl font-bold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

export function VideoOwnerSettingsPanel({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onTitleCommit,
  onDescriptionCommit,
  onThumbnailCurrentFrame,
  onThumbnailUpload,
  onThumbnailTitleCard,
  thumbnailBusy = false,
  shareEnabled,
  onShareEnabledChange,
  shareUrl,
  onCopyShareUrl,
  onOpenShareUrl,
  onRegenerateShareUrl,
  shareBusy = false,
  allowComments,
  onAllowCommentsChange,
  allowReactions,
  onAllowReactionsChange,
  allowDownload,
  onAllowDownloadChange,
  permissionsBusy = false,
  passwordActive,
  passwordValue,
  onPasswordValueChange,
  onSetPassword,
  onRemovePassword,
  passwordBusy = false,
  passwordNote,
  cta,
  analytics,
  activityContent,
  advancedSharingContent,
  onDelete,
  deleteBusy = false,
  localMode = false,
  localModeNote,
  defaultTab = "details",
  className,
}: VideoOwnerSettingsPanelProps) {
  const [tab, setTab] = useState<OwnerSettingsTab>(defaultTab);
  const tabsId = useId();
  const canSetPassword = passwordValue.trim().length >= 8 && !passwordBusy;

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, current: OwnerSettingsTab) => {
    const index = tabs.findIndex((item) => item.id === current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex].id;
    setTab(next);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  };

  return (
    <div className={cn("min-h-full", className)} data-owner-settings-panel>
      {localMode && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-[11px] leading-4 text-amber-800">
          <strong className="font-semibold">Test mode.</strong>{" "}
          {localModeNote ?? "These settings and viewer activity stay in this browser."}
        </div>
      )}

      <div className="flex border-b border-slate-200 px-5" role="tablist" aria-label="Video settings" aria-orientation="horizontal">
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${tabsId}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${tabsId}-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => moveTabFocus(event, item.id)}
            className={cn(
              "relative flex-1 px-2 py-3.5 text-xs font-semibold transition",
              tab === item.id ? "text-primary" : "text-slate-500 hover:text-slate-900",
            )}
          >
            {item.label}
            {tab === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div id={`${tabsId}-panel-details`} role="tabpanel" aria-labelledby={`${tabsId}-tab-details`} className="divide-y divide-slate-200">
          <section className="space-y-4 p-5">
            <PanelHeading title="Video details" description="Update what viewers see with the recording." />
            <div className="space-y-1.5">
              <Label htmlFor="owner-video-title" className="text-xs text-slate-600">Title</Label>
              <Input
                id="owner-video-title"
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={() => void onTitleCommit?.()}
                placeholder="Untitled video"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-video-description" className="text-xs text-slate-600">Description</Label>
              <Textarea
                id="owner-video-description"
                value={description}
                onChange={(event) => onDescriptionChange(event.target.value)}
                onBlur={() => void onDescriptionCommit?.()}
                placeholder="Add context for viewers…"
                rows={4}
                className="resize-none"
              />
            </div>
          </section>

          <section className="space-y-4 p-5">
            <PanelHeading title="Thumbnail" description="Use the current frame, your own artwork, or a generated title card." />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="outline" disabled={thumbnailBusy} onClick={() => void onThumbnailCurrentFrame()}>
                <Camera className="h-4 w-4" /> Current frame
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={thumbnailBusy} onClick={onThumbnailUpload}>
                <Upload className="h-4 w-4" /> Upload
              </Button>
              <Button type="button" size="sm" className="col-span-2" disabled={thumbnailBusy} onClick={() => void onThumbnailTitleCard()}>
                {thumbnailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate title card
              </Button>
            </div>
          </section>

          <section className="p-5">
            <Button type="button" variant="ghost" className="w-full justify-start text-red-500 hover:bg-red-50 hover:text-red-600" disabled={deleteBusy} onClick={() => void onDelete()}>
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete video
            </Button>
          </section>
        </div>
      )}

      {tab === "share" && (
        <div id={`${tabsId}-panel-share`} role="tabpanel" aria-labelledby={`${tabsId}-tab-share`} className="divide-y divide-slate-200">
          <section className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-4">
              <PanelHeading title="Share link" description={localMode ? "Preview sharing in this browser only." : "Let anyone with the link watch this video."} />
              <Switch checked={shareEnabled} disabled={shareBusy} onCheckedChange={onShareEnabledChange} aria-label="Enable share link" />
            </div>
            {shareEnabled && shareUrl && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input value={shareUrl} readOnly className="min-w-0 text-xs" aria-label="Share URL" />
                  {onCopyShareUrl && <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={() => void onCopyShareUrl()} aria-label="Copy share link"><Copy className="h-4 w-4" /></Button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {onOpenShareUrl && <Button type="button" size="sm" variant="outline" className={cn(!onRegenerateShareUrl && "col-span-2")} onClick={onOpenShareUrl}><ExternalLink className="h-4 w-4" /> Open</Button>}
                  {onRegenerateShareUrl && <Button type="button" size="sm" variant="outline" disabled={shareBusy} onClick={() => void onRegenerateShareUrl()}>{shareBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} New link</Button>}
                </div>
              </div>
            )}
          </section>

          {shareEnabled && (
            <>
              <section className="space-y-3 p-5">
                <PanelHeading title="Viewer permissions" />
                <PermissionRow icon={<MessageSquare className="h-4 w-4" />} label="Allow comments" checked={allowComments} disabled={permissionsBusy} onChange={onAllowCommentsChange} />
                <PermissionRow icon={<Smile className="h-4 w-4" />} label="Allow reactions" checked={allowReactions} disabled={permissionsBusy} onChange={onAllowReactionsChange} />
                <PermissionRow icon={<Download className="h-4 w-4" />} label="Allow download" checked={allowDownload} disabled={permissionsBusy} onChange={onAllowDownloadChange} />
              </section>

              <section className="space-y-3 p-5">
                <PanelHeading title="Password protection" description="Require a password before viewers can access the recording." />
                {passwordActive ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-semibold text-primary"><Lock className="h-4 w-4" /> Password active</span>
                    <Button type="button" size="sm" variant="ghost" disabled={passwordBusy} onClick={() => void onRemovePassword()}>{passwordBusy && <Loader2 className="h-4 w-4 animate-spin" />} Remove</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input type="password" value={passwordValue} onChange={(event) => onPasswordValueChange(event.target.value)} placeholder="At least 8 characters" aria-label="Share password" />
                    <Button type="button" size="sm" disabled={!canSetPassword} onClick={() => void onSetPassword()}>{passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}</Button>
                  </div>
                )}
                {passwordNote && <p className="text-[11px] leading-4 text-slate-400">{passwordNote}</p>}
              </section>

              {cta && (
                <section className="space-y-3 p-5">
                  <PanelHeading title="Call to action" description="Add an optional button below the shared video." />
                  <Input value={cta.label} disabled={cta.busy} onChange={(event) => cta.onLabelChange(event.target.value)} placeholder="Button label" aria-label="Call to action label" />
                  <Input value={cta.url} disabled={cta.busy} onChange={(event) => cta.onUrlChange(event.target.value)} placeholder="https://…" inputMode="url" aria-label="Call to action URL" />
                  <Button type="button" size="sm" variant="secondary" className="w-full" disabled={cta.busy} onClick={() => void cta.onSave()}>{cta.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save call to action</Button>
                </section>
              )}
            </>
          )}
          {advancedSharingContent && <section className="space-y-3 p-5">{advancedSharingContent}</section>}
        </div>
      )}

      {tab === "activity" && (
        <div id={`${tabsId}-panel-activity`} role="tabpanel" aria-labelledby={`${tabsId}-tab-activity`} className="divide-y divide-slate-200">
          <section className="space-y-3 p-5">
            <PanelHeading title="Viewer analytics" description="Engagement from this video's share page." />
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-y border-slate-200">
              <Metric label="Views" value={analytics.views} />
              <div className="pl-4"><Metric label="Viewers" value={analytics.viewers} /></div>
              <Metric label="Avg watched" value={`${analytics.avgPercentWatched}%`} />
              <div className="pl-4"><Metric label="Completion" value={`${analytics.completionRate}%`} /></div>
            </div>
            {analytics.completedViews !== undefined && <p className="text-xs text-slate-500"><strong className="text-slate-800">{analytics.completedViews}</strong> completed view{analytics.completedViews === 1 ? "" : "s"}</p>}
          </section>
          {activityContent && <section className="p-5">{activityContent}</section>}
        </div>
      )}
    </div>
  );
}
