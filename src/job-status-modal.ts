import { Modal } from "obsidian";
import { createFocusTrap } from "./accessibility";
import { formatDuration, JOB_STATE_LABELS, type JobSnapshot, type JobState } from "./core/job-manager";
import type NotebookLmStudioPlugin from "./main";

const REFRESH_INTERVAL_MS = 5_000;

export class JobStatusModal extends Modal {
  private static nextId = 0;
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private stateEl!: HTMLElement;
  private messageEl!: HTMLElement;
  private announceEl!: HTMLElement;
  private timingEl!: HTMLElement;
  private logEl!: HTMLOListElement;
  private abortButton!: HTMLButtonElement;
  private restartButton!: HTMLButtonElement;
  private closeButton!: HTMLButtonElement;
  private renderedLogCount = 0;
  private renderedJobId: number | null = null;
  private announcedState: JobState | null = null;
  private trapFocus = createFocusTrap(this.modalEl);

  constructor(private readonly plugin: NotebookLmStudioPlugin) { super(plugin.app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("notebooklm-studio-modal", "notebooklm-studio-job-status");
    const titleId = `notebooklm-studio-job-status-${++JobStatusModal.nextId}`;
    this.modalEl.setAttrs({ role: "dialog", "aria-modal": "true", "aria-labelledby": titleId });
    this.modalEl.addEventListener("keydown", this.trapFocus);
    const heading = contentEl.createEl("h2", { text: "NotebookLM generation status", attr: { id: titleId, tabindex: "-1" } });
    heading.focus();

    const summary = contentEl.createDiv({ cls: "notebooklm-studio-job-summary" });
    this.stateEl = summary.createDiv({ cls: "notebooklm-studio-job-state" });
    this.messageEl = summary.createDiv({ cls: "notebooklm-studio-status" });
    this.timingEl = summary.createDiv({ cls: "notebooklm-studio-job-timing" });
    this.announceEl = summary.createDiv({
      cls: "notebooklm-studio-sr-only",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" }
    });

    contentEl.createEl("h3", { text: "Progress log" });
    const logRegion = contentEl.createDiv({
      cls: "notebooklm-studio-job-log",
      attr: { tabindex: "0", role: "group", "aria-label": "Generation progress log, oldest first" }
    });
    this.logEl = logRegion.createEl("ol");

    const actions = contentEl.createDiv({ cls: "notebooklm-studio-actions" });
    this.abortButton = actions.createEl("button", { text: "Abort generation" });
    this.abortButton.addEventListener("click", () => {
      this.closeButton.focus();
      this.abortButton.disabled = true;
      this.abortButton.setText("Aborting…");
      this.plugin.jobs.abort();
    });
    this.restartButton = actions.createEl("button", { text: "Restart last generation" });
    this.restartButton.addEventListener("click", () => { void this.plugin.restartLastGeneration(); });
    this.closeButton = actions.createEl("button", { text: "Close", cls: "mod-cta" });
    this.closeButton.addEventListener("click", () => this.close());

    this.render(this.plugin.jobs.current);
    this.unsubscribe = this.plugin.jobs.subscribe((job) => this.render(job));
    this.refreshTimer = window.setInterval(() => this.renderTiming(this.plugin.jobs.current), REFRESH_INTERVAL_MS);
  }

  private render(job: JobSnapshot | null): void {
    if (!job) {
      this.stateEl.setText("No generation has run in this session.");
      this.messageEl.setText("Start one from a note, folder context menu, or the ribbon icon.");
      this.timingEl.setText("");
      this.abortButton.disabled = true;
      this.restartButton.disabled = !this.plugin.canRestartLastGeneration();
      return;
    }
    if (this.renderedJobId !== job.id) {
      this.renderedJobId = job.id;
      this.renderedLogCount = 0;
      this.announcedState = null;
      this.logEl.empty();
    }
    this.stateEl.setText(`${JOB_STATE_LABELS[job.state]}: ${job.title} (${job.targetPath})`);
    this.messageEl.setText(job.state === "failed" && job.error ? `Failed: ${job.error}` : job.message);
    this.renderTiming(job);
    if (this.announcedState !== job.state) {
      this.announcedState = job.state;
      this.announceEl.setText(job.state === "failed" && job.error
        ? `Generation failed: ${job.error}`
        : `Generation ${JOB_STATE_LABELS[job.state].toLowerCase()}: ${job.title}`);
    }
    for (const entry of job.log.slice(this.renderedLogCount)) {
      const item = this.logEl.createEl("li");
      item.createEl("time", {
        text: new Date(entry.time).toLocaleTimeString(),
        attr: { datetime: new Date(entry.time).toISOString() }
      });
      item.createSpan({ text: ` ${entry.message}` });
    }
    this.renderedLogCount = job.log.length;
    if (job.state !== "running") {
      this.abortButton.disabled = true;
      this.abortButton.setText("Abort generation");
    } else if (this.abortButton.textContent !== "Aborting…") {
      this.abortButton.disabled = false;
    }
    this.restartButton.disabled = job.state === "running" || !this.plugin.canRestartLastGeneration();
  }

  private renderTiming(job: JobSnapshot | null): void {
    if (!job) return;
    const now = Date.now();
    const elapsed = formatDuration((job.state === "running" ? now : job.updatedAt) - job.startedAt);
    if (job.state === "running") {
      this.timingEl.setText(`Running for ${elapsed}. Last update ${formatDuration(now - job.updatedAt)} ago. Audio and video artifacts can take 10 to 30 minutes.`);
    } else {
      this.timingEl.setText(`${JOB_STATE_LABELS[job.state]} after ${elapsed}.`);
    }
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.modalEl.removeEventListener("keydown", this.trapFocus);
    this.contentEl.empty();
    this.returnFocus?.focus();
  }
}
