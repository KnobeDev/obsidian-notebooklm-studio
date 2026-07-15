import type { ArtifactKind } from "./core/artifacts";
import type { ProviderKind } from "./providers";

export interface NotebookLmStudioSettings {
  provider: ProviderKind;
  models: Record<ProviderKind, string>;
  secretNames: Record<Exclude<ProviderKind, "ollama">, string>;
  ollamaBaseUrl: string;
  notebooklmProfile: string;
  language: string;
  keepRemoteNotebook: boolean;
  maxFileChars: number;
  maxTotalChars: number;
  defaultArtifacts: ArtifactKind[];
}

export const DEFAULT_SETTINGS: NotebookLmStudioSettings = {
  provider: "ollama",
  models: { ollama: "llama3.2", openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-5", gemini: "gemini-2.5-flash" },
  secretNames: { openai: "", anthropic: "", gemini: "" },
  ollamaBaseUrl: "http://127.0.0.1:11434",
  notebooklmProfile: "default",
  language: "en",
  keepRemoteNotebook: false,
  maxFileChars: 500_000,
  maxTotalChars: 2_000_000,
  defaultArtifacts: ["audio", "report"]
};

const PROVIDERS: ProviderKind[] = ["ollama", "openai", "anthropic", "gemini"];

export function parseStoredSettings(value: unknown): NotebookLmStudioSettings {
  const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const savedModels = saved.models && typeof saved.models === "object" ? saved.models as Record<string, unknown> : {};
  const savedSecrets = saved.secretNames && typeof saved.secretNames === "object" ? saved.secretNames as Record<string, unknown> : {};
  const provider = PROVIDERS.includes(saved.provider as ProviderKind) ? saved.provider as ProviderKind : DEFAULT_SETTINGS.provider;
  const stringValue = (candidate: unknown, fallback: string) => typeof candidate === "string" ? candidate : fallback;
  const positiveNumber = (candidate: unknown, fallback: number) => typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
  const artifactKinds = new Set(DEFAULT_SETTINGS.defaultArtifacts.concat(["video", "slide-deck", "infographic", "quiz", "flashcards", "data-table", "mind-map"]));
  const defaultArtifacts = Array.isArray(saved.defaultArtifacts)
    ? saved.defaultArtifacts.filter((item): item is ArtifactKind => typeof item === "string" && artifactKinds.has(item as ArtifactKind))
    : DEFAULT_SETTINGS.defaultArtifacts;

  return {
    provider,
    models: Object.fromEntries(PROVIDERS.map((name) => [name, stringValue(savedModels[name], DEFAULT_SETTINGS.models[name])])) as Record<ProviderKind, string>,
    secretNames: {
      openai: stringValue(savedSecrets.openai, ""),
      anthropic: stringValue(savedSecrets.anthropic, ""),
      gemini: stringValue(savedSecrets.gemini, "")
    },
    ollamaBaseUrl: stringValue(saved.ollamaBaseUrl, DEFAULT_SETTINGS.ollamaBaseUrl),
    notebooklmProfile: stringValue(saved.notebooklmProfile, DEFAULT_SETTINGS.notebooklmProfile),
    language: stringValue(saved.language, DEFAULT_SETTINGS.language),
    keepRemoteNotebook: typeof saved.keepRemoteNotebook === "boolean" ? saved.keepRemoteNotebook : DEFAULT_SETTINGS.keepRemoteNotebook,
    maxFileChars: positiveNumber(saved.maxFileChars, DEFAULT_SETTINGS.maxFileChars),
    maxTotalChars: positiveNumber(saved.maxTotalChars, DEFAULT_SETTINGS.maxTotalChars),
    defaultArtifacts: defaultArtifacts.length > 0 ? defaultArtifacts : DEFAULT_SETTINGS.defaultArtifacts
  };
}

export async function migrateStoredSettings(
  load: () => Promise<unknown>,
  persist: (settings: NotebookLmStudioSettings) => Promise<void>
): Promise<NotebookLmStudioSettings> {
  const settings = parseStoredSettings(await load());
  await persist(settings);
  return settings;
}

export interface GenerationOptions {
  title: string;
  instructions: string;
  provider: ProviderKind;
  apiKey?: string;
  artifacts: ArtifactKind[];
  consent: boolean;
}
