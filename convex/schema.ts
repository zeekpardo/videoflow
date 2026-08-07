import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const mode = v.union(v.literal("screen"), v.literal("screen_camera"), v.literal("camera"));
const transcriptStatus = v.union(v.literal("none"), v.literal("pending"), v.literal("done"), v.literal("error"), v.literal("too_large"));
const zoomEffect = v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), scale: v.number() });
const editStateV1 = v.object({
  version: v.literal(1),
  cuts: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number() })),
  crop: v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() }),
  screen: v.object({ x: v.number(), y: v.number(), scale: v.number(), cornerRadius: v.number() }),
  camera: v.optional(v.object({
    x: v.number(),
    y: v.number(),
    size: v.number(),
    shape: v.union(v.literal("circle"), v.literal("rounded"), v.literal("square")),
    strokeWidth: v.optional(v.number()),
    strokeColor: v.optional(v.string()),
    mirror: v.boolean(),
    visible: v.boolean(),
  })),
  textOverlays: v.array(v.object({
    id: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    text: v.string(),
    x: v.number(),
    y: v.number(),
    fontSize: v.number(),
    color: v.string(),
    background: v.string(),
  })),
});
const timedObject = v.object({
  id: v.string(),
  kind: v.union(v.literal("rectangle"), v.literal("ellipse"), v.literal("arrow"), v.literal("callout"), v.literal("image")),
  startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), width: v.number(), height: v.number(),
  rotation: v.number(), opacity: v.number(), zIndex: v.number(), fill: v.string(), stroke: v.string(), strokeWidth: v.number(),
  text: v.optional(v.string()), textColor: v.optional(v.string()), fontSize: v.optional(v.number()), assetId: v.optional(v.string()),
});
const editStateV2 = v.object({
  version: v.literal(2),
  trim: v.object({ startMs: v.number(), endMs: v.number() }),
  cuts: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number() })),
  crop: v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() }),
  screen: v.object({ x: v.number(), y: v.number(), scale: v.number(), cornerRadius: v.number() }),
  camera: v.optional(v.object({
    x: v.number(), y: v.number(), size: v.number(),
    shape: v.union(v.literal("circle"), v.literal("rounded"), v.literal("square")),
    strokeWidth: v.optional(v.number()), strokeColor: v.optional(v.string()), mirror: v.boolean(), visible: v.boolean(),
  })),
  textOverlays: v.array(v.object({
    id: v.string(), startMs: v.number(), endMs: v.number(), text: v.string(), x: v.number(), y: v.number(),
    fontSize: v.number(), color: v.string(), background: v.string(),
  })),
  audio: v.object({ muted: v.boolean(), gain: v.number(), fadeInMs: v.number(), fadeOutMs: v.number() }),
  objects: v.array(timedObject),
  interactions: v.object({
    clicksEnabled: v.boolean(), keysEnabled: v.boolean(),
    clicks: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), color: v.string(), size: v.number() })),
    keys: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), label: v.string(), x: v.number(), y: v.number() })),
  }),
});
const editState = v.union(editStateV1, editStateV2);

const captionStyle = v.object({
  preset: v.union(v.literal("minimal"), v.literal("karaoke"), v.literal("pop"), v.literal("lower_third")),
  position: v.union(v.literal("top"), v.literal("middle"), v.literal("bottom")),
  textColor: v.string(),
  highlightColor: v.string(),
  backgroundColor: v.string(),
  fontScale: v.number(),
  burnIn: v.boolean(),
});

const captionCue = v.object({
  id: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  text: v.string(),
  words: v.optional(v.array(v.object({ text: v.string(), startMs: v.number(), endMs: v.number() }))),
});

const shareCta = v.object({ label: v.string(), url: v.string() });

