import { t } from "../i18n";

export const BUTTON_ID = "ghp-preview-toggle";

export function createToggleButton(onToggle: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "ghp-preview-toggle";
  button.title = t("previewTitle");
  setButtonState(button, false);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onToggle();
  });
  return button;
}

export function setButtonState(button: HTMLButtonElement, previewing: boolean): void {
  button.textContent = previewing ? t("codeButton") : t("previewButton");
  button.setAttribute("aria-pressed", String(previewing));
}
