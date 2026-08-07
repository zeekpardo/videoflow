import { LocalSharePage } from "@/components/test-mode/local-share-page";

export default async function LocalShareRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LocalSharePage token={token} />;
}
