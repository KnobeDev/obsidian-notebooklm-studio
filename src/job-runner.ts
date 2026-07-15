import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemAdapter, requestUrl, TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import { runBridge } from "./bridge/client";
import { planArtifacts } from "./core/artifacts";
import { resolveProviderApiKey } from "./core/api-keys";
import { collectTextSources, type SourceEntry } from "./core/content-collector";
import { resolveInside, sanitizeFilename } from "./core/vault-path";
import { curateContent, type HttpTransport, type ProviderConfig } from "./providers";
import type { GenerationOptions, NotebookLmStudioSettings } from "./types";

export interface GenerationResult {
  outputFolder: string;
  files: string[];
  notebookId: string;
}

const transport: HttpTransport = {
  async post(url, body, headers) {
    try {
      const response = await requestUrl({ url, method: "POST", headers, body: JSON.stringify(body), throw: false });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`The selected AI provider returned HTTP ${response.status}. Check its key, model, endpoint, and quota.`);
      }
      return response.json;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The selected AI provider returned HTTP")) throw error;
      throw new Error("The selected AI provider could not be reached. Check its endpoint, network access, and local service status.");
    }
  }
};

async function sha256File(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Generation was cancelled.");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Generation was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function pythonExecutable(): string {
  return process.platform === "win32" ? "python" : "python3";
}

async function preflightCompanion(
  companionPath: string,
  profile: string,
  signal: AbortSignal,
  onProgress: (message: string) => void
): Promise<void> {
  onProgress("Checking the NotebookLM companion and authentication");
  await runBridge(
    pythonExecutable(),
    companionPath,
    { protocolVersion: 1, requestId: randomUUID(), operation: "preflight", profile },
    signal,
    (event) => {
      if (event.type === "progress") onProgress(event.message);
    }
  );
  onProgress("NotebookLM companion and authentication check passed");
}

function chunkSource(source: string, maxChars = 60_000): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < source.length; offset += maxChars) chunks.push(source.slice(offset, offset + maxChars));
  return chunks;
}

