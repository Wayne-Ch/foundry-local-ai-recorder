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
const DIRECT_PATIENT_DIAGNOSIS_QUESTION =
  /\b(?:(?:what|which)\s+(?:diagnos(?:is|tic\s+conclusion)|disease|medical\s+condition)\b|what\s+(?:diagnos(?:is|tic\s+conclusion)|disease|condition)\s+does\s+(?:(?:the|this|a)\s+)?patient\s+have\b|what\s+does\s+(?:(?:the|this|a)\s+)?patient\s+have\b|does\s+(?:(?:the|this|a)\s+)?patient\s+have\s+(?:an?\s+)?(?:disease|medical\s+condition)\b)\b/iu;
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
const ANSWER_SENTENCE = /[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n)|$)/gu;
const CLINICAL_OR_IMAGE_CONTEXT =
  /\b(?:patient|clinical|medical|diagnos(?:e|ed|es|ing|is|tic)|disease|symptom(?:s)?|treat(?:ment|ments|ed|ing|s)?|therap(?:y|ies)|medication(?:s)?|medicine(?:s)?|prescription(?:s)?|prescrib(?:e|ed|es|ing)|procedure(?:s)?|surgery|urgent|urgency|emergenc(?:y|ies)|hospital|clinic|clinician|doctor|physician|health(?:care|\s+care)|scan|image|x-ray|radiograph|findings?)\b/iu;
const CONTRASTIVE_TAIL =
  /(?:^|[\s,;:])(?:but|however|yet|nevertheless|nonetheless|still|even\s+so|although|though|despite\s+(?:that|this))[\s,;:]+(.+)$/iu;
const SAFE_NONCLINICAL_PREDICATE =
  /\b(?:educational\s+(?:context|information|description)|equation|formula|calculation|derivative|integral|function|variable|graph|plot|chart|diagram|illustration|example|lesson|exercise|problem|concept|definition|model(?:\s+cache)?|cache|algorithm|code|file|system|application|workflow|label|marker|text|object|view|projection|image|radiograph|x-ray|scan|silhouette|outline|visible\s+(?:structure|feature)|anatomy)\b/iu;
const PATIENT_DIRECTED_MEDICAL_ACTION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she)\s+(?:(?:definitely|probably|strongly)\s+)?(?:should|must|ought\s+to|need(?:s)?\s+to|has\s+to|have\s+to)\s+(?:immediately\s+|promptly\s+|urgently\s+)?(?:begin|continue|follow|receive|start|stop|take|undergo|use|avoid|seek|get|schedule|go|call)\b(?:\s+[^.!?;\n]{1,120})?/iu;
const RECOMMENDED_PATIENT_MEDICAL_ACTION =
  /\b(?:i|we)\s+(?:(?:would|strongly|definitely|probably)\s+)?(?:recommend|advise|suggest)\s+(?:(?:that\s+)?(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she)\s+(?:(?:should|must|ought\s+to|need(?:s)?\s+to)\s+)?(?:begin|continue|follow|receive|start|stop|take|undergo|use|avoid|seek|get|schedule|go|call)|(?:beginning|continuing|following|receiving|starting|stopping|taking|undergoing|using|avoiding|seeking|getting|scheduling))\b(?:\s+[^.!?;\n]{1,120})?/iu;
const ASSERTED_NAMED_CONDITION =
  /\b(?:the\s+)?(?:diagnos(?:is|tic\s+conclusion)|disease|(?:medical\s+)?condition)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:is|would\s+be|appears?\s+(?:likely\s+)?to\s+be|seems?\s+to\s+be|looks\s+like)\s+(?:an?\s+)?([\p{L}\d][^.!?;,\n]{0,119})/iu;
