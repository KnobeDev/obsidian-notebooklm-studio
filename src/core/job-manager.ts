export type JobState = "running" | "succeeded" | "failed" | "cancelled";

export interface JobLogEntry {
  readonly time: number;
  readonly message: string;
}

export interface JobSnapshot {
  readonly id: number;
  readonly title: string;
  readonly targetPath: string;
  readonly state: JobState;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly message: string;
  readonly log: readonly JobLogEntry[];
  readonly error?: string;
}

export type JobRunner<T> = (signal: AbortSignal, onProgress: (message: string) => void) => Promise<T>;

export const JOB_STATE_LABELS: Record<JobState, string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled"
};

const DEFAULT_MAX_LOG_ENTRIES = 200;

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export class JobManager {
  private controller: AbortController | null = null;
  private job: JobSnapshot | null = null;
  private nextId = 1;
  private readonly listeners = new Set<(job: JobSnapshot) => void>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxLogEntries = DEFAULT_MAX_LOG_ENTRIES
  ) {}

  get current(): JobSnapshot | null { return this.job; }

  get isRunning(): boolean { return this.job?.state === "running"; }

  subscribe(listener: (job: JobSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  abort(): boolean {
    if (!this.isRunning || !this.controller) return false;
    this.controller.abort();
    return true;
  }

  async start<T>(descriptor: { title: string; targetPath: string }, runner: JobRunner<T>): Promise<T> {
    if (this.isRunning) throw new Error("A NotebookLM generation is already running. Abort it or wait for it to finish.");
    const controller = new AbortController();
    this.controller = controller;
    const startedAt = this.now();
    const jobId = this.nextId++;
    this.job = {
      id: jobId,
      title: descriptor.title,
      targetPath: descriptor.targetPath,
      state: "running",
      startedAt,
      updatedAt: startedAt,
      message: "Starting generation",
      log: [{ time: startedAt, message: "Starting generation" }]
    };
    this.notify();
    try {
      const result = await runner(controller.signal, (message) => this.recordProgress(jobId, message));
      this.settle(jobId, { state: "succeeded", message: "Generation finished" });
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (controller.signal.aborted) this.settle(jobId, { state: "cancelled", message: "Generation was cancelled." });
      else this.settle(jobId, { state: "failed", message, error: message });
      throw cause;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private recordProgress(jobId: number, message: string): void {
    if (!this.job || this.job.id !== jobId || this.job.state !== "running") return;
    this.applyUpdate(message, {});
  }

  private settle(jobId: number, patch: { state: JobState; message: string; error?: string }): void {
    if (!this.job || this.job.id !== jobId || this.job.state !== "running") return;
    this.applyUpdate(patch.message, patch);
  }

  private applyUpdate(message: string, patch: Partial<Pick<JobSnapshot, "state" | "error">>): void {
    if (!this.job) return;
    const time = this.now();
    const log = [...this.job.log, { time, message }].slice(-this.maxLogEntries);
    this.job = { ...this.job, ...patch, message, updatedAt: time, log };
    this.notify();
  }

  private notify(): void {
    const job = this.job;
    if (!job) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(job);
      } catch (error) {
        console.error("NotebookLM Studio: a job status listener failed.", error);
      }
    }
  }
}
