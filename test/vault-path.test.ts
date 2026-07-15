import { describe, expect, test } from "vitest";
import { assertSafeRelativePath, resolveInside, safeOutputPath, sanitizeFilename } from "../src/core/vault-path";

describe("vault path safety", () => {
  test.each(["../escape", "/absolute", "C:\\escape", "\\\\server\\share", "a\0b"])(
    "rejects unsafe path %s",
    (value) => expect(() => assertSafeRelativePath(value)).toThrow()
  );

  test("normalizes harmless separators and preserves Unicode", () => {
    expect(assertSafeRelativePath(" Notes//Résumé ")).toBe("Notes/Résumé");
  });

  test("keeps the output beneath the selected folder", () => {
    expect(safeOutputPath("Research", "overview.mp3")).toBe("Research/overview.mp3");
    expect(() => safeOutputPath("Research", "../elsewhere.mp3")).toThrow();
  });

  test("sanitizes artifact names without injecting folders", () => {
    expect(sanitizeFilename("Climate: 2026 / briefing", ".md")).toBe("Climate- 2026 - briefing.md");
    expect(() => sanitizeFilename("..", ".md")).toThrow();
  });

  test("resolves only inside an allowed filesystem directory", () => {
    expect(resolveInside("/tmp/stage", "report.md")).toBe("/tmp/stage/report.md");
    expect(() => resolveInside("/tmp/stage", "../outside.md")).toThrow();
  });
});
