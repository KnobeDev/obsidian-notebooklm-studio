import { describe, expect, test, vi } from "vitest";
import { curateContent, type HttpTransport, type ProviderConfig } from "../src/providers";

const config = (provider: ProviderConfig["provider"]): ProviderConfig => ({
  provider,
  model: provider === "ollama" ? "llama3.2" : "model",
  baseUrl: provider === "ollama" ? "http://127.0.0.1:11434" : undefined,
  apiKey: provider === "ollama" ? undefined : "test-key"
});

describe("provider adapters", () => {
  test.each([
    ["ollama", { message: { content: "Ollama result" } }],
    ["openai", { choices: [{ message: { content: "OpenAI result" } }] }],
    ["anthropic", { content: [{ type: "text", text: "Claude result" }] }],
    ["gemini", { candidates: [{ content: { parts: [{ text: "Gemini result" }] } }] }]
  ] as const)("normalizes %s responses", async (provider, response) => {
    const post = vi.fn().mockResolvedValue(response);
    const result = await curateContent(config(provider), "source", "instructions", { post } as HttpTransport);
    expect(result).toMatch(/result$/);
    expect(post).toHaveBeenCalledOnce();
  });

  test("rejects cloud calls without a key", async () => {
    await expect(curateContent({ provider: "openai", model: "gpt-4.1" }, "x", "y", {
      post: vi.fn()
    })).rejects.toThrow(/API key/i);
  });

  test("rejects insecure remote custom endpoints", async () => {
    await expect(curateContent({ provider: "openai", model: "x", apiKey: "key", baseUrl: "http://example.com" }, "x", "y", {
      post: vi.fn()
    })).rejects.toThrow(/HTTPS/i);
  });
});
