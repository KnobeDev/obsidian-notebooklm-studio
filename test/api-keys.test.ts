import { describe, expect, test } from "vitest";
import { resolveProviderApiKey } from "../src/core/api-keys";

describe("session API key resolution", () => {
  test("uses a value retrieved from Obsidian SecretStorage", () => {
    expect(resolveProviderApiKey("openai", "  keychain-key  ")).toBe("keychain-key");
  });

  test("returns undefined when no keychain secret is selected", () => {
    expect(resolveProviderApiKey("anthropic", "")).toBeUndefined();
    expect(resolveProviderApiKey("gemini", undefined)).toBeUndefined();
  });

  test("never returns a credential for local Ollama", () => {
    expect(resolveProviderApiKey("ollama", "should-not-be-used")).toBeUndefined();
  });
});
