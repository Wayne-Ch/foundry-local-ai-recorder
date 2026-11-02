import type { AssistantChatMessage, AssistantMode, AssistantRequestContext } from "./assistant-types";

const CLASSROOM_SAFETY =
  "You are a concise local classroom assistant. Explain only from the supplied local context, say when uncertain, and never claim citations or grounding that were not supplied.";

const CLINIC_SAFETY =
  "You are a concise educational assistant in a clinician-led setting. You may explain visible material or unfamiliar terminology, but you must not diagnose, assess urgency, recommend treatment, replace a clinician, or replace a qualified interpreter. State uncertainty and direct clinical decisions back to the clinician.";

export function assistantSystemPrompt(mode: AssistantMode): string {
  return mode === "clinic" ? `${CLASSROOM_SAFETY}\n${CLINIC_SAFETY}` : CLASSROOM_SAFETY;
}

export function imageAnalysisPrompt(mode: AssistantMode, context: AssistantRequestContext): string {
  return [
    assistantSystemPrompt(mode),
    "Analyze the attached image as a lesson aid.",
    "Return exactly three short plain-text lines beginning with:",
    "Visible text/objects:",
    "Relation to lesson:",
    "Uncertainty:",
    contextBlock(context),
  ].join("\n");
}

export function chatUserPrompt(
  question: string,
  context: AssistantRequestContext,
  history: readonly AssistantChatMessage[] = [],
): string {
  return [
    `Question: ${question.trim()}`,
    historyBlock(history),
    contextBlock(context),
    "Answer concisely in plain text. Follow any sentence limit in the question.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function contextBlock(context: AssistantRequestContext): string {
  const transcript =
    context.transcript.kind === "none"
      ? "No transcript context."
      : `${
          context.transcript.kind === "live_draft"
            ? "Ephemeral live draft snapshot (may change)"
            : `Final transcript v${context.transcript.version}`
        }:\n${context.transcript.text}`;
  const summary =
    context.summaryText === null
      ? "No summary context."
      : `Summary v${context.summaryVersion}:\n${context.summaryText}`;
  const image =
    context.imageAnalysisText === null
      ? "No image analysis context."
      : `Image analysis v${context.imageAnalysisVersion}:\n${context.imageAnalysisText}`;
  return `LOCAL CONTEXT\n${transcript}\n\n${summary}\n\n${image}`;
}

function historyBlock(history: readonly AssistantChatMessage[]): string {
  if (history.length === 0) {
    return "";
  }
  return [
    "MEMORY-ONLY CHAT HISTORY",
    ...history
      .slice(-8)
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`),
  ].join("\n");
}
