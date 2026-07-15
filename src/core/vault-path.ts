import path from "node:path";

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

export function assertSafeRelativePath(input: string): string {
  if (input.includes("\0") || WINDOWS_ABSOLUTE.test(input) || input.startsWith("/") || input.startsWith("\\\\")) {
    throw new Error("Path must be vault-relative.");
  }
  const normalized = input.replace(/\\/g, "/").replace(/\/{2,}/g, "/").trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Path contains an unsafe segment.");
  }
  return normalized;
}

export function sanitizeFilename(stem: string, extension: string): string {
  const cleanExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const cleanStem = stem
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!cleanStem || cleanStem === "." || cleanStem === "..") {
    throw new Error("Artifact filename is empty or unsafe.");
  }
  return `${cleanStem.slice(0, 160)}${cleanExtension}`;
}

export function safeOutputPath(folder: string, filename: string): string {
  const safeFolder = assertSafeRelativePath(folder);
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error("Artifact filename must not contain folders.");
  }
  const safeFilename = assertSafeRelativePath(filename);
  const candidate = path.posix.join(safeFolder, safeFilename);
  if (!(candidate === safeFolder || candidate.startsWith(`${safeFolder}/`))) {
    throw new Error("Artifact path escapes the selected folder.");
  }
  return candidate;
}

export function resolveInside(basePath: string, relativePath: string): string {
  const safeRelative = assertSafeRelativePath(relativePath);
  const base = path.resolve(basePath);
  const resolved = path.resolve(base, safeRelative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("Resolved path escapes its allowed directory.");
  }
  return resolved;
}
