"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { demoAnalyticsContext, trackDemoEvent } from "@/lib/demo-analytics";

function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (!sessionStorage.getItem("videoflow-demo-analytics-start")) {
      sessionStorage.setItem("videoflow-demo-analytics-start", `${location.pathname}${location.search}`);
      sessionStorage.setItem("videoflow-demo-analytics-start:at", String(Date.now()));
    }
    if (pathname !== "/demo/access") trackDemoEvent("page_viewed", { page: pathname });
  }, [params, pathname]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && location.pathname !== "/demo/access") trackDemoEvent("heartbeat");
    }, 30_000);
    const click = (event: MouseEvent) => {
      const element = (event.target as Element | null)?.closest("a,button,[data-demo-analytics]") as HTMLElement | null;
      if (!element) return;
      if (location.pathname === "/demo/access") return;
      const label = (element.dataset.demoAnalytics || element.getAttribute("aria-label") || element.textContent || "interaction").replace(/\s+/g, " ").trim().slice(0, 120);
      const href = element instanceof HTMLAnchorElement ? element.href : "";
      const purchase = element.dataset.demoAnalytics === "purchase";
      trackDemoEvent(purchase ? "purchase_clicked" : "ui_clicked", { label, ...(href ? { target: href.slice(0, 240) } : {}) });
    };
    document.addEventListener("click", click, true);
    void demoAnalyticsContext();
    return () => { window.clearInterval(interval); document.removeEventListener("click", click, true); };
  }, []);
  return null;
}

export function DemoAnalyticsTracker() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}
