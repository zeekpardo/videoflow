"use client";

import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_MASTER_AUDIO,
  type MasterAudioSettings,
} from "@/lib/video-audio";

interface EditorAudioInspectorProps {
  settings: MasterAudioSettings;
  editedDurationMs: number;
  onChange: (settings: MasterAudioSettings) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-xs font-medium text-slate-600">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-slate-400">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}

export function EditorAudioInspector({ settings, editedDurationMs, onChange }: EditorAudioInspectorProps) {
  const maxFadeSeconds = Math.min(10, Math.max(0, editedDurationMs / 1_000));
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Audio</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">Adjust the mixed recording audio. Microphone and system sound are one master track.</p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">
            {settings.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </span>
          <div><p className="text-xs font-semibold text-slate-800">Include audio</p><p className="text-[11px] text-slate-400">Mute without changing the source.</p></div>
        </div>
        <Switch aria-label="Include audio" checked={!settings.muted} onCheckedChange={(enabled) => onChange({ ...settings, muted: !enabled })} />
      </div>

      <Slider
        label="Master level"
        value={Math.round(settings.gain * 100)}
        min={0}
        max={100}
        step={1}
        display={`${Math.round(settings.gain * 100)}%`}
        disabled={settings.muted}
        onChange={(gain) => onChange({ ...settings, gain: gain / 100 })}
      />
      <Slider
        label="Fade in"
        value={settings.fadeInMs / 1_000}
        min={0}
        max={maxFadeSeconds}
        step={0.1}
        display={`${(settings.fadeInMs / 1_000).toFixed(1)}s`}
        disabled={settings.muted || maxFadeSeconds === 0}
        onChange={(seconds) => onChange({ ...settings, fadeInMs: Math.round(seconds * 1_000) })}
      />
      <Slider
        label="Fade out"
        value={settings.fadeOutMs / 1_000}
        min={0}
        max={maxFadeSeconds}
        step={0.1}
        display={`${(settings.fadeOutMs / 1_000).toFixed(1)}s`}
        disabled={settings.muted || maxFadeSeconds === 0}
        onChange={(seconds) => onChange({ ...settings, fadeOutMs: Math.round(seconds * 1_000) })}
      />

      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-500">Fades follow the final edited timeline, so trimming or cutting keeps them anchored to the beginning and end viewers hear.</p>
      <Button type="button" variant="outline" className="w-full" onClick={() => onChange({ ...DEFAULT_MASTER_AUDIO })}>
        <RotateCcw className="h-4 w-4" /> Reset audio
      </Button>
    </div>
  );
}