export default defineSchema({
  videos: defineTable({
    ownerId: v.string(),
    ownerName: v.string(),
    ownerEmail: v.optional(v.string()),
    ownerImage: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    storageId: v.string(),
    screenStorageId: v.optional(v.string()),
    screenSizeBytes: v.optional(v.number()),
    cameraStorageId: v.optional(v.string()),
    cameraSizeBytes: v.optional(v.number()),
    audioStorageId: v.optional(v.string()),
    audioSizeBytes: v.optional(v.number()),
    thumbnailStorageId: v.optional(v.string()),
    zoomEffects: v.optional(v.array(zoomEffect)),
    editState: v.optional(editState),
    editRevision: v.optional(v.number()),
    finishedRenditionStorageId: v.optional(v.string()),
    finishedRenditionSizeBytes: v.optional(v.number()),
    finishedRenditionMimeType: v.optional(v.string()),
    finishedRenditionDurationMs: v.optional(v.number()),
    finishedRenditionRevision: v.optional(v.number()),
    finishedRenditionStatus: v.optional(v.union(v.literal("rendering"), v.literal("ready"), v.literal("error"))),
    finishedRenditionError: v.optional(v.string()),
    finishedRenditionUpdatedAt: v.optional(v.number()),
    durationMs: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    mode,
    mimeType: v.string(),
    sizeBytes: v.number(),
    visibility: v.union(v.literal("private"), v.literal("public")),
    shareToken: v.optional(v.string()),
    cta: v.optional(v.object({ label: v.string(), url: v.string() })),
    allowComments: v.boolean(),
    allowReactions: v.boolean(),
    allowDownload: v.boolean(),
    passwordSalt: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    transcriptStatus,
    viewCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_share_token", ["shareToken"])
    .index("by_finished_status_updated", ["finishedRenditionStatus", "finishedRenditionUpdatedAt"]),

  videoAssets: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    assetId: v.string(),
    storageId: v.string(),
    mimeType: v.union(v.literal("image/png"), v.literal("image/jpeg"), v.literal("image/webp")),
    sizeBytes: v.number(),
    width: v.number(),
    height: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_video_asset", ["videoId", "assetId"]),

  videoTranscripts: defineTable({
    videoId: v.id("videos"),
    language: v.optional(v.string()),
    fullText: v.string(),
    segments: v.array(v.object({ start: v.number(), end: v.number(), text: v.string() })),
    createdAt: v.number(),
  }).index("by_video", ["videoId"]),

  videoFolders: defineTable({
    ownerId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("videoFolders")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_parent", ["ownerId", "parentId"]),

  videoOrganization: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    folderId: v.optional(v.id("videoFolders")),
    tags: v.array(v.string()),
    favorite: v.boolean(),
    archivedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_folder", ["ownerId", "folderId"]),

  videoShareLinks: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    token: v.string(),
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    expiresAt: v.optional(v.number()),
    maxViews: v.optional(v.number()),
    viewCount: v.number(),
    requireEmail: v.boolean(),
    allowedDomains: v.array(v.string()),
    allowComments: v.boolean(),
    allowReactions: v.boolean(),
    allowDownload: v.boolean(),
    allowEmbed: v.boolean(),
    embedDomains: v.array(v.string()),
    passwordSalt: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    cta: v.optional(shareCta),
    customTitle: v.optional(v.string()),
    customDescription: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"]),

  videoReviewRequests: defineTable({
    videoId: v.id("videos"),
    shareLinkId: v.id("videoShareLinks"),
    ownerId: v.string(),
    recipientName: v.string(),
    recipientEmail: v.string(),
    message: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("changes_requested"), v.literal("canceled")),
    responseName: v.optional(v.string()),
    responseNote: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    lastRemindedAt: v.optional(v.number()),
    reminderCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_share_link", ["shareLinkId"])
    .index("by_owner", ["ownerId"]),

  videoTaskProposals: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    fingerprint: v.string(),
    sourceKind: v.union(v.literal("transcript"), v.literal("comment"), v.literal("review")),
    sourceId: v.optional(v.string()),
    sourceTimestampMs: v.optional(v.number()),
    title: v.string(),
    description: v.optional(v.string()),
    confidence: v.number(),
    status: v.union(v.literal("proposed"), v.literal("accepted"), v.literal("rejected")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"])
    .index("by_video_fingerprint", ["videoId", "fingerprint"]),

  videoTasks: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    proposalId: v.optional(v.id("videoTaskProposals")),
    sourceCommentId: v.optional(v.id("videoComments")),
    sourceKind: v.union(v.literal("transcript"), v.literal("comment"), v.literal("review"), v.literal("manual")),
    sourceTimestampMs: v.optional(v.number()),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"])
    .index("by_proposal", ["proposalId"]),

  socialConnections: defineTable({
    ownerId: v.string(),
    provider: v.union(v.literal("youtube"), v.literal("linkedin"), v.literal("zernio")),
    name: v.string(),
    accountRef: v.optional(v.string()),
    targetPlatform: v.optional(v.union(
      v.literal("twitter"), v.literal("instagram"), v.literal("tiktok"), v.literal("youtube"),
      v.literal("facebook"), v.literal("linkedin"), v.literal("bluesky"), v.literal("threads"),
      v.literal("reddit"), v.literal("pinterest"), v.literal("telegram"), v.literal("snapchat"),
      v.literal("googlebusiness"), v.literal("discord"),
    )),
    workerBindingHash: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_provider", ["ownerId", "provider"]),

  socialPublishJobs: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    connectionId: v.id("socialConnections"),
    provider: v.union(v.literal("youtube"), v.literal("linkedin"), v.literal("zernio")),
    editRevision: v.number(),
    title: v.string(),
    caption: v.string(),
    privacy: v.union(v.literal("private"), v.literal("unlisted"), v.literal("public")),
    idempotencyKey: v.string(),
    providerRequestId: v.optional(v.string()),
    status: v.union(v.literal("queued"), v.literal("leased"), v.literal("uploading"), v.literal("publishing"), v.literal("published"), v.literal("retry_wait"), v.literal("failed"), v.literal("canceled"), v.literal("superseded")),
    progress: v.number(),
    attempts: v.number(),
    availableAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    providerPostId: v.optional(v.string()),
    providerPostUrl: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"])
    .index("by_connection", ["connectionId"])
    .index("by_connection_status_available", ["connectionId", "status", "availableAt"])
    .index("by_idempotency", ["idempotencyKey"]),

  videoShareLinkSessions: defineTable({
    shareLinkId: v.id("videoShareLinks"),
    tokenHash: v.string(),
    viewerEmail: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_share_link", ["shareLinkId"])
    .index("by_expiry", ["expiresAt"]),

  videoCaptionTracks: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    language: v.string(),
    revision: v.number(),
    cues: v.array(captionCue),
    style: captionStyle,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"]),

  videoInteractiveElements: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    kind: v.union(v.literal("chapter"), v.literal("hotspot"), v.literal("cta"), v.literal("poll")),
    startMs: v.number(),
    endMs: v.number(),
    label: v.string(),
    description: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    url: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    required: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"]),

  videoInteractionEvents: defineTable({
    videoId: v.id("videos"),
    shareLinkId: v.optional(v.id("videoShareLinks")),
    elementId: v.id("videoInteractiveElements"),
    viewerKey: v.string(),
    event: v.union(v.literal("shown"), v.literal("clicked"), v.literal("answered")),
    value: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_element", ["elementId"]),

  videoTemplates: defineTable({
    ownerId: v.string(),
    name: v.string(),
    background: v.string(),
    screenPadding: v.number(),
    screenRadius: v.number(),
    screenShadow: v.boolean(),
    cameraPosition: v.union(v.literal("bottom_left"), v.literal("bottom_right"), v.literal("top_left"), v.literal("top_right")),
    captionPreset: v.union(v.literal("minimal"), v.literal("karaoke"), v.literal("pop"), v.literal("lower_third")),
    introTitle: v.optional(v.string()),
    outroTitle: v.optional(v.string()),
    defaultCta: v.optional(shareCta),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  videoDocuments: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    kind: v.union(v.literal("sop"), v.literal("tutorial"), v.literal("release_notes"), v.literal("recap"), v.literal("email")),
    title: v.string(),
    body: v.string(),
    visuals: v.optional(v.array(v.object({ assetId: v.string(), timestampMs: v.number(), caption: v.string() }))),
    status: v.union(v.literal("ready"), v.literal("error")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_owner", ["ownerId"]),

  mediaJobs: defineTable({
    videoId: v.id("videos"),
    ownerId: v.string(),
    kind: v.union(v.literal("render"), v.literal("thumbnail"), v.literal("transcript"), v.literal("document")),
    editRevision: v.number(),
    preset: v.union(v.literal("native"), v.literal("1080p"), v.literal("720p")),
    format: v.union(v.literal("mp4"), v.literal("webm")),
    status: v.union(v.literal("queued"), v.literal("leased"), v.literal("processing"), v.literal("uploading"), v.literal("verifying"), v.literal("ready"), v.literal("retry_wait"), v.literal("failed"), v.literal("canceled"), v.literal("superseded")),
    progress: v.number(),
    attempts: v.number(),
    availableAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    outputStorageId: v.optional(v.string()),
    outputMimeType: v.optional(v.string()),
    outputSizeBytes: v.optional(v.number()),
    outputDurationMs: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_video", ["videoId"])
    .index("by_status_available", ["status", "availableAt"]),

  videoComments: defineTable({
    videoId: v.id("videos"),
    shareLinkId: v.optional(v.id("videoShareLinks")),
    guestName: v.string(),
    guestEmail: v.string(),
    timestampMs: v.optional(v.number()),
    bodyHtml: v.string(),
    taskId: v.optional(v.id("videoTasks")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_video", ["videoId"]),

  videoReactions: defineTable({
    videoId: v.id("videos"),
    shareLinkId: v.optional(v.id("videoShareLinks")),
    emoji: v.string(),
    viewerKey: v.string(),
    timestampMs: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_video_viewer_emoji", ["videoId", "viewerKey", "emoji"])
    .index("by_share_viewer_emoji", ["shareLinkId", "viewerKey", "emoji"]),

  videoViews: defineTable({
    videoId: v.id("videos"),
    shareLinkId: v.optional(v.id("videoShareLinks")),
    viewerKey: v.string(),
    watchedMs: v.number(),
    maxPositionMs: v.number(),
    percentWatched: v.number(),
    completed: v.boolean(),
    userAgent: v.optional(v.string()),
    referrer: v.optional(v.string()),
    startedAt: v.number(),
    lastAt: v.number(),
  })
    .index("by_video", ["videoId"])
    .index("by_video_viewer", ["videoId", "viewerKey"])
    .index("by_share_viewer", ["shareLinkId", "viewerKey"]),

  videoShareSessions: defineTable({
    videoId: v.id("videos"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_video", ["videoId"])
    .index("by_expiry", ["expiresAt"]),

  pendingUploads: defineTable({
    key: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_owner", ["ownerId"])
    .index("by_created", ["createdAt"]),

  multipartUploads: defineTable({
    ownerId: v.string(),
    key: v.string(),
    uploadId: v.string(),
    contentType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
    partSizeBytes: v.number(),
    status: v.union(v.literal("uploading"), v.literal("completed"), v.literal("aborted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_key", ["key"])
    .index("by_expiry", ["expiresAt"]),

  multipartParts: defineTable({
    ownerId: v.string(),
    uploadSessionId: v.id("multipartUploads"),
    partNumber: v.number(),
    etag: v.string(),
    sizeBytes: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session", ["uploadSessionId"])
    .index("by_session_part", ["uploadSessionId", "partNumber"]),

  publicRateLimits: defineTable({
    key: v.string(),
    action: v.string(),
    count: v.number(),
    windowStart: v.number(),
  })
    .index("by_key_action", ["key", "action"])
    .index("by_window", ["windowStart"]),

});
