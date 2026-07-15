export interface SourceEntry {
  path: string;
  extension: string;
  content: string;
}

export interface CollectionLimits {
  maxFileChars: number;
  maxTotalChars: number;
}

export interface CollectedSources {
  files: SourceEntry[];
  bundle: string;
  totalChars: number;
}

const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "json", "html", "htm", "xml", "yaml", "yml"]);

function included(entry: SourceEntry): boolean {
  const normalized = entry.path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return TEXT_EXTENSIONS.has(entry.extension.toLowerCase())
    && !segments.some((segment) => segment.startsWith("."))
    && !segments.includes("NotebookLM Studio");
}

export function collectTextSources(entries: readonly SourceEntry[], limits: CollectionLimits): CollectedSources {
  const files = entries.filter(included).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) throw new Error("The selection contains no supported text files.");
  let totalChars = 0;
  const sections: string[] = [];
  for (const file of files) {
    if (file.content.length > limits.maxFileChars) {
      throw new Error(`${file.path} exceeds the per-file content limit.`);
    }
    totalChars += file.content.length;
    if (totalChars > limits.maxTotalChars) {
      throw new Error("Selected content exceeds the total content limit.");
    }
    sections.push(`# Source: ${file.path}\n\n${file.content}`);
  }
  return { files, bundle: sections.join("\n\n---\n\n"), totalChars };
}