export async function validateArtifactFile(filename: string, extension: string, expectedSize: number, expectedHash: string): Promise<void> {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize || stat.size > 2 * 1024 ** 3) {
    throw new Error("NotebookLM companion artifact has an invalid type or size.");
  }
  if (await sha256File(filename) !== expectedHash) throw new Error("NotebookLM companion artifact failed integrity validation.");
  const handle = await fs.open(filename, "r");
  const header = Buffer.alloc(16);
  await handle.read(header, 0, header.length, 0);
  await handle.close();
  if (extension === ".png" && !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Downloaded infographic is not a PNG file.");
  if (extension === ".mp4" && header.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("Downloaded video is not an MP4 file.");
  if (extension === ".pptx" && header.subarray(0, 2).toString("ascii") !== "PK") throw new Error("Downloaded slide deck is not a PPTX file.");
  if (extension === ".m4a" && header.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("Downloaded audio is not an M4A (MPEG-4) file.");
  if ([".md", ".csv", ".json"].includes(extension) && header.includes(0)) throw new Error("Downloaded text artifact contains binary data.");
  if (extension === ".json") JSON.parse(await fs.readFile(filename, "utf8"));
}

async function collect(app: App, target: TAbstractFile): Promise<SourceEntry[]> {
  const files: TFile[] = [];
  const visit = (item: TAbstractFile) => {
    if (item instanceof TFile) files.push(item);
    else if (item instanceof TFolder && !item.name.startsWith(".") && item.name !== "NotebookLM Studio") item.children.forEach(visit);
  };
  visit(target);
  const entries: SourceEntry[] = [];
  for (const file of files) {
    if (["md", "txt", "csv", "json", "html", "htm", "xml", "yaml", "yml"].includes(file.extension.toLowerCase())) {
      entries.push({ path: file.path, extension: file.extension, content: await app.vault.read(file) });
    }
  }
  return entries;
}

function workingFolder(target: TAbstractFile): string {
  return target instanceof TFolder ? target.path : target.parent?.path || "";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").replace(/\..+/, "");
}

async function assertNoSymlinkAncestors(vaultBase: string, relativePath: string): Promise<string> {
  const canonicalVault = await fs.realpath(vaultBase);
  let current = vaultBase;
  for (const segment of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Output paths cannot pass through symbolic links.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return canonicalVault;
}

function assertCanonicalContainment(canonicalVault: string, candidate: string): void {
  if (candidate !== canonicalVault && !candidate.startsWith(`${canonicalVault}${path.sep}`)) {
    throw new Error("Output path resolves outside the canonical vault.");
  }
}

export async function runGeneration(
  app: App,
  target: TAbstractFile,
  options: GenerationOptions,
  settings: NotebookLmStudioSettings,
  companionPath: string,
  signal: AbortSignal,
  onProgress: (message: string) => void
): Promise<GenerationResult> {
  if (!options.consent) throw new Error("Approve the content-transfer disclosure before generating artifacts.");
  if (!options.title || options.title.length > 120 || options.instructions.length > 10_000) throw new Error("Keep the title under 120 characters and instructions under 10,000 characters.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(settings.notebooklmProfile)) throw new Error("NotebookLM profile names may contain letters, numbers, periods, underscores, and hyphens.");
  await preflightCompanion(companionPath, settings.notebooklmProfile, signal, onProgress);
  onProgress("Reading selected vault content");
  const collected = collectTextSources(await collect(app, target), {
    maxFileChars: settings.maxFileChars,
    maxTotalChars: settings.maxTotalChars
  });
  if (signal.aborted) throw new Error("Generation was cancelled.");

  const apiKey = resolveProviderApiKey(options.provider, options.apiKey);
  const providerConfig: ProviderConfig = {
    provider: options.provider,
    model: settings.models[options.provider],
    baseUrl: options.provider === "ollama" ? settings.ollamaBaseUrl : undefined,
    apiKey
  };
  const sourceChunks = chunkSource(collected.bundle);
  const curatedChunks: string[] = [];
  for (let index = 0; index < sourceChunks.length; index += 1) {
    onProgress(`Simplifying source material with ${options.provider === "ollama" ? "local Ollama" : options.provider}: chunk ${index + 1} of ${sourceChunks.length}`);
    const simplified = await abortable(curateContent(
      providerConfig,
      sourceChunks[index],
      `${options.instructions}\nSimplify this chunk for NotebookLM while preserving key facts, nuance, headings, and source-path provenance. Do not invent information. This is chunk ${index + 1} of ${sourceChunks.length}.`,
      transport
    ), signal);
    curatedChunks.push(`<!-- Simplified source chunk ${index + 1} of ${sourceChunks.length} -->\n\n${simplified}`);
  }
  const curated = curatedChunks.join("\n\n---\n\n");
  if (signal.aborted) throw new Error("Generation was cancelled.");

  if (!(app.vault.adapter instanceof FileSystemAdapter)) throw new Error("NotebookLM Studio requires a desktop filesystem vault.");
  const vaultBase = app.vault.adapter.getBasePath();
  const jobStem = sanitizeFilename(`${options.title}-${timestamp()}`, "").replace(/\.$/, "");
  const parent = workingFolder(target);
  const outputRoot = [parent, "NotebookLM Studio"].filter(Boolean).join("/");
  const canonicalVault = await assertNoSymlinkAncestors(vaultBase, outputRoot);
  const outputRootAbsolute = resolveInside(vaultBase, outputRoot);
  await fs.mkdir(outputRootAbsolute, { recursive: true });
  assertCanonicalContainment(canonicalVault, await fs.realpath(outputRootAbsolute));
  const outputRootStat = await fs.lstat(outputRootAbsolute);
  if (!outputRootStat.isDirectory() || outputRootStat.isSymbolicLink()) throw new Error("The NotebookLM Studio output folder must be a real directory, not a symbolic link.");
  let outputFolder = `${outputRoot}/${jobStem}`;
  let outputAbsolute = resolveInside(vaultBase, outputFolder);
  for (let suffix = 2; ; suffix += 1) {
    try {
      await fs.access(outputAbsolute);
      outputFolder = `${outputRoot}/${jobStem}-${suffix}`;
      outputAbsolute = resolveInside(vaultBase, outputFolder);
    } catch { break; }
  }
  const partialAbsolute = `${outputAbsolute}.partial-${randomUUID()}`;
  await fs.mkdir(partialAbsolute, { recursive: false, mode: 0o700 });
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-notebooklm-studio-"));
  const stagingOutput = path.join(stagingRoot, "artifacts");
  await fs.mkdir(stagingOutput, { recursive: true });
  const curatedBundlePath = path.join(stagingRoot, "curated-guidance.md");
  const promptPath = path.join(stagingRoot, "artifact-instructions.txt");
  await fs.writeFile(curatedBundlePath, curated, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(promptPath, options.instructions, { encoding: "utf8", mode: 0o600 });
  const artifacts = planArtifacts(options.artifacts, options.title);
  const requestId = randomUUID();
  let remoteNotebookId = "";

  try {
    const bridge = await runBridge(
      pythonExecutable(),
      companionPath,
      {
        protocolVersion: 1,
        requestId,
        operation: "generate",
        notebookTitle: options.title,
        bundlePaths: [curatedBundlePath],
        promptPath,
        outputDir: stagingOutput,
        artifacts,
        instructions: options.instructions,
        language: settings.language,
        profile: settings.notebooklmProfile,
        keepRemoteNotebook: settings.keepRemoteNotebook
      },
      signal,
      (event) => {
        if (event.type === "progress") onProgress(event.message);
        if (event.type === "notebook_created") remoteNotebookId = event.notebookId;
      }
    );

    const expectedKinds = new Set(artifacts.map((artifact) => artifact.kind));
    const returnedKinds = new Set(bridge.artifacts.map((artifact) => artifact.kind));
    if (bridge.artifacts.length !== artifacts.length || returnedKinds.size !== expectedKinds.size || [...expectedKinds].some((kind) => !returnedKinds.has(kind))) {
      throw new Error("NotebookLM did not return every requested artifact; no local job folder was committed.");
    }
    const files: string[] = [];
    let totalOutputBytes = 0;
    for (const ready of bridge.artifacts) {
      const expected = artifacts.find((artifact) => artifact.kind === ready.kind);
      if (!expected || ready.relativePath !== expected.filename) throw new Error("NotebookLM companion returned an unexpected artifact.");
      const source = resolveInside(stagingOutput, ready.relativePath);
      await validateArtifactFile(source, expected.extension, ready.size, ready.sha256);
      totalOutputBytes += ready.size;
      if (totalOutputBytes > 5 * 1024 ** 3) throw new Error("Generated artifacts exceed the 5 GB job limit.");
      const destination = resolveInside(partialAbsolute, ready.relativePath);
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      files.push(`${outputFolder}/${ready.relativePath}`);
    }
    await fs.writeFile(path.join(partialAbsolute, "curated-source.md"), curated, { encoding: "utf8", flag: "wx" });
    files.push(`${outputFolder}/curated-source.md`);
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourcePaths: collected.files.map((file) => file.path),
      provider: options.provider,
      model: providerConfig.model,
      notebookId: bridge.notebookId,
      keptRemoteNotebook: bridge.keptRemoteNotebook,
      artifacts: files
    };
    await fs.writeFile(path.join(partialAbsolute, "manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
    files.push(`${outputFolder}/manifest.json`);
    assertCanonicalContainment(canonicalVault, await fs.realpath(path.dirname(partialAbsolute)));
    await fs.rename(partialAbsolute, outputAbsolute);
    return { outputFolder, files, notebookId: bridge.notebookId };
  } catch (cause) {
    let cleanupFailed = false;
    if (remoteNotebookId && !settings.keepRemoteNotebook) {
      onProgress("Confirming cleanup of the temporary remote NotebookLM notebook");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const cleanupController = new AbortController();
      const cleanupDeadline = setTimeout(() => cleanupController.abort(), 30_000);
      try {
        await runBridge(
          pythonExecutable(),
          companionPath,
          { protocolVersion: 1, requestId: randomUUID(), operation: "delete_notebook", notebookId: remoteNotebookId, profile: settings.notebooklmProfile },
          cleanupController.signal,
          () => undefined
        );
      } catch { cleanupFailed = true; }
      finally { clearTimeout(cleanupDeadline); }
    }
    if (cleanupFailed) {
      const original = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${original} Remote notebook ${remoteNotebookId} may remain. Remove it in NotebookLM or run: notebooklm delete -n ${remoteNotebookId} -y`);
    }
    throw cause;
  } finally {
    await fs.rm(partialAbsolute, { recursive: true, force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}
