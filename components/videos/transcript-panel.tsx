"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Segment {
  start: number; // ms
  end: number; // ms
  text: string;
}
function fmt(ms: number) {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
}

export function TranscriptPanel({
  segments,
  onSeek,
  activeMs,
}: {
  segments: Segment[];
  onSeek: (ms: number) => void;
  activeMs?: number;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query
    ? segments.filter((s) => s.text.toLowerCase().includes(query))
    : segments;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search transcript..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No matches.
          </p>
        ) : (
          filtered.map((s, i) => {
            const active =
              activeMs !== undefined && activeMs >= s.start && activeMs < s.end;
            return (
              <button
                key={`${s.start}-${i}`}
                onClick={() => onSeek(s.start)}
                className={cn(
                  "flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  active && "bg-primary/10"
                )}
              >
                <span className="shrink-0 pt-0.5 font-mono text-xs text-primary">
                  {fmt(s.start)}
                </span>
                <span className="text-foreground/90">{s.text}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
