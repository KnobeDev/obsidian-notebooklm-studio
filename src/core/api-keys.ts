import type { ProviderKind } from "../providers";

export function resolveProviderApiKey(
  provider: ProviderKind,
  keychainValue: string | undefined
): string | undefined {
  if (provider === "ollama") return undefined;
  return keychainValue?.trim() || undefined;
}
