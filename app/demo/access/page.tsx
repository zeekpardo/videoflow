import { DemoAccessForm } from "@/components/demo/demo-access-form";
import { getDemoAccessSession } from "@/lib/demo-access-session";
import { appConfig } from "@/lib/config";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

const title = "Try the private VideoFlow recording and editing demo";
const description = "Record your screen and camera, edit on a visual timeline, add zooms, text, graphics, and export—all privately in your browser for 72 hours.";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["screen recorder", "video recorder", "Loom alternative", "video editor", "screen recording software", "async video"],
  alternates: { canonical: "/demo/access" },
  openGraph: {
    type: "website",
    url: "/demo/access",
    siteName: appConfig.name,
    title,
    description,
    images: [{ url: "/videoflow-demo-og.png", width: 1200, height: 630, alt: "VideoFlow screen recorder and timeline editor" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/videoflow-demo-og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
};

export default async function DemoAccessPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") notFound();
  if (await getDemoAccessSession()) redirect("/demo");
  return <DemoAccessForm />;
}
