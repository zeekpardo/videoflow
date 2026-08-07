import { redirect } from "next/navigation";
import { DemoVideoEditor } from "@/components/demo/demo-video-editor";
import { getDemoAccessSession } from "@/lib/demo-access-session";

export default async function DemoVideoEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getDemoAccessSession();
  if (!session) redirect("/demo/access");
  const { id } = await params;
  return (
    <DemoVideoEditor
      videoId={id}
      sessionId={session.sessionId}
      expiresAt={session.expiresAt}
    />
  );
}
