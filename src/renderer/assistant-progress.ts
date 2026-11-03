import type {
  AssistantChatMessage,
  AssistantLaneSnapshot,
  AssistantPendingOperation,
} from "../assistant/assistant-types";
import { renderAssistantMessageText } from "./assistant-math";

export interface ImageAnalysisProgress {
  readonly requestId: string;
  readonly status: AssistantPendingOperation["status"];
  readonly phase: AssistantPendingOperation["phase"];
  readonly buttonLabel: string;
  readonly metadataLabel: string;
  readonly detailLabel: string;
}

export function renderAssistantChatRows(state: AssistantLaneSnapshot): readonly HTMLElement[] {
  const pendingChat = new Map(
    state.pendingOperations
      .filter((operation) => operation.kind === "chat")
      .map((operation) => [operation.requestId, operation]),
  );
  const rows: HTMLElement[] = [];

  for (const message of state.chatMessages) {
    rows.push(renderChatMessage(message));
    if (message.role !== "user") {
      continue;
    }
    const operation = pendingChat.get(message.requestId);
    if (operation !== undefined) {
      rows.push(renderPendingChatMessage(message, operation));
    }
  }

  return rows;
}

export function imageAnalysisProgress(state: AssistantLaneSnapshot | null): ImageAnalysisProgress | null {
  const operation = state?.pendingOperations.find(({ kind }) => kind === "image_analysis");
  if (operation === undefined) {
    return null;
  }
  const labels = imageProgressLabels(operation);
  return {
    requestId: operation.requestId,
    status: operation.status,
    phase: operation.phase,
    ...labels,
  };
}

export function assistantOperationStatusMessage(state: AssistantLaneSnapshot): string | null {
  const operation = state.pendingOperations[0];
  if (operation === undefined) {
    return null;
  }
  if (operation.kind === "image_analysis") {
    return imageProgressLabels(operation).detailLabel;
  }
  const message = state.chatMessages.find(
    ({ requestId, role }) => requestId === operation.requestId && role === "user",
  );
  return chatProgressLabel(operation, message?.dependsOnImage === true);
}

export function renderImageAnalyzeButton(
  button: HTMLButtonElement,
  progress: ImageAnalysisProgress | null,
): void {
  if (progress === null) {
    button.textContent = "Analyze image";
    button.setAttribute("aria-busy", "false");
    delete button.dataset.requestId;
    delete button.dataset.requestStatus;
    delete button.dataset.requestPhase;
    return;
  }
  button.replaceChildren(progressIndicator(), document.createTextNode(progress.buttonLabel));
  button.setAttribute("aria-busy", "true");
  button.dataset.requestId = progress.requestId;
  button.dataset.requestStatus = progress.status;
  button.dataset.requestPhase = progress.phase;
}

export function imageAnalysisMetadataValue(
  progress: ImageAnalysisProgress | null,
  fallback: string,
): HTMLElement {
  const value = document.createElement("dd");
  if (progress === null) {
    value.textContent = fallback;
    return value;
  }
  value.className = "assistant-progress-label";
  value.setAttribute("role", "status");
  value.setAttribute("aria-live", "polite");
  value.dataset.requestId = progress.requestId;
  value.dataset.requestStatus = progress.status;
  value.dataset.requestPhase = progress.phase;
  value.append(progressIndicator(), document.createTextNode(progress.metadataLabel));
  return value;
}

export function imageAnalysisProgressMessage(progress: ImageAnalysisProgress): HTMLElement {
  const message = document.createElement("p");
  message.className = "assistant-empty assistant-progress-text";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.dataset.requestId = progress.requestId;
  message.dataset.requestStatus = progress.status;
  message.dataset.requestPhase = progress.phase;
  message.append(progressIndicator(), document.createTextNode(progress.detailLabel));
  return message;
}

function renderChatMessage(message: AssistantChatMessage): HTMLElement {
  const row = document.createElement("article");
  row.className = `assistant-message assistant-message-${message.role}`;
  row.dataset.requestId = message.requestId;
  const role = textElement("strong", "assistant-message-role", message.role === "user" ? "You" : "Local AI");
  const text = renderAssistantMessageText(message.text);
  const labels = contextLabels(message);
  row.append(role, text, labels);
  return row;
}

function renderPendingChatMessage(
  message: AssistantChatMessage,
  operation: AssistantPendingOperation,
): HTMLElement {
  const label = chatProgressLabel(operation, message.dependsOnImage);
  const row = document.createElement("article");
  row.className = `assistant-message assistant-message-assistant assistant-message-pending assistant-message-${operation.status}`;
  row.setAttribute("role", "status");
  row.setAttribute("aria-busy", "true");
  row.dataset.requestId = operation.requestId;
  row.dataset.requestStatus = operation.status;
  row.dataset.requestPhase = operation.phase;
  const role = textElement("strong", "assistant-message-role", "Local AI");
  const text = document.createElement("div");
  text.className = "assistant-message-text assistant-progress-text";
  text.append(progressIndicator(), document.createTextNode(label));
  row.append(role, text, contextLabels(message));
  return row;
}

function chatProgressLabel(operation: AssistantPendingOperation, dependsOnImage: boolean): string {
  if (operation.status === "queued" || operation.phase === "queued") {
    return dependsOnImage ? "Waiting to explain the selected image…" : "Waiting locally…";
  }
  switch (operation.phase) {
    case "initializing_runtime":
    case "checking_catalog":
    case "checking_cache":
      return dependsOnImage ? "Starting the local image assistant…" : "Starting the local assistant…";
    case "downloading_model":
      return "Downloading the local assistant model…";
    case "checking_provider":
    case "registering_provider":
      return "Preparing the local assistant execution provider…";
    case "loading_model":
      return "Loading the local assistant model…";
    case "running_inference":
      return dependsOnImage ? "Thinking about the selected image…" : "Thinking locally…";
  }
}

function imageProgressLabels(
  operation: AssistantPendingOperation,
): Pick<ImageAnalysisProgress, "buttonLabel" | "metadataLabel" | "detailLabel"> {
  if (operation.status === "queued" || operation.phase === "queued") {
    return {
      buttonLabel: "Analyzing… (queued)",
      metadataLabel: "Analyzing (queued)",
      detailLabel: "Image analysis is queued locally…",
    };
  }
  switch (operation.phase) {
    case "initializing_runtime":
    case "checking_catalog":
    case "checking_cache":
      return {
        buttonLabel: "Starting assistant…",
        metadataLabel: "Starting assistant",
        detailLabel: "Starting the local image assistant…",
      };
    case "downloading_model":
      return {
        buttonLabel: "Downloading model…",
        metadataLabel: "Downloading model",
        detailLabel: "Downloading the local assistant model…",
      };
    case "checking_provider":
    case "registering_provider":
      return {
        buttonLabel: "Preparing provider…",
        metadataLabel: "Preparing provider",
        detailLabel: "Preparing the local assistant execution provider…",
      };
    case "loading_model":
      return {
        buttonLabel: "Loading model…",
        metadataLabel: "Loading model",
        detailLabel: "Loading the local assistant model…",
      };
    case "running_inference":
      return {
        buttonLabel: "Analyzing…",
        metadataLabel: "Analyzing",
        detailLabel: "Analyzing image locally…",
      };
  }
}

function contextLabels(message: AssistantChatMessage): HTMLElement {
  return textElement(
    "small",
    "assistant-context-labels",
    `Context: ${message.contextLabels.map((label) => label.label).join(" · ")}`,
  );
}

function progressIndicator(): HTMLElement {
  const indicator = document.createElement("span");
  indicator.className = "assistant-progress-indicator";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}
