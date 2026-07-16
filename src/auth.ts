import { randomUUID } from "node:crypto";
import { runBridge } from "./bridge/client";
import { pythonExecutable } from "./job-runner";

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function assertValidProfile(profile: string): void {
  if (!PROFILE_PATTERN.test(profile)) {
    throw new Error("NotebookLM profile names may contain letters, numbers, periods, underscores, and hyphens.");
  }
}

/**
 * Open the system browser and sign in to Google NotebookLM for the given
 * profile. The notebooklm-py CLI owns the browser and the Google login; this
 * only launches it (through the hardened Python companion) and reports back
 * when the session has been saved into the profile.
 */
export async function connectNotebookLM(
  companionPath: string,
  profile: string,
  signal: AbortSignal,
  onProgress: (message: string) => void
): Promise<void> {
  assertValidProfile(profile);
  onProgress("Opening your browser to sign in to Google NotebookLM");
  await runBridge(
    pythonExecutable(),
    companionPath,
    { protocolVersion: 1, requestId: randomUUID(), operation: "login", profile },
    signal,
    (event) => {
      if (event.type === "progress") onProgress(event.message);
    }
  );
}

/**
 * Confirm the companion is installed and the profile is authenticated, without
 * side effects. Reuses the existing preflight (notebooklm doctor) operation.
 */
export async function checkNotebookLMConnection(
  companionPath: string,
  profile: string,
  signal: AbortSignal,
  onProgress: (message: string) => void
): Promise<void> {
  assertValidProfile(profile);
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
}
