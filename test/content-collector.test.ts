import { describe, expect, test } from "vitest";
import { collectTextSources, type SourceEntry } from "../src/core/content-collector";

const entries: SourceEntry[] = [
  { path: "Course/z.md", extension: "md", content: "Z" },
  { path: "Course/a.md", extension: "md", content: "A" },
  { path: "Course/image.png", extension: "png", content: "binary" },
  { path: ".obsidian/private.md", extension: "md", content: "secret" },
  { path: "Course/NotebookLM Studio/old.md", extension: "md", content: "old" }
];

describe("content collection", () => {
  test("collects supported text deterministically and excludes generated/hidden content", () => {
    const result = collectTextSources(entries, { maxFileChars: 100, maxTotalChars: 1000 });
    expect(result.files.map((file) => file.path)).toEqual(["Course/a.md", "Course/z.md"]);
    expect(result.bundle).toContain("# Source: Course/a.md\n\nA");
  });

  test("fails before upload when limits are exceeded", () => {
    expect(() => collectTextSources([{ path: "big.md", extension: "md", content: "x".repeat(11) }], {
      maxFileChars: 10,
      maxTotalChars: 100
    })).toThrow(/big.md/);
  });

  test("rejects empty supported selections", () => {
    expect(() => collectTextSources(entries.filter((entry) => entry.extension === "png"), {
      maxFileChars: 100,
      maxTotalChars: 100
    })).toThrow(/supported/i);
  });
});
