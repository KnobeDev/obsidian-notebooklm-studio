import { sanitizeFilename } from "./vault-path";

export type ArtifactKind =
  | "audio" | "video" | "slide-deck" | "infographic" | "quiz"
  | "flashcards" | "report" | "data-table" | "mind-map";

export interface ArtifactDefinition {
  kind: ArtifactKind;
  label: string;
  suffix: string;
  extension: string;
  mime: string;
  hint: string;
}

export const ARTIFACT_DEFINITIONS: readonly ArtifactDefinition[] = [
  { kind: "audio", label: "Audio overview", suffix: "audio-overview", extension: ".m4a", mime: "audio/mp4", hint: "M4A podcast" },
  { kind: "video", label: "Video overview", suffix: "video-overview", extension: ".mp4", mime: "video/mp4", hint: "MP4 explainer" },
  { kind: "slide-deck", label: "Slide deck", suffix: "slides", extension: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", hint: "Editable PPTX" },
  { kind: "infographic", label: "Infographic", suffix: "infographic", extension: ".png", mime: "image/png", hint: "PNG image" },
  { kind: "quiz", label: "Quiz", suffix: "quiz", extension: ".md", mime: "text/markdown", hint: "Markdown quiz" },
  { kind: "flashcards", label: "Flashcards", suffix: "flashcards", extension: ".md", mime: "text/markdown", hint: "Markdown cards" },
  { kind: "report", label: "Report", suffix: "report", extension: ".md", mime: "text/markdown", hint: "Markdown briefing" },
  { kind: "data-table", label: "Data table", suffix: "data-table", extension: ".csv", mime: "text/csv", hint: "CSV table" },
  { kind: "mind-map", label: "Mind map", suffix: "mind-map", extension: ".json", mime: "application/json", hint: "JSON hierarchy" }
];

export interface PlannedArtifact extends ArtifactDefinition {
  filename: string;
}

export function planArtifacts(kinds: readonly ArtifactKind[], title: string): PlannedArtifact[] {
  const selected = new Set(kinds);
  if (selected.size === 0) throw new Error("Select at least one artifact.");
  return ARTIFACT_DEFINITIONS
    .filter((definition) => selected.has(definition.kind))
    .map((definition) => ({
      ...definition,
      filename: sanitizeFilename(`${title}-${definition.suffix}`, definition.extension)
    }));
}
