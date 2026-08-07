import { TestModeWorkspace } from "@/components/test-mode/test-mode-workspace";

export default async function TestModePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <TestModeWorkspace initialView={view === "library" || view === "analytics" || view === "about" ? view : "record"} />;
}
