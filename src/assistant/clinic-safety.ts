import type { AssistantMode } from "./assistant-types";
import { MAX_ASSISTANT_DISPLAY_CHARS } from "./plain-text";

export const CLINICIAN_HANDOFF_SENTENCE =
  "Diagnosis, urgency, and treatment decisions must be made by the treating clinician.";
export const CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE =
  "I can provide educational context, but I cannot diagnose, assess urgency, or recommend treatment.";

const CLINICAL_DECISION_TERM =
  /\b(?:diagnos(?:e|ed|es|ing|is)|urgent|urgency|emergenc(?:y|ies)|treat(?:ment|ments|ed|ing|s)?|medication(?:s)?|medicine(?:s)?|prescription(?:s)?|prescrib(?:e|ed|es|ing))\b/iu;
const DIRECT_PATIENT_DECISION =
  /\b(?:(?:what\s+)?should\s+(?:(?:(?:the|this|a)\s+)?patient|they|he|she|i)\s+(?:do|start|take)|(?:(?:(?:the|this|a)\s+)?patient|they|he|she|i)\s+(?:must|need(?:s)?\s+to)\s+(?:do|start|take))\b/iu;
const EXISTING_CLINICIAN_HANDOFF =
  /\bdiagnosis,\s+urgency,\s+and\s+treatment\s+decisions\s+must\s+be\s+made\s+by\s+the\s+treating\s+clinician[.!?]?/iu;
const CLINICIAN_REFERENCE =
  /\b(?:(?:treating|qualified)\s+)?(?:clinician|doctor|physician)s?\b|\b(?:health(?:care|\s+care)|medical)\s+professionals?\b|\bcare\s+team\b/iu;
const CLINICAL_DECISION_REFERENCE =
  /\b(?:diagnos(?:e|ed|es|ing|is|tic)|urgent|urgency|emergenc(?:y|ies)|treat(?:ment|ments|ed|ing|s)?|medication(?:s)?|medicine(?:s)?|prescription(?:s)?|prescrib(?:e|ed|es|ing)|(?:clinical|medical)\s+(?:decision|decisions|judgment|judgments))\b/iu;
const CLINICIAN_HANDOFF_DIRECTION =
  /\b(?:must|should|need(?:s)?\s+to|has\s+to|have\s+to|can\s+only|consult|ask|contact|see|speak\s+with|discuss\s+with|defer(?:red|s|ring)?\s+to|decid(?:e|ed|es|ing)|determin(?:e|ed|es|ing)|make|made|handle(?:d|s|ing)?|guide(?:d|s|ing)?|belong(?:s|ed|ing)?|left\s+to)\b|\b(?:is|are)\s+(?:a\s+matter\s+)?for\b/iu;
const DIRECT_CLINICIAN_REFERRAL =
  /\b(?:consult|ask|contact|see|speak\s+with|discuss\s+with|defer(?:red|s|ring)?\s+to)\b/iu;
const DIRECT_CLINICAL_RECOMMENDATION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|they|he|she|you)\s+(?:should|must|ought\s+to|need(?:s)?\s+to)\s+(?:begin|follow|receive|start|take|undergo|use)\b|\b(?:i\s+(?:would\s+)?recommend|my\s+recommendation\s+is|start\s+with\s+the\s+treatment)\b/iu;
const ASSERTED_DIAGNOSIS_OR_URGENCY =
  /\b(?:(?:(?:the|this|a)\s+)?patient\s+(?:has|likely\s+has|appears\s+to\s+have)|(?:this|it|the\s+patient)\s+(?:is|appears|looks)\s+(?:urgent|an?\s+emergency))\b/iu;

export function clinicQuestionNeedsClinicianHandoff(question: string): boolean {
  return CLINICAL_DECISION_TERM.test(question) || DIRECT_PATIENT_DECISION.test(question);
}

export function applyClinicAnswerSafety(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic" || !clinicQuestionNeedsClinicianHandoff(question)) {
    return answer;
  }
  const answerWithoutExistingHandoff = clinicModelAnswerForHistory(mode, question, answer);
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

export function clinicModelAnswerForHistory(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic" || !clinicQuestionNeedsClinicianHandoff(question)) {
    return answer;
  }
  const answerWithoutExistingHandoff = answer
    .replace(/[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n)|$)/gu, (sentence) =>
      isEquivalentClinicianHandoff(sentence) ? "" : sentence,
    )
    .replaceAll(/[ \t]{2,}/gu, " ")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n[ \t]+/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
  if (
    DIRECT_CLINICAL_RECOMMENDATION.test(answerWithoutExistingHandoff) ||
    ASSERTED_DIAGNOSIS_OR_URGENCY.test(answerWithoutExistingHandoff)
  ) {
    return CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE;
  }
  return answerWithoutExistingHandoff;
}

function isEquivalentClinicianHandoff(sentence: string): boolean {
  if (EXISTING_CLINICIAN_HANDOFF.test(sentence)) {
    return true;
  }
  if (!CLINICIAN_REFERENCE.test(sentence)) {
    return false;
  }
  return (
    DIRECT_CLINICIAN_REFERRAL.test(sentence) ||
    (CLINICAL_DECISION_REFERENCE.test(sentence) && CLINICIAN_HANDOFF_DIRECTION.test(sentence))
  );
}
