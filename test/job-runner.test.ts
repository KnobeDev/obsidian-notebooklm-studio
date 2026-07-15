import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/bridge/client", () => ({ runBridge: vi.fn() }));
vi.mock("../src/providers", () => ({ curateContent: vi.fn() }));

import { TFile, type App, type TAbstractFile } from "obsidian";
import { runBridge } from "../src/bridge/client";
import { runGeneration } from "../src/job-runner";
import { curateContent } from "../src/providers";
import { DEFAULT_SETTINGS, type GenerationOptions } from "../src/types";

const options: GenerationOptions = {
  title: "Notes",
  instructions: "Simplify",
  provider: "ollama",
  artifacts: ["report"],
  consent: true
};

function fakeVault() {
  const target = Object.assign(new TFile(), { path: "Notes.md", extension: "md" }) as TAbstractFile;
  const app = { vault: { read: vi.fn().mockResolvedValue("# Notes\n\nSome vault content.") } } as unknown as App;
  return { app, target };
}

describe("runGeneration preflight", () => {
  beforeEach(() => vi.clearAllMocks());

  test("fails fast before any AI curation when the companion preflight fails", async () => {
    const { app, target } = fakeVault();
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    vi.mocked(runBridge).mockRejectedValue(new Error("The notebooklm command was not found. Install the pinned notebooklm-py prerequisite and restart Obsidian."));

    await expect(runGeneration(app, target, options, DEFAULT_SETTINGS, "/plugin/bridge.py", signal, onProgress))
      .rejects.toThrow(/notebooklm command was not found/);

    expect(onProgress).toHaveBeenCalledWith("Checking the NotebookLM companion and authentication");
    expect(onProgress).not.toHaveBeenCalledWith("NotebookLM companion and authentication check passed");
    expect(runBridge).toHaveBeenCalledTimes(1);
    expect(runBridge).toHaveBeenCalledWith(
      expect.stringMatching(/^python3?$/),
      "/plugin/bridge.py",
      expect.objectContaining({ protocolVersion: 1, operation: "preflight", profile: "default" }),
      signal,
      expect.any(Function)
    );
    expect(curateContent).not.toHaveBeenCalled();
  });

  test("confirms preflight success and runs it before the first curation call", async () => {
    const { app, target } = fakeVault();
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    vi.mocked(runBridge).mockResolvedValue({ notebookId: "", keptRemoteNotebook: true, artifacts: [] });
    vi.mocked(curateContent).mockRejectedValue(new Error("curation halted by test"));

    await expect(runGeneration(app, target, options, DEFAULT_SETTINGS, "/plugin/bridge.py", signal, onProgress))
      .rejects.toThrow("curation halted by test");

    expect(onProgress).toHaveBeenCalledWith("NotebookLM companion and authentication check passed");

    expect(runBridge).toHaveBeenCalledTimes(1);
    expect(curateContent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runBridge).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(curateContent).mock.invocationCallOrder[0]);
  });
});
