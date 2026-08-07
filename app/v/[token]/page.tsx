"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Zap,
  Eye,
  ArrowRight,
  Lock,
  Download,
  Send,
  Search,
  Sun,
  Moon,
  RectangleHorizontal,
  Sparkles,
  CheckCircle2,
  TriangleAlert,
  CalendarCheck2,
} from "lucide-react";
import { toast } from "sonner";
import { VideoPlayer } from "@/components/videos/player/video-player";
import { VideoDownloadMenu } from "@/components/videos/video-download-menu";
import { appConfig } from "@/lib/config";
import { normalizeVideoEditState } from "@/lib/video-edits";

const ACCENT = appConfig.brandColor;
const REACTIONS = ["👍", "❤️", "🎉", "😮", "👏"];
const VIEWER_KEY_STORAGE = appConfig.viewerStorageKey;
const VIEWER_AI_CONSENT_VERSION = "2026-07-16-viewer-ai-v1";
type Theme = "light" | "dark";

function initialViewerKey() {
  if (typeof window === "undefined") return "";
  let key = localStorage.getItem(VIEWER_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(VIEWER_KEY_STORAGE, key);
  }
  return key;
}

type FullData = Extract<
  NonNullable<FunctionReturnType<typeof api.videosPublic.getByShareToken>>,
  { locked: false }
>;

function fmtTime(ms: number) {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
}
function relTime(ts: number) {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const CSS = `
.vshare{font-family:'Hanken Grotesk',ui-sans-serif,system-ui,-apple-system,sans-serif;min-height:100vh;transition:background .2s ease,color .2s ease;}
.vshare.dark{--bg:#0b0b0d;--panel:#141417;--panel2:#1b1b1f;--fg:#ededed;--muted:#9b9ba3;--border:rgba(255,255,255,.10);--hover:rgba(255,255,255,.06);--accent:${ACCENT};background:var(--bg);color:var(--fg);}
.vshare.light{--bg:#f6f6f7;--panel:#ffffff;--panel2:#f1f1f3;--fg:#191920;--muted:#71717a;--border:rgba(0,0,0,.10);--hover:rgba(0,0,0,.04);--accent:${ACCENT};background:var(--bg);color:var(--fg);}
.vshare ::selection{background:var(--accent);color:#fff;}
.vshare.dark .icon-moon{display:none}.vshare.light .icon-sun{display:none}
@keyframes vReveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.vshare .reveal{opacity:0;animation:vReveal .55s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes vFloat{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-80px) scale(1.25)}}
.vshare .caption-pop{animation:vReveal .18s cubic-bezier(.2,.8,.2,1)}
.vshare .vfloat{animation:vFloat 1.1s ease-out forwards}
.vshare .scroll-thin::-webkit-scrollbar{width:6px}
.vshare .scroll-thin::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
.vshare .field{background:var(--bg);border:1px solid var(--border);color:var(--fg);}
.vshare .field::placeholder{color:var(--muted);opacity:.8}
.vshare .field:focus{outline:none;border-color:var(--accent)}
`;

export default function PublicVideoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const s = localStorage.getItem(appConfig.themeStorageKey);
      if (s === "light" || s === "dark") return s;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch {
      return "dark";
    }
  });
  const [theater, setTheater] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [viewerEmail, setViewerEmail] = useState("");
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockViewerKey] = useState(initialViewerKey);
  const unlock = useAction(api.videoPasswords.unlock);

  const data = useQuery(api.videosPublic.getByShareToken, {
    token,
    sessionToken,
  });

  const toggleTheme = () =>
    setTheme((t) => {
      const n: Theme = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(appConfig.themeStorageKey, n);
      } catch {
        /* noop */
      }
      return n;
    });

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (data && data.locked && data.hasPassword && !pwInput.trim()) return;
    if (data && data.locked && data.requiresEmail && !viewerEmail.trim()) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      const result = await unlock({ shareToken: token, password: pwInput, viewerEmail: viewerEmail || undefined, viewerKey: unlockViewerKey });
      setSessionToken(result.sessionToken || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setUnlockError(message.includes("Too many password attempts") ? "Too many attempts. Wait a few minutes and try again." : message || "Access could not be verified");
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className={cn("vshare", theme)} suppressHydrationWarning>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-white"
            style={{ background: ACCENT }}
          >
            <Zap className="h-4 w-4 fill-current" />
          </span>
          <span className="text-lg font-bold tracking-tight">{appConfig.name}</span>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="grid h-9 w-9 place-items-center rounded-full border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)" }}
        >
          <Sun className="icon-sun h-4 w-4" />
          <Moon className="icon-moon h-4 w-4" />
        </button>
      </header>

      {data === undefined ? (
        <div className="grid min-h-[70vh] place-items-center">
          <Loader2 className="h-7 w-7 animate-spin opacity-50" />
        </div>
      ) : data === null ? (
        <div className="grid min-h-[70vh] place-items-center px-6 text-center">
          <div>
            <Zap className="mx-auto mb-3 h-9 w-9 opacity-30" />
            <h1 className="text-2xl font-bold">This video isn&apos;t available</h1>
            <p className="mt-2 text-[var(--muted)]">
              The link may be private or no longer exist.
            </p>
          </div>
        </div>
      ) : data.locked ? (
        <div className="grid min-h-[70vh] place-items-center px-6">
          <form
            onSubmit={submitPassword}
            className="reveal w-full max-w-sm rounded-2xl border p-7 text-center"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <span
              className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full"
              style={{ background: "rgba(255,90,54,.12)", color: ACCENT }}
            >
              <Lock className="h-6 w-6" />
            </span>
            <h1 className="text-xl font-bold">{data.title}</h1>
            <p className="mb-5 mt-1 text-sm text-[var(--muted)]">Verify access to continue.</p>
            {data.requiresEmail && <input type="email" autoFocus value={viewerEmail} onChange={(e) => setViewerEmail(e.target.value)} placeholder="Your email" className="field w-full rounded-lg px-4 py-2.5 text-center" />}
            {data.hasPassword && <input type="password" autoFocus={!data.requiresEmail} value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Enter password" className={cn("field w-full rounded-lg px-4 py-2.5 text-center", data.requiresEmail && "mt-2")} />}
            {unlockError && (
              <p className="mt-2 text-sm text-red-500">{unlockError}</p>
            )}
            <button
              type="submit"
              disabled={unlocking}
              className="mt-4 w-full rounded-lg py-2.5 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: ACCENT }}
            >
              {unlocking ? "Verifying…" : "Continue"}
            </button>
          </form>
        </div>
      ) : (
        <Stage data={data} token={token} sessionToken={sessionToken} theater={theater} setTheater={setTheater} />
      )}

      <footer className="py-10 text-center text-xs text-[var(--muted)]">
        Recorded with <span className="font-semibold">{appConfig.name}</span>
      </footer>
    </div>
  );
}

