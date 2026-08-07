import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return [];
  return [{
    url: new URL("/demo/access", appConfig.url).toString(),
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 1,
  }];
}
