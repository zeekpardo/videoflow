import { WorkerRenderClient } from "@/components/worker-render-client";

export const metadata = { robots: { index: false, follow: false } };

export default function WorkerRenderPage() {
  return <WorkerRenderClient />;
}
