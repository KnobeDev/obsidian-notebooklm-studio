import { Modal, Notice, SecretComponent, Setting, TFolder, type TAbstractFile } from "obsidian";
import { createFocusTrap, labelSetting, repairSecretWarnings } from "./accessibility";
import { ARTIFACT_DEFINITIONS, type ArtifactKind } from "./core/artifacts";
import type NotebookLmStudioPlugin from "./main";
import type { ProviderKind } from "./providers";

export class GenerationModal extends Modal {
  private static nextId = 0;
  private startedHere = false;
  private jobUnsubscribe: (() => void) | null = null;
  private returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private trapFocus = createFocusTrap(this.modalEl);

  constructor(private readonly plugin: NotebookLmStudioPlugin, private readonly target: TAbstractFile) { super(plugin.app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("notebooklm-studio-modal");
    const titleId = `notebooklm-studio-title-${++GenerationModal.nextId}`;
    this.modalEl.setAttrs({ role: "dialog", "aria-modal": "true", "aria-labelledby": titleId });
    this.modalEl.addEventListener("keydown", this.trapFocus);
    const heading = contentEl.createEl("h2", { text: "Create NotebookLM artifacts", attr: { id: titleId, tabindex: "-1" } });
    heading.focus();
    contentEl.createEl("p", { text: `Source: ${this.target.path}` });

    let title = this.target.name.replace(/\.[^.]+$/, "");
    let instructions = "Create accurate, accessible learning materials. Preserve important nuance and identify uncertainty.";
    let provider: ProviderKind = this.plugin.settings.provider;
    let secretName = provider === "ollama" ? "" : this.plugin.settings.secretNames[provider];
    const selected = new Set<ArtifactKind>(this.plugin.settings.defaultArtifacts);
    let consent = false;
    let status: HTMLDivElement | null = null;

    const titleSetting = new Setting(contentEl).setName("Job title").setDesc("Used for the NotebookLM notebook and local filenames.")
      .addText((text) => text.setValue(title).onChange((value) => { title = value.trim(); }));
    labelSetting(titleSetting, `${titleId}-job-title`);
    const providerSetting = new Setting(contentEl).setName("AI provider").setDesc("Ollama curates locally; cloud providers receive the selected content.")
      .addDropdown((dropdown) => dropdown.addOptions({ ollama: "Ollama (local)", openai: "OpenAI", anthropic: "Claude", gemini: "Gemini" })
        .setValue(provider).onChange((value) => {
          provider = value as ProviderKind;
          secretName = provider === "ollama" ? "" : this.plugin.settings.secretNames[provider];
          secretComponent.setValue(secretName);
          secretSetting.setName(`${provider} API key in Obsidian keychain`);
          secretSetting.settingEl.toggle(provider !== "ollama");
          consent = false;
          consentInput.checked = false;
          updateDisclosure();
          status?.setText(`Provider changed to ${provider}. Review and approve the updated content-transfer disclosure.`);
        }));
    labelSetting(providerSetting, `${titleId}-provider`);
    let secretComponent!: SecretComponent;
    let secretContainer!: HTMLElement;
    const secretSetting = new Setting(contentEl)
      .setName(`${provider} API key in Obsidian keychain`)
      .setDesc("Select an existing secret or create one. Only its name is saved in plugin settings.")
      .addComponent((element) => {
        secretContainer = element;
        secretComponent = new SecretComponent(this.app, element)
          .setValue(secretName)
          .onChange(async (value) => {
            secretName = value;
            if (provider !== "ollama") {
              this.plugin.settings.secretNames[provider] = value;
              await this.plugin.saveSettings();
            }
          });
        return secretComponent;
      });
    labelSetting(secretSetting, `${titleId}-api-key`);
    repairSecretWarnings(secretContainer);
    secretSetting.settingEl.toggle(provider !== "ollama");
    const instructionsSetting = new Setting(contentEl).setName("Artifact instructions").setDesc("Plain-language emphasis, audience, or style guidance.")
      .addTextArea((area) => area.setValue(instructions).onChange((value) => { instructions = value; }));
    labelSetting(instructionsSetting, `${titleId}-instructions`);

    const fieldset = contentEl.createEl("fieldset", { cls: "notebooklm-studio-artifacts" });
    fieldset.createEl("legend", { text: "Create these artifacts" });
    for (const artifact of ARTIFACT_DEFINITIONS) {
      const label = fieldset.createEl("label");
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = selected.has(artifact.kind);
      checkbox.addEventListener("change", () => checkbox.checked ? selected.add(artifact.kind) : selected.delete(artifact.kind));
      label.createSpan({ text: `${artifact.label} — ${artifact.hint}` });
    }

    const disclosure = contentEl.createDiv({ cls: "notebooklm-studio-disclosure" });
    disclosure.createEl("h3", { text: "Where your content goes" });
    const disclosureText = disclosure.createEl("p");
    const consentLabel = disclosure.createEl("label", { cls: "notebooklm-studio-consent" });
    const consentInput = consentLabel.createEl("input", { type: "checkbox" });
    const consentText = consentLabel.createSpan();
    consentInput.addEventListener("change", () => { consent = consentInput.checked; });
    const updateDisclosure = () => {
      const curator = provider === "ollama" ? "local Ollama" : provider;
      const parent = this.target instanceof TFolder ? this.target.path : this.target.parent?.path || "the vault root";
      disclosureText.setText(`Selected content is sent to ${curator} for curation, then uploaded to Google NotebookLM through the unofficial notebooklm-py client. Generated files are saved beneath ${parent}/NotebookLM Studio.`);
      consentText.setText(`I understand the selected vault content will be sent to ${curator} and Google NotebookLM.`);
    };
    updateDisclosure();

    const error = contentEl.createDiv({ cls: "notebooklm-studio-error", attr: { role: "alert", tabindex: "-1" } });
    error.hide();
    status = contentEl.createDiv({ cls: "notebooklm-studio-status", attr: { role: "status", "aria-live": "polite", "aria-atomic": "true", tabindex: "-1" } });
    const backgroundHint = contentEl.createEl("p", { cls: "notebooklm-studio-background-hint" });
    backgroundHint.setText("Generation runs in the background. Closing this dialog does not stop it; track progress in the status bar or the 'Show generation status' command.");
    backgroundHint.hide();
    const actions = contentEl.createDiv({ cls: "notebooklm-studio-actions" });
    let abortRequested = false;
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      if (this.startedHere && this.plugin.jobs.isRunning) {
        if (abortRequested) return;
        abortRequested = true;
        cancel.setText("Aborting…");
        cancel.setAttribute("aria-disabled", "true");
        status?.setText("Cancellation requested; waiting for the current step to stop.");
        this.plugin.jobs.abort();
        return;
      }
      this.close();
    });
    const create = actions.createEl("button", { text: "Create artifacts", cls: "mod-cta" });
    create.addEventListener("click", async () => {
      error.hide();
      if (this.plugin.jobs.isRunning) {
        error.setText("A NotebookLM generation is already running. Use the status bar item or the 'Show generation status' command to watch or abort it first.");
        error.show(); error.focus(); return;
      }
      const missingSecret = provider !== "ollama" && (!secretName || !this.app.secretStorage.getSecret(secretName));
      if (!title || selected.size === 0 || missingSecret || !consent) {
        error.setText(!title ? "Enter a job title." : selected.size === 0 ? "Select at least one artifact." : missingSecret ? `Select or create a valid ${provider} API key in the Obsidian keychain.` : "Approve the content-transfer disclosure.");
        error.show(); error.focus(); return;
      }
      create.disabled = true;
      cancel.setText("Abort generation");
      backgroundHint.show();
      this.startedHere = true;
      this.jobUnsubscribe = this.plugin.jobs.subscribe((job) => {
        if (job.state === "running") status?.setText(job.message);
      });
      try {
        const result = await this.plugin.startGenerationJob(this.target, { title, instructions, provider, artifacts: [...selected], consent });
        status.setText(`${result.files.length} files saved in ${result.outputFolder}.`);
        cancel.setText("Close"); create.remove();
        backgroundHint.hide();
        cancel.focus();
      } catch (cause) {
        const cancelled = this.plugin.jobs.current?.state === "cancelled";
        if (cancelled) {
          status.setText("Generation was cancelled.");
          create.disabled = false;
          create.focus();
        } else {
          error.setText(cause instanceof Error ? cause.message : String(cause));
          error.show(); error.focus();
          create.disabled = false;
        }
        cancel.setText("Cancel");
        backgroundHint.hide();
      } finally {
        this.startedHere = false;
        abortRequested = false;
        cancel.removeAttribute("aria-disabled");
        this.jobUnsubscribe?.();
        this.jobUnsubscribe = null;
      }
    });
  }

  onClose(): void {
    this.jobUnsubscribe?.();
    this.jobUnsubscribe = null;
    if (this.startedHere && this.plugin.jobs.isRunning) {
      new Notice("NotebookLM Studio: generation continues in the background. Watch the status bar or run 'Show generation status'.", 8_000);
    }
    this.contentEl.empty();
    this.modalEl.removeEventListener("keydown", this.trapFocus);
    this.returnFocus?.focus();
  }
}
