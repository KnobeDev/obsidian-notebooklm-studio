import type { Setting } from "obsidian";

export function createFocusTrap(modalEl: HTMLElement): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(modalEl.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
}

export function activateOnKeyboard(element: HTMLElement, action: () => void): void {
  element.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") { event.preventDefault(); action(); }
    if (event.key === " ") event.preventDefault();
  });
  element.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === " ") { event.preventDefault(); action(); }
  });
}

export function labelSetting(setting: Setting, idPrefix: string): void {
  const nameId = `${idPrefix}-name`;
  const descriptionId = `${idPrefix}-description`;
  setting.nameEl.id = nameId;
  setting.descEl.id = descriptionId;
  const control = setting.controlEl.querySelector<HTMLElement>("input, select, textarea, button, .checkbox-container");
  if (!control) return;
  control.setAttribute("aria-describedby", descriptionId);
  if (control instanceof HTMLButtonElement) {
    const visibleName = control.textContent?.trim() || "Choose";
    const fieldName = setting.nameEl.textContent?.trim() || "secret";
    control.setAttribute("aria-label", `${visibleName} ${fieldName}`);
  } else {
    control.setAttribute("aria-labelledby", nameId);
  }
}

export function repairSecretWarnings(container: HTMLElement): void {
  for (const warning of Array.from(container.querySelectorAll<HTMLElement>(".clickable-icon.mod-warning"))) {
    warning.setAttribute("role", "button");
    warning.tabIndex = 0;
    warning.setAttribute("aria-label", warning.getAttribute("aria-label") || warning.getAttribute("title") || "Secret storage warning: secrets may not be encrypted");
    warning.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") { event.preventDefault(); warning.click(); }
      if (event.key === " ") event.preventDefault();
    });
    warning.addEventListener("keyup", (event: KeyboardEvent) => {
      if (event.key === " ") { event.preventDefault(); warning.click(); }
    });
  }
}
