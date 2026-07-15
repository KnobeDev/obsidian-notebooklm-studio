import { describe, expect, it, vi } from "vitest";
import { formatDuration, JobManager } from "../src/core/job-manager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("JobManager", () => {
  it("tracks progress messages with timestamps in the job log", async () => {
    let time = 1_000;
    const manager = new JobManager(() => time);
    const gate = deferred<string>();
    const run = manager.start({ title: "Notes", targetPath: "Notes.md" }, async (_signal, onProgress) => {
      time = 2_000;
      onProgress("Creating a private NotebookLM notebook");
      time = 3_000;
      onProgress("Uploading approved simplified source 1 of 1 to Google NotebookLM");
      return gate.promise;
    });
    gate.resolve("done");
    await run;
    const job = manager.current;
    expect(job?.state).toBe("succeeded");
    expect(job?.log.map((entry) => entry.message)).toEqual([
      "Starting generation",
      "Creating a private NotebookLM notebook",
      "Uploading approved simplified source 1 of 1 to Google NotebookLM",
      "Generation finished"
    ]);
    expect(job?.log[1]).toMatchObject({ time: 2_000 });
    expect(job?.updatedAt).toBe(3_000);
  });

  it("notifies subscribers on every update and supports unsubscribe", async () => {
    const manager = new JobManager(() => 0);
    const seen: string[] = [];
    const unsubscribe = manager.subscribe((job) => seen.push(`${job.state}:${job.message}`));
    await manager.start({ title: "T", targetPath: "T.md" }, async (_signal, onProgress) => {
      onProgress("step one");
      return "ok";
    });
    expect(seen).toEqual([
      "running:Starting generation",
      "running:step one",
      "succeeded:Generation finished"
    ]);
    unsubscribe();
    await manager.start({ title: "T", targetPath: "T.md" }, async () => "ok");
    expect(seen).toHaveLength(3);
  });

  it("marks the job failed and preserves the error message", async () => {
    const manager = new JobManager(() => 0);
    await expect(manager.start({ title: "T", targetPath: "T.md" }, async () => {
      throw new Error("The selected AI provider returned HTTP 401. Check its key, model, endpoint, and quota.");
    })).rejects.toThrow("HTTP 401");
    expect(manager.current?.state).toBe("failed");
    expect(manager.current?.error).toContain("HTTP 401");
    expect(manager.isRunning).toBe(false);
  });

  it("aborts a running job and records the cancelled state", async () => {
    const manager = new JobManager(() => 0);
    const run = manager.start({ title: "T", targetPath: "T.md" }, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Generation was cancelled.")), { once: true });
    }));
    expect(manager.abort()).toBe(true);
    await expect(run).rejects.toThrow("cancelled");
    expect(manager.current?.state).toBe("cancelled");
    expect(manager.abort()).toBe(false);
  });

  it("refuses to start a second job while one is running", async () => {
    const manager = new JobManager(() => 0);
    const gate = deferred<string>();
    const first = manager.start({ title: "A", targetPath: "A.md" }, () => gate.promise);
    await expect(manager.start({ title: "B", targetPath: "B.md" }, async () => "b"))
      .rejects.toThrow("already running");
    gate.resolve("done");
    await first;
    await expect(manager.start({ title: "B", targetPath: "B.md" }, async () => "b")).resolves.toBe("b");
  });

  it("caps the job log at the configured number of entries", async () => {
    const manager = new JobManager(() => 0, 5);
    await manager.start({ title: "T", targetPath: "T.md" }, async (_signal, onProgress) => {
      for (let index = 1; index <= 20; index += 1) onProgress(`step ${index}`);
      return "ok";
    });
    expect(manager.current?.log).toHaveLength(5);
    expect(manager.current?.log.at(-1)?.message).toBe("Generation finished");
    expect(manager.current?.log[0]?.message).toBe("step 17");
  });

  it("ignores progress reported after the job settles", async () => {
    const manager = new JobManager(() => 0);
    let lateProgress: (message: string) => void = () => undefined;
    await manager.start({ title: "T", targetPath: "T.md" }, async (_signal, onProgress) => {
      lateProgress = onProgress;
      return "ok";
    });
    const settledLog = manager.current?.log.length;
    lateProgress("straggler");
    expect(manager.current?.log.length).toBe(settledLog);
    expect(manager.current?.state).toBe("succeeded");
  });

  it("isolates a throwing subscriber so the job outcome is unaffected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const manager = new JobManager(() => 0);
      const healthy: string[] = [];
      manager.subscribe(() => { throw new Error("listener exploded"); });
      manager.subscribe((job) => healthy.push(job.message));
      await expect(manager.start({ title: "T", targetPath: "T.md" }, async (_signal, onProgress) => {
        onProgress("step one");
        return "ok";
      })).resolves.toBe("ok");
      expect(manager.current?.state).toBe("succeeded");
      expect(healthy).toEqual(["Starting generation", "step one", "Generation finished"]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("treats an abort that surfaces as a foreign error as cancelled", async () => {
    const manager = new JobManager(() => 0);
    const run = manager.start({ title: "T", targetPath: "T.md" }, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("child process killed")), { once: true });
    }));
    manager.abort();
    await expect(run).rejects.toThrow("child process killed");
    expect(manager.current?.state).toBe("cancelled");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
    expect(formatDuration(-50)).toBe("0s");
  });
});
