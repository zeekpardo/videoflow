import { redirect } from "next/navigation";
import { DemoWorkspace } from "@/components/demo/demo-workspace";
import { getDemoAccessSession } from "@/lib/demo-access-session";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getDemoAccessSession();
  if (!session) redirect("/demo/access");
  const query = await searchParams;
  return (
    <DemoWorkspace
      sessionId={session.sessionId}
      expiresAt={session.expiresAt}
      initialView={query.view === "library" ? "library" : "record"}
    />
  );
}
