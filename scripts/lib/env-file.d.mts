export function parseEnvText(source: string): Map<string, string>;

export function patchEnvText(
  source: string,
  updates: Record<string, string | null>,
  header?: string,
): string;
