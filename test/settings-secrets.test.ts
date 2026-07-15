import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, migrateStoredSettings, parseStoredSettings, type NotebookLmStudioSettings } from "../src/types";

describe("Obsidian SecretStorage references", () => {
  test("stores only keychain secret names for cloud providers", () => {
    expect(DEFAULT_SETTINGS.secretNames).toEqual({ openai: "", anthropic: "", gemini: "" });
    expect(DEFAULT_SETTINGS).not.toHaveProperty("apiKeys");
  });

  test("drops legacy plaintext credential fields during settings migration", () => {
    const settings = parseStoredSettings({
      provider: "openai",
      apiKey: "plaintext-old-key",
      apiKeys: { openai: "plaintext-old-key" },
      secretNames: { openai: "my-openai-key" },
      unknownCredential: "plaintext-old-key"
    });

    expect(settings.provider).toBe("openai");
    expect(settings.secretNames.openai).toBe("my-openai-key");
    expect(settings).not.toHaveProperty("apiKey");
    expect(settings).not.toHaveProperty("apiKeys");
    expect(settings).not.toHaveProperty("unknownCredential");
    expect(JSON.stringify(settings)).not.toContain("plaintext-old-key");
  });

  test("immediately persists the sanitized settings during plugin startup", async () => {
    let persisted: NotebookLmStudioSettings | undefined;
    const persist = vi.fn(async (value: NotebookLmStudioSettings) => { persisted = value; });
    const settings = await migrateStoredSettings(
      async () => ({ apiKey: "plaintext-old-key", apiKeys: { gemini: "plaintext-old-key" }, secretNames: { gemini: "gemini-keychain-id" } }),
      persist
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(settings);
    expect(JSON.stringify(persisted)).not.toContain("plaintext-old-key");
    expect(persisted?.secretNames.gemini).toBe("gemini-keychain-id");
  });
});