function Stage({
  data,
  token,
  sessionToken,
  theater,
  setTheater,
}: {
  data: FullData;
  token: string;
  sessionToken?: string;
  theater: boolean;
  setTheater: (v: boolean) => void;
}) {
  const comments = useQuery(api.videosPublic.feed, { token, sessionToken });
  const reactionCounts = useQuery(api.videosPublic.reactions, { token, sessionToken });
  const reactionMoments = useQuery(api.videosPublic.reactionMoments, { token, sessionToken });
  const recordView = useMutation(api.videosPublic.recordView);
  const updateProgress = useMutation(api.videosPublic.updateViewProgress);
  const addComment = useMutation(api.videosPublic.addGuestComment);
  const addReaction = useMutation(api.videosPublic.addReaction);
  const recordInteraction = useMutation(api.videosPublic.recordInteraction);
  const submitReviewResponse = useMutation(api.videosPublic.submitReviewResponse);
  const askVideo = useAction(api.videoFlowV2Actions.askVideo);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [viewerKey] = useState(initialViewerKey);
  const [activeMs, setActiveMs] = useState(0);
  const [floats, setFloats] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const floatId = useRef(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [tquery, setTquery] = useState("");
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; citations: Array<{ startMs: number; endMs: number; label: string }> } | null>(null);
  const [reviewerName, setReviewerName] = useState(data.reviewRequest?.recipientName ?? "");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const watchedAccum = useRef(0);
  const lastTime = useRef(0);
  const lastReport = useRef(0);
  const viewRecorded = useRef(false);
  const shownInteractions = useRef(new Set<string>());

  useEffect(() => {
    if (!viewerKey || viewRecorded.current) return;
    viewRecorded.current = true;
    recordView({
      token,
      sessionToken,
      viewerKey,
      userAgent: navigator.userAgent,
      referrer: document.referrer || undefined,
    }).catch(() => {});
  }, [viewerKey, token, sessionToken, recordView]);

  const report = useCallback(() => {
    if (!viewerKey || !videoRef.current) return;
    updateProgress({
      token,
      sessionToken,
      viewerKey,
      positionMs: Math.round(videoRef.current.currentTime * 1000),
      watchedDeltaMs: Math.round(watchedAccum.current * 1000),
    }).catch(() => {});
    watchedAccum.current = 0;
    lastReport.current = Date.now();
  }, [viewerKey, token, sessionToken, updateProgress]);

  useEffect(() => () => report(), [report]);

  useEffect(() => {
    if (window.self === window.top) return;
    let host = "";
    try { host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ""; } catch { /* invalid referrer is blocked */ }
    const handle = window.setTimeout(() => setEmbedBlocked(!data.allowEmbed || (!!data.embedDomains.length && !data.embedDomains.includes(host))), 0);
    return () => window.clearTimeout(handle);
  }, [data.allowEmbed, data.embedDomains]);

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const cur = e.currentTarget.currentTime;
    const delta = cur - lastTime.current;
    if (delta > 0 && delta < 2) watchedAccum.current += delta;
    lastTime.current = cur;
    setActiveMs(cur * 1000);
    for (const element of data.interactiveElements) {
      if (element.kind === "chapter" || cur * 1_000 < element.startMs || cur * 1_000 >= element.endMs || shownInteractions.current.has(String(element._id))) continue;
      shownInteractions.current.add(String(element._id));
      void recordInteraction({ token, sessionToken, elementId: element._id, viewerKey, event: "shown" });
    }
    if (Date.now() - lastReport.current > 8000) report();
  };

  const seekTo = (ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      videoRef.current.play().catch(() => {});
    }
  };

  const react = (emoji: string) => {
    if (!viewerKey) return;
    addReaction({ token, sessionToken, emoji, viewerKey, timestampMs: Math.round(activeMs) }).catch(() => {});
    const id = floatId.current++;
    setFloats((f) => [...f, { id, emoji, x: 8 + Math.random() * 84 }]);
    setTimeout(() => setFloats((f) => f.filter((o) => o.id !== id)), 1100);
  };

  const submitComment = async () => {
    if (!name.trim() || !email.trim() || !body.trim()) {
      toast.error("Name, email and comment are required");
      return;
    }
    setPosting(true);
    try {
      await addComment({
        token,
        sessionToken,
        viewerKey: viewerKey || "anonymous-viewer",
        guestName: name.trim(),
        guestEmail: email.trim(),
        body: body.trim(),
        timestampMs: Math.round(activeMs),
      });
      setBody("");
      toast.success("Comment posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const submitQuestion = async (suggested?: string) => {
    const nextQuestion = (suggested ?? question).trim();
    if (!askConsent) return toast.error("Accept the AI privacy notice before asking");
    if (nextQuestion.length < 3 || !viewerKey) return;
    setQuestion(nextQuestion);
    setAsking(true);
    try {
      const result = await askVideo({ token, sessionToken, question: nextQuestion, viewerKey, acceptedAiTerms: askConsent, consentVersion: VIEWER_AI_CONSENT_VERSION });
      setAnswer(result);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "This video could not answer right now");
    } finally { setAsking(false); }
  };

  const respondToReview = async (decision: "approved" | "changes_requested") => {
    if (!reviewerName.trim()) return toast.error("Enter your name");
    if (decision === "changes_requested" && !reviewNote.trim()) return toast.error("Describe the changes you need");
    setReviewing(true);
    try {
      await submitReviewResponse({ token, sessionToken, viewerKey, reviewerName, decision, note: reviewNote || undefined });
      toast.success(decision === "approved" ? "Video approved" : "Change request sent");
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not save your review"); }
    finally { setReviewing(false); }
  };

  const segs = data.transcript?.segments ?? [];
  const filteredSegs = tquery.trim()
    ? segs.filter((s) => s.text.toLowerCase().includes(tquery.toLowerCase()))
    : segs;
  const graphicUrls = Object.fromEntries(
    data.graphicAssets.map((asset) => [asset.assetId, asset.url]),
  );
  const activeCaption = data.captionTrack?.cues.find((cue) => activeMs >= cue.startMs && activeMs < cue.endMs);
  const activeInteractive = data.interactiveElements.filter((element) => element.kind !== "chapter" && activeMs >= element.startMs && activeMs < element.endMs);
  const chapters = data.interactiveElements.filter((element) => element.kind === "chapter");
  const captionStyle = data.captionTrack?.style;

  if (embedBlocked) return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 text-center"><div><Lock className="mx-auto h-8 w-8 text-[var(--muted)]" /><h1 className="mt-4 text-xl font-bold">Embedding is not allowed here</h1><p className="mt-2 text-sm text-[var(--muted)]">Open the original share link to watch this video.</p></div></main>;

  return (
    <main
      className="reveal mx-auto px-4 pb-8 sm:px-6"
      style={{ maxWidth: theater ? 1800 : 1500 }}
    >
      {data.url && (
        <div className="relative overflow-hidden rounded-xl">
          <VideoPlayer
          ref={videoRef}
          src={data.url}
          screenSrc={data.screenUrl ?? undefined}
          cameraSrc={data.cameraUrl ?? undefined}
          poster={data.thumbnailUrl ?? undefined}
          accent={ACCENT}
          wrapperClassName="border shadow-sm"
          zoomEffects={data.zoomEffects ?? []}
          editState={data.editState}
          graphicUrls={graphicUrls}
          onTimeUpdate={onTimeUpdate}
          onPause={report}
          onEnded={report}
          />
          {activeCaption && captionStyle && <div className="pointer-events-none absolute inset-x-[8%] z-20 flex justify-center" style={{ top: captionStyle.position === "top" ? "10%" : captionStyle.position === "middle" ? "48%" : undefined, bottom: captionStyle.position === "bottom" ? "8%" : undefined }}><div key={activeCaption.id} className={cn("caption-pop max-w-4xl rounded-lg px-3 py-2 text-center font-bold leading-tight shadow-lg", captionStyle.preset === "pop" && "scale-110 uppercase")} style={{ color: captionStyle.textColor, background: captionStyle.backgroundColor, fontSize: `clamp(16px, ${2 * captionStyle.fontScale}vw, ${42 * captionStyle.fontScale}px)` }}>{activeCaption.words?.length ? activeCaption.words.map((word, index) => <span key={`${word.startMs}-${index}`} style={{ color: activeMs >= word.startMs && activeMs < word.endMs ? captionStyle.highlightColor : captionStyle.textColor }}>{word.text}{" "}</span>) : activeCaption.text}</div></div>}
          {activeInteractive.map((element) => <div key={element._id} className="absolute z-30" style={{ left: `${(element.x - element.width / 2) * 100}%`, top: `${(element.y - element.height / 2) * 100}%`, width: `${element.width * 100}%`, minHeight: `${element.height * 100}%` }}>
            {element.kind === "poll" ? <div className="rounded-xl border border-white/50 bg-slate-950/85 p-3 text-white shadow-xl"><p className="text-sm font-bold">{element.label}</p><div className="mt-2 flex flex-wrap gap-2">{element.options?.map((option) => <button key={option} type="button" onClick={() => { void recordInteraction({ token, sessionToken, elementId: element._id, viewerKey, event: "answered", value: option }); toast.success("Answer recorded"); }} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25">{option}</button>)}</div></div> : <button type="button" onClick={() => { void recordInteraction({ token, sessionToken, elementId: element._id, viewerKey, event: "clicked" }); if (element.url) window.open(element.url, "_blank", "noopener,noreferrer"); }} className="flex h-full min-h-10 w-full items-center justify-center rounded-xl border border-white/50 px-3 py-2 text-sm font-bold text-white shadow-xl transition hover:scale-[1.02]" style={{ background: ACCENT }}>{element.label}</button>}
          </div>)}
        </div>
      )}

      {chapters.length > 0 && <nav aria-label="Video chapters" className="mt-3 flex gap-2 overflow-x-auto pb-1">{chapters.map((chapter) => <button key={chapter._id} type="button" onClick={() => { seekTo(chapter.startMs); void recordInteraction({ token, sessionToken, elementId: chapter._id, viewerKey, event: "clicked" }); }} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--hover)]" style={{ borderColor: "var(--border)" }}>{fmtTime(chapter.startMs)} · {chapter.label}</button>)}</nav>}

      {/* Title + meta + actions */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{data.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[var(--muted)]">
            <span className="flex items-center gap-2">
              {data.ownerImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.ownerImage}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <span
                  className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: ACCENT }}
                >
                  {data.ownerName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="font-medium text-[var(--fg)]">
                {data.ownerName}
              </span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> {data.viewCount}
            </span>
            <span>·</span>
            <span>{relTime(data.createdAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheater(!theater)}
            aria-label="Theater mode"
            title="Theater mode"
            className={cn(
              "hidden h-9 w-9 place-items-center rounded-full border transition-colors hover:bg-[var(--hover)] lg:grid"
            )}
            style={{
              borderColor: "var(--border)",
              background: theater ? "var(--panel2)" : "transparent",
            }}
          >
            <RectangleHorizontal className="h-4 w-4" />
          </button>
          {data.allowDownload && data.url && (
            <VideoDownloadMenu
              title={data.title}
              mode={data.mode}
              durationMs={data.durationMs}
              primarySrc={data.url}
              primaryMimeType={data.mimeType}
              screenSrc={data.screenUrl ?? undefined}
              cameraSrc={data.cameraUrl ?? undefined}
              finishedSrc={data.mediaSource === "finished" ? data.url : undefined}
              finishedMimeType={data.finishedRendition?.mimeType}
              graphicUrls={graphicUrls}
              project={{
                editState: normalizeVideoEditState(data.editState, data.durationMs, !!data.screenUrl && !!data.cameraUrl),
                zoomEffects: data.zoomEffects ?? [],
              }}
              scope="viewer"
              trigger={<button type="button" className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors hover:bg-[var(--hover)]" style={{ borderColor: "var(--border)" }}><Download className="h-4 w-4" /> Download</button>}
            />
          )}
          {data.cta && (
            <a
              href={data.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
              style={{ background: ACCENT }}
            >
              {data.cta.label} <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {data.description && (
        <div
          className="mt-4 rounded-xl border p-4 text-[15px] leading-relaxed text-[var(--fg)]"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
        >
          {data.description}
        </div>
      )}

      {data.reviewRequest && <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: "var(--panel2)", color: ACCENT }}>{data.reviewRequest.status === "approved" ? <CheckCircle2 className="h-5 w-5" /> : data.reviewRequest.status === "changes_requested" ? <TriangleAlert className="h-5 w-5" /> : <CalendarCheck2 className="h-5 w-5" />}</span><div><h2 className="font-bold">Video review for {data.reviewRequest.recipientName}</h2>{data.reviewRequest.message && <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{data.reviewRequest.message}</p>}{data.reviewRequest.dueAt && <p className="mt-1 text-xs text-[var(--muted)]">Requested by {new Date(data.reviewRequest.dueAt).toLocaleDateString()}</p>}</div></div>
        {data.reviewRequest.status === "pending" ? <div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} className="field rounded-lg px-3 py-2 text-sm sm:col-span-2" placeholder="Your name" /><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={5_000} rows={3} className="field resize-none rounded-lg px-3 py-2 text-sm sm:col-span-2" placeholder="Optional approval note, or describe the changes you need" /><button type="button" disabled={reviewing} onClick={() => void respondToReview("approved")} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />Approve video</button><button type="button" disabled={reviewing} onClick={() => void respondToReview("changes_requested")} className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><TriangleAlert className="h-4 w-4" />Request changes</button></div> : <div className="mt-4 rounded-lg p-3" style={{ background: "var(--panel2)" }}><p className="text-sm font-semibold">{data.reviewRequest.status === "approved" ? "Approved" : "Changes requested"}{data.reviewRequest.responseName ? ` by ${data.reviewRequest.responseName}` : ""}</p>{data.reviewRequest.responseNote && <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{data.reviewRequest.responseNote}</p>}</div>}
      </section>}

      {/* Reactions */}
      {data.allowReactions && (
        <div className="relative mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-[var(--muted)]">React at {fmtTime(activeMs)}</span>
            {REACTIONS.map((emoji) => {
              const count = reactionCounts?.find((item) => item.emoji === emoji)?.count ?? 0;
              return (
                <button
                  key={emoji}
                  onClick={() => react(emoji)}
                  className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors hover:bg-[var(--hover)] active:scale-95"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span>{emoji}</span>
                  {count > 0 && <span className="text-[var(--muted)]">{count}</span>}
                </button>
              );
            })}
          </div>
          {reactionMoments && reactionMoments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {reactionMoments.map((reaction) => (
                <button key={reaction._id} onClick={() => seekTo(reaction.timestampMs)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--hover)]" style={{ background: "var(--panel2)", color: ACCENT }}>
                  <span>{reaction.emoji}</span><span>{fmtTime(reaction.timestampMs)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="pointer-events-none absolute inset-0">
            {floats.map((f) => (
              <span
                key={f.id}
                className="vfloat absolute bottom-0 text-2xl"
                style={{ left: `${f.x}%` }}
              >
                {f.emoji}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Comments + transcript */}
      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {data.allowComments && (
          <section className="lg:col-span-3">
            <h2 className="mb-4 text-lg font-bold">
              Comments{" "}
              {comments && comments.length > 0 && (
                <span className="text-[var(--muted)]">{comments.length}</span>
              )}
            </h2>

            <div
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="field rounded-lg px-3 py-2 text-sm"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (required)"
                  className="field rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Add a comment at ${fmtTime(activeMs)}…`}
                rows={2}
                className="field mt-2 w-full resize-none rounded-lg px-3 py-2 text-sm"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: "var(--panel2)", color: ACCENT }}>Comment at {fmtTime(activeMs)}</span>
                <button
                  onClick={submitComment}
                  disabled={posting}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: ACCENT }}
                >
                  {posting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" /> Post
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {comments && comments.length > 0 ? (
                comments.map((c) => (
                  <div key={c._id} className="flex gap-3">
                    {c.authorImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.authorImage}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold"
                        style={{ background: "var(--panel2)" }}
                      >
                        {c.authorName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {c.authorName}
                        </span>
                        {c.timestampMs !== undefined && (
                          <button
                            onClick={() => seekTo(c.timestampMs!)}
                            className="rounded px-1.5 py-0.5 text-xs font-medium"
                            style={{
                              background: "rgba(255,90,54,.14)",
                              color: ACCENT,
                            }}
                          >
                            {fmtTime(c.timestampMs)}
                          </button>
                        )}
                      </div>
                      <div
                        className="text-sm leading-relaxed text-[var(--muted)] [&_p]:m-0"
                        dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Be the first to comment.
                </p>
              )}
            </div>
          </section>
        )}

        {segs.length > 0 && (
          <section className="lg:col-span-2">
            <h2 className="mb-4 text-lg font-bold">Ask this video</h2>
            <div className="mb-4 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <div className="flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitQuestion(); }} maxLength={500} placeholder="What should I know or where is…?" className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm" /><button type="button" disabled={asking || question.trim().length < 3} onClick={() => void submitQuestion()} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white disabled:opacity-50" style={{ background: ACCENT }}>{asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}</button></div>
              <div className="mt-2 flex flex-wrap gap-1.5">{["What are the key steps?", "Summarize the main takeaway"].map((prompt) => <button key={prompt} type="button" onClick={() => void submitQuestion(prompt)} className="rounded-full border px-2.5 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]" style={{ borderColor: "var(--border)" }}>{prompt}</button>)}</div>
              <label className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[var(--muted)]"><input type="checkbox" checked={askConsent} onChange={(event) => setAskConsent(event.target.checked)} className="mt-0.5" /><span>I agree that my question and relevant transcript excerpts may be processed by the configured AI provider under the privacy policy. Do not include sensitive information.</span></label>
              {answer && <div className="mt-3 rounded-lg p-3" style={{ background: "var(--panel2)" }}><p className="text-sm leading-5">{answer.answer}</p>{answer.citations.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{answer.citations.map((citation, index) => <button key={`${citation.startMs}-${index}`} type="button" onClick={() => seekTo(citation.startMs)} title={citation.label} className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: ACCENT }}>{fmtTime(citation.startMs)} · Watch</button>)}</div>}</div>}
            </div>
            <h2 className="mb-4 text-lg font-bold">Transcript</h2>
            <div
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={tquery}
                  onChange={(e) => setTquery(e.target.value)}
                  placeholder="Search transcript…"
                  className="field w-full rounded-lg py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <div className="scroll-thin max-h-[440px] space-y-0.5 overflow-y-auto pr-1">
                {filteredSegs.map((s, i) => {
                  const active = activeMs >= s.start && activeMs < s.end;
                  return (
                    <button
                      key={`${s.start}-${i}`}
                      onClick={() => seekTo(s.start)}
                      className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--hover)]"
                      style={
                        active ? { background: "rgba(255,90,54,.1)" } : undefined
                      }
                    >
                      <span
                        className="shrink-0 pt-0.5 font-mono text-xs"
                        style={{ color: ACCENT }}
                      >
                        {fmtTime(s.start)}
                      </span>
                      <span className="text-[var(--muted)]">{s.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
