import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/providers/app-provider";
import { Toaster } from "@/components/ui/sonner";
import { appConfig } from "@/lib/config";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.url),
  applicationName: appConfig.name,
  title: { default: appConfig.name, template: `%s | ${appConfig.name}` },
  description: "Record, edit, and share polished async video messages.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: appConfig.brandColor };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${mono.variable} antialiased`} style={{ "--primary": appConfig.brandColor, "--ring": appConfig.brandColor } as React.CSSProperties}><AppProvider>{children}<Toaster /></AppProvider></body></html>;
}
