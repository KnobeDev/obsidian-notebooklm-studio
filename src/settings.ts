import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { labelSetting, repairSecretWarnings } from "./accessibility";
import type NotebookLmStudioPlugin from "./main";
import type { ProviderKind } from "./providers";

export class NotebookLmStudioSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: NotebookLmStudioPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("notebooklm-studio-settings");
    containerEl.createEl("h2", { text: "NotebookLM Studio" });
    containerEl.createEl("p", { text: "Cloud API keys stay in Obsidian's keychain. NotebookLM authentication remains in notebooklm-py's local profile." });
    const providerSetting = new Setting(containerEl).setName("Default AI provider").setDesc("The provider curates the selected notes before NotebookLM generation.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ ollama: "Ollama (local)", openai: "OpenAI", anthropic: "Claude (Anthropic)", gemini: "Gemini" })
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value as ProviderKind;
          await this.plugin.saveSettings();
          this.display();
          const replacement = this.containerEl.querySelector<HTMLSelectElement>("select");
          replacement?.focus();
        }));
    labelSetting(providerSetting, "notebooklm-studio-default-provider");

    const provider = this.plugin.settings.provider;
    const modelSetting = new Setting(containerEl).setName(`${provider} model`).setDesc("Exact provider model identifier.")
      .addText((text) => text.setValue(this.plugin.settings.models[provider]).onChange(async (value) => {
        this.plugin.settings.models[provider] = value.trim(); await this.plugin.saveSettings();
      }));
    labelSetting(modelSetting, "notebooklm-studio-provider-model");
    if (provider === "ollama") {
      const endpointSetting = new Setting(containerEl).setName("Ollama endpoint").setDesc("Only a loopback HTTP endpoint is accepted.")
        .addText((text) => text.setValue(this.plugin.settings.ollamaBaseUrl).onChange(async (value) => {
          this.plugin.settings.ollamaBaseUrl = value.trim(); await this.plugin.saveSettings();
        }));
      labelSetting(endpointSetting, "notebooklm-studio-provider-endpoint");
    }

    containerEl.createEl("h3", { text: "API keys in Obsidian keychain" });
    containerEl.createEl("p", { text: "Select an existing Obsidian secret or create one. Plugin data stores only the secret name; the API key remains in Obsidian SecretStorage." });
    for (const cloudProvider of ["openai", "anthropic", "gemini"] as const) {
      const secretSetting = new Setting(containerEl)
        .setName(`${cloudProvider} API key`)
        .setDesc("Obsidian keychain secret used for this provider.")
        .addComponent((element) => new SecretComponent(this.app, element)
          .setValue(this.plugin.settings.secretNames[cloudProvider])
          .onChange(async (value) => {
            this.plugin.settings.secretNames[cloudProvider] = value;
            await this.plugin.saveSettings();
          }));
      labelSetting(secretSetting, `notebooklm-studio-${cloudProvider}-secret`);
      repairSecretWarnings(secretSetting.controlEl);
    }

    containerEl.createEl("h3", { text: "NotebookLM companion" });
    containerEl.createEl("p", { text: "The companion uses the system Python and notebooklm commands. Install notebooklm-py and authenticate once with notebooklm login." });
    const profileSetting = new Setting(containerEl).setName("NotebookLM profile").setDesc("Named local notebooklm-py authentication profile.")
      .addText((text) => text.setValue(this.plugin.settings.notebooklmProfile).onChange(async (value) => { this.plugin.settings.notebooklmProfile = value.trim() || "default"; await this.plugin.saveSettings(); }));
    labelSetting(profileSetting, "notebooklm-studio-notebooklm-profile");
    const keepSetting = new Setting(containerEl).setName("Keep remote notebook").setDesc("Keep the NotebookLM notebook after local downloads. Disable to delete only the temporary notebook created for the job.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.keepRemoteNotebook).onChange(async (value) => { this.plugin.settings.keepRemoteNotebook = value; await this.plugin.saveSettings(); }));
    labelSetting(keepSetting, "notebooklm-studio-keep-remote-notebook");
  }
}
