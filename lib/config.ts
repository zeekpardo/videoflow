const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const enabled = (value: string | undefined, fallback = true) => {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() !== "false";
};

export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "VideoFlow",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  logoUrl: process.env.NEXT_PUBLIC_APP_LOGO_URL || "/logo.svg",
  brandColor: process.env.NEXT_PUBLIC_BRAND_COLOR || "#6d5bfc",
  viewerStorageKey: "videoflow-viewer-key",
  themeStorageKey: "videoflow-share-theme",
  maxRecordingMinutes: integer(process.env.NEXT_PUBLIC_MAX_RECORDING_MINUTES, 15),
  maxVideoBytes: integer(process.env.NEXT_PUBLIC_MAX_VIDEO_BYTES, 500 * 1024 * 1024),
  features: {
    mobileCameraSwitch: enabled(process.env.NEXT_PUBLIC_FEATURE_MOBILE_CAMERA_SWITCH),
    libraryDelete: enabled(process.env.NEXT_PUBLIC_FEATURE_LIBRARY_DELETE),
    reviewRequests: enabled(process.env.NEXT_PUBLIC_FEATURE_REVIEW_REQUESTS),
    automaticTasks: enabled(process.env.NEXT_PUBLIC_FEATURE_AUTOMATIC_TASKS),
    socialPublishing: enabled(process.env.NEXT_PUBLIC_FEATURE_SOCIAL_PUBLISHING),
    zernioSocial: enabled(process.env.NEXT_PUBLIC_FEATURE_ZERNIO, false),
  },
} as const;

export const demoConfig = {
  enabled: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  purchaseUrl: process.env.NEXT_PUBLIC_DEMO_PURCHASE_URL || "#purchase",
  privacyUrl: process.env.NEXT_PUBLIC_DEMO_PRIVACY_URL || "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
  maxRecordingMinutes: integer(process.env.NEXT_PUBLIC_DEMO_MAX_RECORDING_MINUTES, 15),
  maxVideoBytes: integer(process.env.NEXT_PUBLIC_DEMO_MAX_VIDEO_BYTES, appConfig.maxVideoBytes),
  maxVideos: integer(process.env.NEXT_PUBLIC_DEMO_MAX_VIDEOS, 10),
} as const;
