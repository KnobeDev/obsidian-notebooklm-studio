import path from "node:path";
import { FileSystemAdapter, Menu, Notice, Plugin, TFile, type TAbstractFile } from "obsidian";
import { activateOnKeyboard } from "./accessibility";
import { GenerationModal } from "./generation-modal";
import { JobManager, JOB_STATE_LABELS, formatDuration } from "./core/job-manager";
import { JobStatusModal } from "./job-status-modal";
import { materializeCompanion } from "./companion";
import { connectNotebookLM, checkNotebookLMConnection } from "./auth";
import { runGeneration, type GenerationResult } from "./job-runner";
import { NotebookLmStudioSettingTab } from "./settings";
import { DEFAULT_SETTINGS, migrateStoredSettings, type GenerationOptions, type NotebookLmStudioSettings } from "./types";

const STATUS_BAR_REFRESH_MS = 10_000;
const FAILURE_NOTICE_MS = 15_000;

export default class NotebookLmStudioPlugin extends Plugin {
  settings: NotebookLmStudioSettings = structuredClone(DEFAULT_SETTINGS);
  readonly jobs = new JobManager();
  private companionPath = "";
  private lastRun: { targetPath: string; options: GenerationOptions } | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (!(this.app.vault.adapter instanceof FileSystemAdapter) || !this.manifest.dir) throw new Error("Could not resolve the desktop plugin directory.");
    const pluginDir = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
    this.companionPath = await materializeCompanion(pluginDir);
    this.addSettingTab(new NotebookLmStudioSettingTab(this.app, this));
    this.setupStatusBar();
    this.addCommand({
      id: "generate-from-active-note",
      name: "Create NotebookLM artifacts from active note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) new GenerationModal(this, file).open();
        return true;
      }
    });
    this.addCommand({
      id: "show-job-status",
      name: "Show generation status",
      callback: () => new JobStatusModal(this).open()
    });
    this.addCommand({
      id: "abort-generation",
      name: "Abort the running generation",
      checkCallback: (checking) => {
        if (!this.jobs.isRunning) return false;
        if (!checking) this.jobs.abort();
        return true;
      }
    });
    this.addCommand({
      id: "restart-last-generation",
      name: "Restart the last generation",
      checkCallback: (checking) => {
        if (!this.canRestartLastGeneration()) return false;
        if (!checking) void this.restartLastGeneration();
        return true;
      }
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
      menu.addItem((item) => item.setTitle("Create NotebookLM artifacts").setIcon("audio-waveform").onClick(() => new GenerationModal(this, file).open()));
    }));
    this.addRibbonIcon("audio-waveform", "Create NotebookLM artifacts", () => {
      const file = this.app.workspace.getActiveFile();
      if (file) new GenerationModal(this, file).open();
      else new Notice("Open a note, or use a file/folder context menu first.");
    });
  }

  onunload(): void {
    this.jobs.abort();
  }

  async loadSettings(): Promise<void> {
    this.settings = await migrateStoredSettings(
      () => this.loadData(),
      (settings) => this.saveData(settings)
    );
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  /** Open the browser and sign in to Google NotebookLM for the current profile. */
  signInToNotebookLM(signal: AbortSignal, onProgress: (message: string) => void): Promise<void> {
    return connectNotebookLM(this.companionPath, this.settings.notebooklmProfile, signal, onProgress);
  }

  /** Confirm the companion is installed and the current profile is authenticated. */
  checkNotebookLMAuth(signal: AbortSignal, onProgress: (message: string) => void): Promise<void> {
    return checkNotebookLMConnection(this.companionPath, this.settings.notebooklmProfile, signal, onProgress);
  }

  startGenerationJob(target: TAbstractFile, options: GenerationOptions): Promise<GenerationResult> {
    this.lastRun = { targetPath: target.path, options: structuredClone(options) };
    const run = this.jobs.start(
      { title: options.title, targetPath: target.path },
      (signal, onProgress) => this.generate(target, options, signal, onProgress)
    );
    run.then(
      (result) => new Notice(`NotebookLM Studio: ${result.files.length} files saved in ${result.outputFolder}.`),
      (cause) => {
        const state = this.jobs.current?.state;
        if (state === "cancelled") new Notice("NotebookLM Studio: generation cancelled.");
        else new Notice(`NotebookLM Studio: generation failed. ${cause instanceof Error ? cause.message : String(cause)}`, FAILURE_NOTICE_MS);
      }
    ).catch((cause) => console.error("NotebookLM Studio: could not report the job outcome.", cause));
    return run;
  }

  canRestartLastGeneration(): boolean {
    return this.lastRun !== null && !this.jobs.isRunning;
  }

  async restartLastGeneration(): Promise<void> {
    if (!this.lastRun) {
      new Notice("NotebookLM Studio: no previous generation to restart.");
      return;
    }
    if (this.jobs.isRunning) {
      new Notice("NotebookLM Studio: a generation is already running. Abort it first.");
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(this.lastRun.targetPath);
    if (!target) {
      new Notice(`NotebookLM Studio: the previous source ${this.lastRun.targetPath} no longer exists.`);
      return;
    }
    new Notice(`NotebookLM Studio: restarting generation for ${this.lastRun.targetPath}.`);
    try {
      await this.startGenerationJob(target, this.lastRun.options);
    } catch { /* outcome already surfaced via job notices and the status modal */ }
  }

  private async generate(target: TAbstractFile, options: GenerationOptions, signal: AbortSignal, onProgress: (message: string) => void): Promise<GenerationResult> {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter) || !this.manifest.dir) throw new Error("Could not resolve the desktop plugin directory.");
    let apiKey: string | undefined;
    if (options.provider !== "ollama") {
      const secretName = this.settings.secretNames[options.provider];
      apiKey = secretName ? this.app.secretStorage.getSecret(secretName) || undefined : undefined;
    }
    return runGeneration(this.app, target, { ...options, apiKey }, this.settings, this.companionPath, signal, onProgress);
  }

  private setupStatusBar(): void {
    const item = this.addStatusBarItem();
    item.addClass("mod-clickable", "notebooklm-studio-status-bar");
    item.setAttrs({ role: "button", tabindex: "0", "aria-description": "Activate for details and abort or restart controls." });
    const openStatus = () => new JobStatusModal(this).open();
    item.addEventListener("click", openStatus);
    activateOnKeyboard(item, openStatus);
    item.hide();
    this.statusBarEl = item;
    this.register(this.jobs.subscribe(() => this.renderStatusBar()));
    this.registerInterval(window.setInterval(() => this.renderStatusBar(), STATUS_BAR_REFRESH_MS));
  }

  private renderStatusBar(): void {
    const item = this.statusBarEl;
    if (!item) return;
    const job = this.jobs.current;
    if (!job) {
      item.hide();
      return;
    }
    item.show();
    if (job.state === "running") {
      const sinceUpdate = formatDuration(Date.now() - job.updatedAt);
      item.setText(`NotebookLM: ${job.message} · ${sinceUpdate} ago`);
    } else {
      item.setText(`NotebookLM: ${JOB_STATE_LABELS[job.state].toLowerCase()} — ${job.title}`);
    }
  }
}
