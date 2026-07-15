import { spawn } from "node:child_process";
import readline from "node:readline";
import type { BridgeEvent, BridgeRequest, ReadyArtifact } from "./protocol";
import { parseBridgeEvent, validateReadyArtifact } from "./protocol";

export interface BridgeResult {
  notebookId: string;
  keptRemoteNotebook: boolean;
  artifacts: ReadyArtifact[];
}

export function runBridge(
  pythonExecutable: string,
  scriptPath: string,
  request: BridgeRequest,
  signal: AbortSignal,
  onEvent: (event: BridgeEvent) => void
): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Generation was cancelled."));
      return;
    }
    const child = spawn(pythonExecutable, ["-u", scriptPath], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", NOTEBOOKLM_HOME: process.env.NOTEBOOKLM_HOME || "" },
      detached: process.platform === "win32"
    });
    const artifacts: ReadyArtifact[] = [];
    const artifactKinds = new Set<string>();
    let sawHello = false;
    let settled = false;
    let lines: readline.Interface | null = null;
    const terminate = () => {
      if (process.platform === "win32" && child.pid) {
        const treeKill = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
        treeKill.unref();
      } else {
        child.kill("SIGTERM");
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      timer.unref();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      lines?.close();
      terminate();
      reject(error);
    };
    const abort = () => {
      fail(new Error("Generation was cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => fail(new Error(`Could not start the NotebookLM companion: ${error.message}`)));
    child.stderr.resume();
    lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const event = parseBridgeEvent(line);
        if (event.requestId !== request.requestId) throw new Error("Bridge response request ID did not match.");
        if (!sawHello && event.type !== "hello") throw new Error("Bridge did not begin with a hello event.");
        if (event.type === "hello") {
          if (sawHello) throw new Error("Bridge emitted more than one hello event.");
          sawHello = true;
        }
        onEvent(event);
        if (event.type === "artifact_ready") {
          validateReadyArtifact(event.artifact);
          if (artifactKinds.has(event.artifact.kind)) throw new Error("Bridge emitted a duplicate artifact.");
          artifactKinds.add(event.artifact.kind);
          artifacts.push(event.artifact);
        } else if (event.type === "error") {
          fail(new Error(event.message));
        } else if (event.type === "complete" && !settled) {
          settled = true;
          signal.removeEventListener("abort", abort);
          lines?.close();
          resolve({ notebookId: event.notebookId, keptRemoteNotebook: event.keptRemoteNotebook, artifacts });
        }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (!settled) fail(new Error(`NotebookLM companion exited unexpectedly with code ${code ?? "unknown"}. Run notebooklm auth check --test --json in a terminal for diagnostics.`));
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
