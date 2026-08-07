import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: [{
      userAgent: "*",
      allow: ["/demo/access", "/videoflow-demo-og.png", "/logo.svg"],
      disallow: ["/demo", "/api/", "/test", "/v/", "/videos", "/record", "/analytics", "/transcripts", "/sign-in", "/sign-up"],
    }],
    sitemap: `${appConfig.url}/sitemap.xml`,
    host: appConfig.url,
  };
}
