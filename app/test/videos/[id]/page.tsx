import { LocalVideoEditor } from "@/components/test-mode/local-video-editor";

export default async function LocalVideoEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LocalVideoEditor videoId={id} />;
}
