import type { AssistantMode } from "./assistant-types";
import { MAX_ASSISTANT_DISPLAY_CHARS } from "./plain-text";

export const CLINICIAN_HANDOFF_SENTENCE =
  "Diagnosis, urgency, and treatment decisions must be made by the treating clinician.";

const CLINICAL_DECISION_TERM =
  /\b(?:diagnos(?:e|ed|es|ing|is)|urgent|urgency|emergenc(?:y|ies)|treat(?:ment|ments|ed|ing|s)?|medication(?:s)?|medicine(?:s)?|prescription(?:s)?|prescrib(?:e|ed|es|ing))\b/iu;
const DIRECT_PATIENT_DECISION = /\bwhat\s+should\s+(?:(?:the|this|a)\s+)?patient\s+(?:do|start|take)\b/iu;
const EXISTING_CLINICIAN_HANDOFF =
  /\bdiagnosis,\s+urgency,\s+and\s+treatment\s+decisions\s+must\s+be\s+made\s+by\s+the\s+treating\s+clinician[.!?]?/giu;

export function clinicQuestionNeedsClinicianHandoff(question: string): boolean {
  return CLINICAL_DECISION_TERM.test(question) || DIRECT_PATIENT_DECISION.test(question);
}

export function applyClinicAnswerSafety(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic" || !clinicQuestionNeedsClinicianHandoff(question)) {
    return answer;
  }
  const answerWithoutExistingHandoff = answer
    .replace(EXISTING_CLINICIAN_HANDOFF, "")
    .replaceAll(/[ \t]{2,}/gu, " ")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
  if (!answerWithoutExistingHandoff) {
    return CLINICIAN_HANDOFF_SENTENCE;
  }
  const suffix = `\n\n${CLINICIAN_HANDOFF_SENTENCE}`;
  const maxAnswerChars = MAX_ASSISTANT_DISPLAY_CHARS - suffix.length;
  const boundedAnswer =
    answerWithoutExistingHandoff.length <= maxAnswerChars
      ? answerWithoutExistingHandoff
      : `${answerWithoutExistingHandoff.slice(0, maxAnswerChars - 3).trimEnd()}...`;
  return `${boundedAnswer}${suffix}`;
}