const ASSERTED_PATIENT_CONDITION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she)\s+(?:clearly\s+|definitely\s+|likely\s+|probably\s+)?(?:has|have|appears?\s+to\s+have|seems?\s+to\s+have|is\s+suffering\s+from|are\s+suffering\s+from|is\s+diagnosed\s+with|are\s+diagnosed\s+with)\s+(?:an?\s+)?([\p{L}\d][^.!?;,\n]{0,119})/iu;
const ASSERTED_DEICTIC_CONDITION =
  /\b(?:this|that|it)\s+(?:clearly\s+|definitely\s+|probably\s+)?(?:is(?:\s+(?:likely|probably))?|appears?\s+(?:likely\s+)?to\s+be|appears?\s+(?:likely\s+)?consistent\s+with|seems?\s+to\s+be|looks\s+like|is\s+consistent\s+with|likely\s+(?:is|represents))\s+(?:an?\s+)?([\p{L}\d][^.!?;,\n]{0,119})/iu;
const ASSERTED_IMAGE_CONDITION =
  /\b(?:(?:this|that|the|these|those)\s+)?(?:(?:clinical|medical)\s+)?(?:image|scan|x-ray|radiograph|findings?)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:confirms?|(?:is|are)\s+(?:diagnostic|indicative|suggestive|consistent)\s+(?:of|with)|appears?\s+(?:likely\s+)?consistent\s+with|likely\s+(?:shows|represents)|suggests?|indicates?)\s+(?:an?\s+)?([\p{L}\d][^.!?;,\n]{0,119})/iu;
const PASSIVE_MEDICAL_ACTION =
  /\b([^.!?;,\n]{1,80}?)\s+(?:definitely\s+|probably\s+)?(?:should|must|ought\s+to|needs?\s+to|would|could)\s+be\s+(?:immediately\s+|promptly\s+|urgently\s+)?(?:continued|given|administered|prescribed|started|stopped|taken|received|undergone|used|avoided)\b/iu;
const TREATMENT_PLAN_ASSERTION =
  /\b(?:the\s+)?(?:treatment|treatment\s+plan|recommendation)\s+(?:is|would\s+be|should\s+be|must\s+be|could\s+be)\s+(?:to\s+)?(?:immediately\s+|promptly\s+|urgently\s+)?(?:begin|continue|follow|receive|start|stop|take|undergo|use|avoid|administer|give|prescribe)\b/iu;
const PATIENT_URGENCY_ASSERTION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she|this|that|it)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:needs?|requires?)\s+(?:immediate|urgent|emergency|prompt|same[- ]day)\s+[^.!?;\n]{1,120}|\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she|this|that|it)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:is|appears?\s+to\s+be|seems?\s+to\s+be)\s+(?:an?\s+)?(?:urgent|emergency|critical|life[- ]threatening)\b/iu;
const GENERAL_URGENCY_ASSERTION =
  /\b(?:requires?|needs?)\s+(?:immediate|urgent|emergency|prompt|same[- ]day)\s+[^.!?;\n]{1,120}|\b(?:can|may)\s+safely\s+wait\b|\b(?:cannot|can't|should\s+not|must\s+not)\s+wait\b|\b(?:does\s+not|doesn't)\s+require\s+(?:urgent|emergency)\s+[^.!?;\n]{1,80}|\b(?:immediate|urgent|emergency|prompt|same[- ]day)\s+[^.!?;,\n]{1,80}\s+(?:is|would\s+be|appears?\s+to\s+be)\s+(?:definitely\s+|probably\s+)?(?:needed|required|recommended)\b/iu;
