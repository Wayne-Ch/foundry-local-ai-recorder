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
  /\b(?:(?:(?:the|this|a)\s+)?patient|they|he|she|you)\s+(?:should|must|ought\s+to|need(?:s)?\s+to|has\s+to|have\s+to)\s+(?:immediately\s+|promptly\s+)?(?:begin|follow|receive|start|take|undergo|use|seek|go|call)\b|\b(?:i\s+(?:would\s+|strongly\s+)?(?:recommend|advise|suggest)|my\s+recommendation\s+(?:is|would\s+be)|start\s+with\s+the\s+treatment|(?:the\s+)?treatment\s+(?:is|would\s+be|should\s+be|must\s+be)\s+(?:to\s+)?(?:immediately\s+|promptly\s+)?(?:begin|follow|receive|start|take|undergo|use|administer|give|prescribe))\b/iu;
const ASSERTED_DIAGNOSIS_OR_URGENCY =
  /\b(?:(?:the\s+)?diagnos(?:is|tic\s+conclusion)\s+(?:is|would\s+be|appears\s+to\s+be|seems\s+to\s+be)|(?:(?:the|this|a)\s+)?patient\s+(?:has|likely\s+has|probably\s+has|appears\s+to\s+have|is\s+diagnosed\s+with)|(?:this|it|the\s+patient|these\s+findings?)\s+(?:clearly\s+|definitely\s+|likely\s+|probably\s+|appears\s+to\s+|seems\s+to\s+|looks\s+)?(?:is|are)\s+(?:an?\s+)?(?:medical\s+)?(?:urgent|emergency|critical|life[- ]threatening)|(?:diagnostic|indicative|consistent)\s+(?:of|with)\s+\S)\b/iu;
const ASSERTED_DIRECT_DIAGNOSIS =
  /\b(?:this|it)\s+(?:clearly\s+|definitely\s+|likely\s+|probably\s+)?(?:is|appears\s+to\s+be|seems\s+to\s+be|looks\s+like)\s+(?:an?\s+)?(?!(?:image|x-ray|radiograph|diagram|illustration|example|educational|mathematical|nonclinical|model|view|projection)\b)[\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,3}\b|\b(?:the\s+)?(?:image|scan|x-ray|radiograph|findings?)\s+(?:confirms?|is\s+diagnostic\s+of)\s+(?:an?\s+)?[\p{L}]/iu;
const PASSIVE_TREATMENT_RECOMMENDATION =
  /\b(?:antibiotics?|medications?|medicines?|therapy|treatment)\s+(?:should|must|needs?\s+to|would)\s+be\s+(?:immediately\s+|promptly\s+)?(?:started|given|administered|prescribed|used)\b|\b(?:urgent|emergency)\s+(?:evaluation|care|treatment|attention)\s+(?:is|would\s+be)\s+(?:needed|required)\b/iu;
const ASSERTED_TRIAGE_OR_IMPERATIVE =
  /\b(?:requires?|needs?)\s+(?:immediate|urgent|emergency)\s+(?:care|attention|evaluation|treatment)\b|\b(?:can|may)\s+safely\s+wait\b|\b(?:does\s+not|doesn't)\s+require\s+(?:urgent|emergency)\s+care\b|^\s*(?:immediately\s+|promptly\s+)?(?:begin|start|take|use|receive|seek|go\s+to|call)\b/iu;
const EXPLICIT_SAFE_CLINIC_BOUNDARY =
  /\b(?:cannot|can't|can\s+not|do\s+not|don't|does\s+not|doesn't|is\s+not\s+able\s+to)\s+(?:diagnos(?:e|is)|establish\s+(?:a\s+)?diagnos(?:is|tic\s+conclusion)|determine\s+(?:a\s+)?diagnos(?:is|tic\s+conclusion)|assess\s+(?:the\s+)?urgency|determine\s+(?:whether\s+)?(?:this\s+is\s+)?(?:urgent|an?\s+emergency)|determine\s+(?:a\s+)?treatment\s+plan|recommend\s+(?:a\s+)?treatment|provide\s+(?:a\s+)?treatment\s+recommendation)\b|\b(?:not\s+(?:a\s+)?diagnos(?:is|tic)|educational(?:\s+(?:context|information|description))?(?:\s+only)?|visible\s+(?:structures?|features?|findings?|text|objects?)\s+can\s+be\s+described|no,\s+this\s+image\s+is\s+(?:an?\s+)?(?:educational|mathematical|nonclinical))\b/iu;

export function clinicQuestionNeedsClinicianHandoff(question: string): boolean {
  return CLINICAL_DECISION_TERM.test(question) || DIRECT_PATIENT_DECISION.test(question);
}

export function applyClinicAnswerSafety(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic" || !clinicQuestionNeedsClinicianHandoff(question)) {
    return answer;
  }
  const answerWithoutExistingHandoff = clinicModelAnswerForHistory(mode, question, answer);
  if (!answerWithoutExistingHandoff) {
    return `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`;
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
  if (!answerWithoutExistingHandoff) {
    return CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE;
  }
  const sentences = answerWithoutExistingHandoff.match(/[^.!?\n]+(?:[.!?]+|(?=\n)|$)/gu) ?? [
    answerWithoutExistingHandoff,
  ];
  if (sentences.some(isUnsafeClinicalAssertion)) {
    return CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE;
  }
  if (
    !EXPLICIT_SAFE_CLINIC_BOUNDARY.test(answerWithoutExistingHandoff) &&
    !answer.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n)|$)/gu)?.some(isEquivalentClinicianHandoff)
  ) {
    return CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE;
  }
  return answerWithoutExistingHandoff;
}

function isUnsafeClinicalAssertion(sentence: string): boolean {
  if (isEquivalentClinicianHandoff(sentence)) {
    return false;
  }
  const hasSafeBoundary = EXPLICIT_SAFE_CLINIC_BOUNDARY.test(sentence);
  const residual = hasSafeBoundary ? sentence.replace(EXPLICIT_SAFE_CLINIC_BOUNDARY, " ") : sentence;
  if (
    DIRECT_CLINICAL_RECOMMENDATION.test(residual) ||
    ASSERTED_DIAGNOSIS_OR_URGENCY.test(residual) ||
    PASSIVE_TREATMENT_RECOMMENDATION.test(residual) ||
    ASSERTED_TRIAGE_OR_IMPERATIVE.test(residual)
  ) {
    return true;
  }
  if (!hasSafeBoundary) {
    return ASSERTED_DIRECT_DIAGNOSIS.test(residual);
  }
  const unsafeTail = residual.match(/(?:\bbut\b|\bhowever\b|\byet\b|:)\s*(.+)$/iu)?.[1];
  return unsafeTail === undefined ? false : ASSERTED_DIRECT_DIAGNOSIS.test(unsafeTail);
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
