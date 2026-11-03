export type AssistantUiAction =
  | "idle"
  | "switching_mode"
  | "queuing_chat"
  | "cancelling"
  | "clearing"
  | "selecting_image"
  | "queuing_analysis"
  | "removing_image";

export interface AssistantControlProgressElements {
  readonly mode: HTMLSelectElement;
  readonly ask: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly clear: HTMLButtonElement;
  readonly imageSelect: HTMLButtonElement;
  readonly imageAnalyze: HTMLButtonElement;
  readonly imageRemove: HTMLButtonElement;
}

export function applyAssistantControlProgress(
  elements: AssistantControlProgressElements,
  action: AssistantUiAction,
): void {
  elements.ask.textContent = action === "queuing_chat" ? "Queuing…" : "Ask";
  elements.cancel.textContent = action === "cancelling" ? "Cancelling…" : "Cancel";
  elements.clear.textContent = action === "clearing" ? "Clearing…" : "Clear";
  elements.imageSelect.textContent =
    action === "selecting_image" ? "Opening picker…" : "Choose PNG, JPEG, or WebP";
  elements.imageRemove.textContent = action === "removing_image" ? "Removing…" : "Remove";
  if (action === "queuing_analysis") {
    elements.imageAnalyze.textContent = "Queuing analysis…";
    elements.imageAnalyze.setAttribute("aria-busy", "true");
  }
  elements.mode.setAttribute("aria-busy", String(action === "switching_mode"));
  elements.ask.setAttribute("aria-busy", String(action === "queuing_chat"));
  elements.cancel.setAttribute("aria-busy", String(action === "cancelling"));
  elements.clear.setAttribute("aria-busy", String(action === "clearing"));
  elements.imageSelect.setAttribute("aria-busy", String(action === "selecting_image"));
  elements.imageRemove.setAttribute("aria-busy", String(action === "removing_image"));
}