const ASSERTED_TRIAGE_OR_IMPERATIVE =
  /\b(?:requires?|needs?)\s+(?:immediate|urgent|emergency)\s+(?:care|attention|evaluation|treatment)\b|\b(?:can|may)\s+safely\s+wait\b|\b(?:does\s+not|doesn't)\s+require\s+(?:urgent|emergency)\s+care\b|^\s*(?:immediately\s+|promptly\s+|urgently\s+)?(?:(?:begin|continue|receive|start|stop|take|use)\s+(?:an?\s+|the\s+|this\s+)?(?:antibiotic(?:s)?|dose|inhaler|medication(?:s)?|medicine(?:s)?|therapy|treatment)|seek\s+(?:immediate\s+|prompt\s+|urgent\s+|emergency\s+)?(?:care|evaluation|treatment)|go\s+to\s+(?:an?\s+|the\s+)?(?:clinic|emergency\s+department|hospital)|call\s+(?:911|an?\s+clinician|the\s+doctor))\b/iu;
const EXPLICIT_SAFE_CLINIC_BOUNDARY =
  /\b(?:cannot|can't|can\s+not|do\s+not|don't|does\s+not|doesn't|is\s+not\s+able\s+to)\s+(?:diagnos(?:e|is)|establish\s+(?:a\s+)?diagnos(?:is|tic\s+conclusion)|determine\s+(?:a\s+)?diagnos(?:is|tic\s+conclusion)|assess\s+(?:the\s+)?urgency|determine\s+(?:whether\s+)?(?:this\s+is\s+)?(?:urgent|an?\s+emergency)|determine\s+(?:a\s+)?treatment\s+plan|recommend\s+(?:a\s+)?treatment|provide\s+(?:a\s+)?treatment\s+recommendation)\b|\b(?:not\s+(?:a\s+)?diagnos(?:is|tic)|educational(?:\s+(?:context|information|description))?(?:\s+only)?|visible\s+(?:structures?|features?|findings?|text|objects?)\s+can\s+be\s+described|no,\s+this\s+image\s+is\s+(?:an?\s+)?(?:educational|mathematical|nonclinical))\b/iu;

export function clinicQuestionNeedsClinicianHandoff(question: string): boolean {
  return (
    CLINICAL_DECISION_TERM.test(question) ||
    DIRECT_PATIENT_DECISION.test(question) ||
    DIRECT_PATIENT_DIAGNOSIS_QUESTION.test(question)
  );
}

export function applyClinicAnswerSafety(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic") {
    return answer;
  }
  const result = evaluateClinicAnswer(question, answer);
  if (!result.needsClinicianHandoff) {
    return result.historyAnswer;
  }
  if (!result.historyAnswer) {
    return `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`;
  }
  const suffix = `\n\n${CLINICIAN_HANDOFF_SENTENCE}`;
  const maxAnswerChars = MAX_ASSISTANT_DISPLAY_CHARS - suffix.length;
  const boundedAnswer =
    result.historyAnswer.length <= maxAnswerChars
      ? result.historyAnswer
      : `${result.historyAnswer.slice(0, maxAnswerChars - 3).trimEnd()}...`;
  return `${boundedAnswer}${suffix}`;
}

export function clinicModelAnswerForHistory(mode: AssistantMode, question: string, answer: string): string {
  if (mode !== "clinic") {
    return answer;
  }
  return evaluateClinicAnswer(question, answer).historyAnswer;
}

function evaluateClinicAnswer(
  question: string,
  answer: string,
): {
  readonly historyAnswer: string;
  readonly needsClinicianHandoff: boolean;
} {
  const needsClinicianHandoff = clinicQuestionNeedsClinicianHandoff(question);
  if (hasUnsafeClinicalAssertion(question, answer)) {
    return {
      historyAnswer: CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
      needsClinicianHandoff: true,
    };
  }
  const answerWithoutExistingHandoff = needsClinicianHandoff
    ? answer
        .replace(ANSWER_SENTENCE, (sentence) => (isEquivalentClinicianHandoff(sentence) ? "" : sentence))
        .replaceAll(/[ \t]{2,}/gu, " ")
        .replaceAll(/[ \t]+\n/gu, "\n")
        .replaceAll(/\n[ \t]+/gu, "\n")
        .replaceAll(/\n{3,}/gu, "\n\n")
        .trim()
    : answer.trim();
  if (!answerWithoutExistingHandoff) {
    return {
      historyAnswer: CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
      needsClinicianHandoff,
    };
  }
  if (
    needsClinicianHandoff &&
    !EXPLICIT_SAFE_CLINIC_BOUNDARY.test(answerWithoutExistingHandoff) &&
    !answer.match(ANSWER_SENTENCE)?.some(isEquivalentClinicianHandoff)
  ) {
    return {
      historyAnswer: CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
      needsClinicianHandoff: true,
    };
  }
  return {
    historyAnswer: answerWithoutExistingHandoff,
    needsClinicianHandoff,
  };
}

function hasUnsafeClinicalAssertion(question: string, answer: string): boolean {
  const context = `${question}\n${answer}`;
  let sawMedicalBoundary = false;
  const sentences = answer.match(ANSWER_SENTENCE) ?? [answer];
  for (const sentence of sentences) {
    const hasSafeBoundary = EXPLICIT_SAFE_CLINIC_BOUNDARY.test(sentence);
    const contrastiveTail =
      hasSafeBoundary || sawMedicalBoundary ? sentence.match(CONTRASTIVE_TAIL)?.[1] : undefined;
    if (contrastiveTail !== undefined && isUnsafeClinicalAssertion(contrastiveTail, context, true)) {
      return true;
    }
    const residual = hasSafeBoundary ? sentence.replace(EXPLICIT_SAFE_CLINIC_BOUNDARY, " ") : sentence;
    if (isUnsafeClinicalAssertion(residual, context, false)) {
      return true;
    }
    sawMedicalBoundary ||= hasSafeBoundary;
  }
  return false;
}

function isUnsafeClinicalAssertion(
  sentence: string,
  context: string,
  followsMedicalBoundary: boolean,
): boolean {
  if (
    PATIENT_DIRECTED_MEDICAL_ACTION.test(sentence) ||
    RECOMMENDED_PATIENT_MEDICAL_ACTION.test(sentence) ||
    TREATMENT_PLAN_ASSERTION.test(sentence) ||
    PATIENT_URGENCY_ASSERTION.test(sentence) ||
    GENERAL_URGENCY_ASSERTION.test(sentence) ||
    ASSERTED_TRIAGE_OR_IMPERATIVE.test(sentence)
  ) {
    return true;
  }
  const passiveAction = sentence.match(PASSIVE_MEDICAL_ACTION);
  if (
    passiveAction !== null &&
    (followsMedicalBoundary ||
      CLINICAL_OR_IMAGE_CONTEXT.test(context) ||
      !isSafeNonclinicalPredicate(passiveAction[1] ?? ""))
  ) {
    return true;
  }
  return hasAssertedMedicalCondition(sentence, context, followsMedicalBoundary);
}

function hasAssertedMedicalCondition(
  sentence: string,
  context: string,
  followsMedicalBoundary: boolean,
): boolean {
  const namedCondition = sentence.match(ASSERTED_NAMED_CONDITION)?.[1];
  if (
    namedCondition !== undefined &&
    !isSafeNonclinicalPredicate(namedCondition) &&
    (followsMedicalBoundary || CLINICAL_OR_IMAGE_CONTEXT.test(context))
  ) {
    return true;
  }
  const patientCondition = sentence.match(ASSERTED_PATIENT_CONDITION)?.[1];
  if (patientCondition !== undefined && !isSafeNonclinicalPredicate(patientCondition)) {
    return true;
  }
  const deicticCondition = sentence.match(ASSERTED_DEICTIC_CONDITION)?.[1];
  if (
    deicticCondition !== undefined &&
    !isSafeNonclinicalPredicate(deicticCondition) &&
    (followsMedicalBoundary || CLINICAL_OR_IMAGE_CONTEXT.test(context))
  ) {
    return true;
  }
  const imageCondition = sentence.match(ASSERTED_IMAGE_CONDITION)?.[1];
  return imageCondition !== undefined && !isSafeNonclinicalPredicate(imageCondition);
}

function isSafeNonclinicalPredicate(value: string): boolean {
  return SAFE_NONCLINICAL_PREDICATE.test(value);
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
