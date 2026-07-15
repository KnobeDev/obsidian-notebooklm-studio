import { describe, expect, test } from "vitest";
import { parseBridgeEvent, validateReadyArtifact } from "../src/bridge/protocol";

describe("bridge protocol", () => {
  test("accepts versioned progress and result events", () => {
    expect(parseBridgeEvent('{"protocolVersion":1,"requestId":"r1","type":"progress","stage":"uploading","message":"Uploading"}'))
      .toMatchObject({ type: "progress", stage: "uploading" });
  });

  test("rejects malformed or incompatible events", () => {
    expect(() => parseBridgeEvent("not-json")).toThrow(/JSON/);
    expect(() => parseBridgeEvent('{"protocolVersion":2,"requestId":"r1","type":"complete"}')).toThrow(/version/i);
  });

  test.each([
    '{"protocolVersion":1,"requestId":"r1","type":"hello","capabilities":[]}',
    '{"protocolVersion":1,"requestId":"r1","type":"progress","stage":2,"message":"x"}',
    '{"protocolVersion":1,"requestId":"r1","type":"artifact_ready","artifact":null}',
    '{"protocolVersion":1,"requestId":"r1","type":"complete","notebookId":2,"keptRemoteNotebook":true}',
    '{"protocolVersion":1,"requestId":"r1","type":"error","code":2,"message":"x"}'
  ])("rejects invalid event shapes", (line) => {
    expect(() => parseBridgeEvent(line)).toThrow(/invalid|missing/i);
  });

  test("never trusts a companion-supplied path", () => {
    expect(validateReadyArtifact({ kind: "report", relativePath: "report.md", size: 5, sha256: "a".repeat(64) })).toBe("report.md");
    expect(() => validateReadyArtifact({ kind: "report", relativePath: "../outside.md", size: 5, sha256: "a".repeat(64) })).toThrow();
  });
});
