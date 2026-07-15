// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import type { Setting } from "obsidian";
import { labelSetting, repairSecretWarnings } from "../src/accessibility";

describe("SecretComponent accessibility repairs", () => {
  test("keeps the visible Link text in the button's accessible name", () => {
    const nameEl = document.createElement("div");
    nameEl.textContent = "OpenAI API key";
    const descEl = document.createElement("div");
    const controlEl = document.createElement("div");
    const button = controlEl.appendChild(document.createElement("button"));
    button.textContent = "Link…";

    labelSetting({ nameEl, descEl, controlEl } as unknown as Setting, "openai-secret");

    expect(button.getAttribute("aria-label")).toBe("Link… OpenAI API key");
    expect(button.getAttribute("aria-describedby")).toBe("openai-secret-description");
  });

  test("makes the unencrypted-storage warning keyboard operable", () => {
    const container = document.createElement("div");
    const warning = container.appendChild(document.createElement("div"));
    warning.className = "clickable-icon mod-warning";
    const clicked = vi.fn();
    warning.addEventListener("click", clicked);

    repairSecretWarnings(container);
    warning.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    warning.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    warning.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));

    expect(warning.getAttribute("role")).toBe("button");
    expect(warning.tabIndex).toBe(0);
    expect(warning.getAttribute("aria-label")).toContain("Secret storage warning");
    expect(clicked).toHaveBeenCalledTimes(2);
  });
});
