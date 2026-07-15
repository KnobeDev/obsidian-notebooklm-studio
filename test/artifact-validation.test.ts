import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { validateArtifactFile } from "../src/job-runner";

// NotebookLM writes audio overviews as an M4A/MPEG-4 container whose first box is
// `ftyp` (bytes 4-8), e.g. `00 00 00 18 66 74 79 70 69 73 6f 36`, NOT an MP3.
const M4A_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x36, 0x00, 0x00, 0x00, 0x00]);
const MP3_HEADER = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

let scratch: string;

async function fixture(name: string, bytes: Buffer): Promise<{ file: string; size: number; hash: string }> {
  const file = path.join(scratch, name);
  await fs.writeFile(file, bytes);
  return { file, size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
}

describe("validateArtifactFile", () => {
  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "notebooklm-studio-validation-"));
  });
  afterAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  test("accepts a real M4A/MPEG-4 audio overview", async () => {
    const { file, size, hash } = await fixture("audio.m4a", M4A_HEADER);
    await expect(validateArtifactFile(file, ".m4a", size, hash)).resolves.toBeUndefined();
  });

  test("rejects audio that is not an MPEG-4 container", async () => {
    const { file, size, hash } = await fixture("not-audio.m4a", Buffer.from("this is plain text, not ftyp"));
    await expect(validateArtifactFile(file, ".m4a", size, hash)).rejects.toThrow(/not an M4A/i);
  });

  test("the previous MP3 magic-byte check no longer runs — a bare ID3 header is not treated as audio", async () => {
    // Regression guard: the old `.mp3` branch would have accepted this and rejected M4A.
    // `.mp3` is no longer produced, so it falls through with no format check.
    const { file, size, hash } = await fixture("legacy.mp3", MP3_HEADER);
    await expect(validateArtifactFile(file, ".mp3", size, hash)).resolves.toBeUndefined();
  });

  test("still validates the MP4 video ftyp box", async () => {
    const { file, size, hash } = await fixture("video.mp4", M4A_HEADER);
    await expect(validateArtifactFile(file, ".mp4", size, hash)).resolves.toBeUndefined();
    const bad = await fixture("bad.mp4", Buffer.from("no ftyp box here at all"));
    await expect(validateArtifactFile(bad.file, ".mp4", bad.size, bad.hash)).rejects.toThrow(/not an MP4/i);
  });

  test("rejects a size mismatch before reading the header", async () => {
    const { file, hash } = await fixture("audio2.m4a", M4A_HEADER);
    await expect(validateArtifactFile(file, ".m4a", M4A_HEADER.length + 1, hash)).rejects.toThrow(/invalid type or size/i);
  });

  test("rejects an integrity (hash) mismatch", async () => {
    const { file, size } = await fixture("audio3.m4a", M4A_HEADER);
    await expect(validateArtifactFile(file, ".m4a", size, "0".repeat(64))).rejects.toThrow(/integrity validation/i);
  });
});
