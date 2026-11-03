import type { AssistantChatMessage, AssistantMode, AssistantRequestContext } from "./assistant-types";

export const IMAGE_LESSON_TOPIC_MAX_CHARS = 160;

const CLASSROOM_SAFETY =
  "You are a concise local classroom assistant. Explain only from the supplied local context, say when uncertain, and never claim citations or grounding that were not supplied.";

const CLINIC_SAFETY =
  "You are a concise educational assistant in a clinician-led setting. You may explain visible material or unfamiliar terminology, but you must not diagnose, assess urgency, recommend treatment, replace a clinician, or replace a qualified interpreter. State uncertainty and direct clinical decisions back to the clinician.";

export function assistantSystemPrompt(mode: AssistantMode): string {
  return mode === "clinic" ? `${CLASSROOM_SAFETY}\n${CLINIC_SAFETY}` : CLASSROOM_SAFETY;
}

export function imageAnalysisPrompt(context: AssistantRequestContext): string {
  const lessonTopic = imageLessonTopicExcerpt(context.transcript.text);
  return [
    "Analyze the attached image as a lesson aid.",
    "Use only visible image evidence and the bounded lesson topic below.",
    lessonTopic
      ? `LESSON TOPIC (first complete sentences, maximum ${IMAGE_LESSON_TOPIC_MAX_CHARS} characters)\n${lessonTopic}`
      : "",
    "Return exactly these three ordered plain-text sections and no other text:",
    "Visible text/objects: 1 to 3 concise image-grounded observations.",
    "Relation to lesson: 1 to 2 concise connections to the lesson topic.",
    "Uncertainty: 1 concise uncertainty statement, or the words None visible.",
    "Do not repeat any phrase, sentence, or section.",
    "Stop immediately after the Uncertainty section.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function imageLessonTopicExcerpt(transcript: string): string {
  const normalized = transcript.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length <= IMAGE_LESSON_TOPIC_MAX_CHARS) {
    return normalized;
  }

  let sentenceBoundary = 0;
  for (const match of normalized.matchAll(/[.!?](?=\s|$)/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > IMAGE_LESSON_TOPIC_MAX_CHARS) {
      break;
    }
    sentenceBoundary = end;
  }
  if (sentenceBoundary > 0) {
    return normalized.slice(0, sentenceBoundary);
  }

  const bounded = normalized.slice(0, IMAGE_LESSON_TOPIC_MAX_CHARS);
  const finalWhitespace = bounded.lastIndexOf(" ");
  return finalWhitespace > 0 ? bounded.slice(0, finalWhitespace) : bounded;
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
