import { describe, expect, test } from "vitest";
import { ARTIFACT_DEFINITIONS, planArtifacts } from "../src/core/artifacts";

describe("artifact planning", () => {
  test("supports every requested artifact type", () => {
    expect(ARTIFACT_DEFINITIONS.map((item) => item.kind)).toEqual([
      "audio", "video", "slide-deck", "infographic", "quiz",
      "flashcards", "report", "data-table", "mind-map"
    ]);
  });

  test("deduplicates choices and assigns local formats", () => {
    expect(planArtifacts(["quiz", "audio", "quiz"], "Topic")).toEqual([
      expect.objectContaining({ kind: "audio", filename: "Topic-audio-overview.m4a" }),
      expect.objectContaining({ kind: "quiz", filename: "Topic-quiz.md" })
    ]);
  });

  test("audio artifacts are M4A/MPEG-4, matching what NotebookLM actually returns", () => {
    const audio = ARTIFACT_DEFINITIONS.find((item) => item.kind === "audio");
    expect(audio).toMatchObject({ extension: ".m4a", mime: "audio/mp4" });
  });

  test("requires at least one artifact", () => {
    expect(() => planArtifacts([], "Topic")).toThrow(/one artifact/i);
  });
});
