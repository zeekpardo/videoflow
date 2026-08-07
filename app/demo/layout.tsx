import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoAnalyticsTracker } from "@/components/demo/demo-analytics-tracker";

export const metadata: Metadata = {
  title: "Interactive demo",
  description: "Try VideoFlow recording and editing privately in your browser.",
  robots: { index: false, follow: false, nocache: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") notFound();
  return <><DemoAnalyticsTracker />{children}</>;
}
