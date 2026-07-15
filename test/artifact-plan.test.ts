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
      expect.objectContaining({ kind: "audio", filename: "Topic-audio-overview.mp3" }),
      expect.objectContaining({ kind: "quiz", filename: "Topic-quiz.md" })
    ]);
  });

  test("requires at least one artifact", () => {
    expect(() => planArtifacts([], "Topic")).toThrow(/one artifact/i);
  });
});
