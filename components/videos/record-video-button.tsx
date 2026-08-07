"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Video } from "lucide-react";
import { VideoRecorder } from "./video-recorder";
import type { Id } from "@/convex/_generated/dataModel";
import type { ComponentProps } from "react";

interface RecordVideoButtonProps {
  onSaved?: (videoId: Id<"videos">) => void;
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}

// Reusable trigger that opens the recorder from any VideoFlow workspace page.
export function RecordVideoButton({
  onSaved,
  label = "Record video",
  variant = "default",
  size = "default",
  className,
}: RecordVideoButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Video className="h-4 w-4" />
        {label}
      </Button>
      <VideoRecorder open={open} onOpenChange={setOpen} onSaved={onSaved} />
    </>
  );
}
