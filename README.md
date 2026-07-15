# NotebookLM Studio for Obsidian

NotebookLM Studio is a desktop-only Obsidian community plugin that turns a selected note or folder into locally saved learning and communication artifacts.

It can use:

- Ollama on loopback for local source curation
- OpenAI, Claude/Anthropic, or Gemini for cloud curation
- [`teng-lin/notebooklm-py`](https://github.com/teng-lin/notebooklm-py) for NotebookLM audio, video, slide deck, infographic, quiz, flashcard, report, data-table, and mind-map generation

Generated files are written under `NotebookLM Studio/<job-title>-<timestamp>/` inside the note's parent folder or selected folder. Every job includes its curated Markdown source and a secret-free JSON manifest.

## Important privacy boundary

Selecting Ollama keeps the optional curation step local. It does **not** make NotebookLM local. The approved curated source is still uploaded to Google NotebookLM so NotebookLM can generate the artifacts. The generation dialog names both destinations and requires explicit consent each time.

`notebooklm-py` is an unofficial client for undocumented Google NotebookLM APIs. Google changes can temporarily break it. Do not use this workflow for material you are not permitted to send to the selected AI provider and Google.

## Prerequisites

1. Install Python 3.10 or later.
2. Install and authenticate `notebooklm-py` using its current documented flow:

   ```bash
   pip install "notebooklm-py[browser]==0.7.3"
   playwright install chromium
   notebooklm login
   notebooklm auth check --test --json
   ```

3. For Ollama, run Ollama locally and pull the model configured in the plugin settings.
4. For a cloud curator, select an existing secret or create one using the Obsidian keychain control in the generation dialog or plugin settings. The plugin stores only the secret name and retrieves the API key through `app.secretStorage` when a job begins.

## Install for development

```bash
npm install
npm run build
ln -s /absolute/path/to/obsidian-notebooklm-studio /path/to/vault/.obsidian/plugins/notebooklm-studio
```

Enable **NotebookLM Studio** in Obsidian's Community plugins settings. Right-click a note or folder and choose **Create NotebookLM artifacts**, or run **Create NotebookLM artifacts from active note** from the command palette.

## Supported vault sources

The initial release recursively bundles text-oriented Obsidian content: Markdown, plain text, CSV, JSON, HTML, XML, and YAML. It excludes hidden folders, `.obsidian`, existing `NotebookLM Studio` output folders, and unsupported binary files. The selected Ollama or cloud provider simplifies the full corpus in bounded, source-labelled chunks; only the combined simplified corpus is uploaded to NotebookLM. PDF, image, audio, and video source staging is planned for a later release; generated artifacts can already use all nine requested output formats.

## Output and recovery behavior

- Existing files are never overwritten.
- The Python companion receives only a private temporary source bundle and staging directory, not broad vault access.
- The TypeScript side validates every companion-reported filename before copying it into the vault.
- Cancelling terminates the companion and removes its temporary local staging directory. Any already-created remote NotebookLM notebook may remain and can be managed in NotebookLM.
- By default, the temporary remote notebook is removed after successful downloads (and best-effort cleanup is attempted after failures or cancellation). Enable **Keep remote notebook** if you want it retained in NotebookLM.

## Development checks

```bash
npm test
npm run test:coverage
npm run test:python
npm run build
```

The default test suite is fully offline. Live Ollama, cloud-provider, and NotebookLM calls are intentionally not part of CI.

## Security notes

- Child processes use argument arrays with `shell: false`.
- Cloud endpoints require HTTPS; local Ollama HTTP is limited to loopback.
- Vault and companion paths are containment-checked.
- Provider content is wrapped as untrusted source material and no tools are exposed to the curator.
- API keys, Google cookies, and NotebookLM authentication are not written into the vault or job manifests.

## License

MIT
