import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { runBridge } from "../src/bridge/client";
import type { BridgeRequest } from "../src/bridge/protocol";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

const request: BridgeRequest = { protocolVersion: 1, requestId: "r1", operation: "preflight" };

describe("bridge client", () => {
  beforeEach(() => vi.clearAllMocks());

  test("correlates progress, artifacts, and completion", async () => {
    const child = fakeChild();
    const events = vi.fn();
    const resultPromise = runBridge("python3", "/plugin/bridge.py", request, new AbortController().signal, events);
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"hello","companionVersion":"0.1.0","capabilities":["report"]}\n');
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"progress","stage":"generating","message":"Working"}\n');
    child.stdout.write(`{"protocolVersion":1,"requestId":"r1","type":"artifact_ready","artifact":{"kind":"report","relativePath":"report.md","size":5,"sha256":"${"a".repeat(64)}"}}\n`);
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"complete","notebookId":"nb1","keptRemoteNotebook":true}\n');
    const result = await resultPromise;
    expect(result).toMatchObject({ notebookId: "nb1", artifacts: [{ relativePath: "report.md" }] });
    expect(events).toHaveBeenCalledTimes(4);
  });

  test("terminates the companion on cancellation", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const result = runBridge("python3", "/plugin/bridge.py", request, controller.signal, vi.fn());
    controller.abort();
    await expect(result).rejects.toThrow(/cancelled/i);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("resolves a preflight run that completes without artifacts", async () => {
    const child = fakeChild();
    const resultPromise = runBridge("python3", "/plugin/bridge.py", request, new AbortController().signal, vi.fn());
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"hello","companionVersion":"0.1.0","capabilities":["report"]}\n');
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"complete","notebookId":"","keptRemoteNotebook":true}\n');
    await expect(resultPromise).resolves.toMatchObject({ notebookId: "", artifacts: [] });
  });

  test("surfaces the companion's actionable message when preflight fails", async () => {
    const child = fakeChild();
    const resultPromise = runBridge("python3", "/plugin/bridge.py", request, new AbortController().signal, vi.fn());
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"hello","companionVersion":"0.1.0","capabilities":[]}\n');
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"error","code":"FILENOTFOUNDERROR","message":"The notebooklm command was not found. Install the pinned notebooklm-py prerequisite and restart Obsidian."}\n');
    await expect(resultPromise).rejects.toThrow(/notebooklm command was not found/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("rejects a mismatched request ID", async () => {
    const child = fakeChild();
    const result = runBridge("python3", "/plugin/bridge.py", request, new AbortController().signal, vi.fn());
    child.stdout.write('{"protocolVersion":1,"requestId":"r1","type":"hello","companionVersion":"0.1.0","capabilities":[]}\n');
    child.stdout.write('{"protocolVersion":1,"requestId":"other","type":"complete","notebookId":"nb1","keptRemoteNotebook":true}\n');
    await expect(result).rejects.toThrow(/request ID/i);
  });
});
