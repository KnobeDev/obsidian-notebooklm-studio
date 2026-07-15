import type { ArtifactKind, PlannedArtifact } from "../core/artifacts";
import { assertSafeRelativePath } from "../core/vault-path";

export const PROTOCOL_VERSION = 1;

export interface BridgeRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "generate" | "preflight" | "delete_notebook";
  notebookId?: string;
  notebookTitle?: string;
  bundlePaths?: string[];
  promptPath?: string;
  outputDir?: string;
  artifacts?: PlannedArtifact[];
  instructions?: string;
  language?: string;
  profile?: string;
  keepRemoteNotebook?: boolean;
}

export type BridgeEvent =
  | { protocolVersion: 1; requestId: string; type: "hello"; companionVersion: string; capabilities: ArtifactKind[] }
  | { protocolVersion: 1; requestId: string; type: "progress"; stage: string; message: string; current?: number; total?: number }
  | { protocolVersion: 1; requestId: string; type: "notebook_created"; notebookId: string }
  | { protocolVersion: 1; requestId: string; type: "artifact_ready"; artifact: ReadyArtifact }
  | { protocolVersion: 1; requestId: string; type: "complete"; notebookId: string; keptRemoteNotebook: boolean }
  | { protocolVersion: 1; requestId: string; type: "error"; code: string; message: string };

export interface ReadyArtifact {
  kind: ArtifactKind;
  relativePath: string;
  size: number;
  sha256: string;
}

export function parseBridgeEvent(line: string): BridgeEvent {
  if (line.length > 65_536) throw new Error("Bridge event exceeded the maximum size.");
  let value: any;
  try { value = JSON.parse(line); } catch { throw new Error("Bridge emitted invalid JSON."); }
  if (value?.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported bridge protocol version.");
  if (typeof value.requestId !== "string" || typeof value.type !== "string") throw new Error("Bridge event is missing required fields.");
  if (!["hello", "progress", "notebook_created", "artifact_ready", "complete", "error"].includes(value.type)) throw new Error("Bridge emitted an unknown event type.");
  if (value.type === "hello" && (typeof value.companionVersion !== "string" || !Array.isArray(value.capabilities))) throw new Error("Bridge hello event is invalid.");
  if (value.type === "progress" && (typeof value.stage !== "string" || typeof value.message !== "string" || value.message.length > 2_000)) throw new Error("Bridge progress event is invalid.");
  if (value.type === "notebook_created" && typeof value.notebookId !== "string") throw new Error("Bridge notebook checkpoint is invalid.");
  if (value.type === "artifact_ready") validateReadyArtifact(value.artifact);
  if (value.type === "complete" && (typeof value.notebookId !== "string" || typeof value.keptRemoteNotebook !== "boolean")) throw new Error("Bridge completion event is invalid.");
  if (value.type === "error" && (typeof value.code !== "string" || typeof value.message !== "string" || value.message.length > 2_000)) throw new Error("Bridge error event is invalid.");
  return value as BridgeEvent;
}

export function validateReadyArtifact(artifact: ReadyArtifact): string {
  if (!artifact || typeof artifact.kind !== "string" || typeof artifact.relativePath !== "string") throw new Error("Bridge artifact metadata is missing.");
  const relative = assertSafeRelativePath(artifact.relativePath);
  if (relative.includes("/") || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error("Bridge artifact metadata is unsafe or invalid.");
  }
  return relative;
}
