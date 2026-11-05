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
const CLINICIAN_DECISION_ASSIGNMENT =
  /\b(?:diagnos(?:is|tic\s+conclusion)|urgency|treatment(?:\s+plan)?|(?:clinical|medical)\s+decisions?)\b[^.!?;\n]{0,100}\b(?:(?:must|should|need(?:s)?\s+to|has\s+to|have\s+to)\s+be\s+(?:made|determined|assessed|handled|guided)\s+by|(?:is|are)\s+(?:a\s+matter\s+)?for)\s+(?:(?:the|a|your)\s+)?(?:(?:treating|qualified)\s+)?(?:clinician|doctor|physician)\b/iu;
const ANSWER_SENTENCE = /[^.!?\n]+(?:[.!?]+[\p{Pe}\p{Pf}"'’”*_`~]*(?=\s|$)|(?=\n)|$)/gu;
const CONTRASTIVE_CONNECTOR =
  /(?:^|[\s,;:—-])(?:but|however|yet|nevertheless|nonetheless|still|even\s+so|although|though|despite\s+(?:that|this))\b[\s,;:—-]*/giu;
const SAFE_REFUSAL =
  /\b(?:cannot|can't|can\s+not|do\s+not|don't|does\s+not|doesn't|is\s+not\s+able\s+to)\b/iu;
const SAFE_EDUCATIONAL_BOUNDARY =
  /^(?:this\s+is\s+educational\s+(?:context|information|description)(?:\s+only)?(?:,\s+not\s+(?:a\s+)?diagnos(?:is|tic))?|this\s+is\s+not\s+(?:a\s+)?diagnos(?:is|tic)|(?:no,\s+)?(?:this|the)\s+(?:image|scan|x-ray|radiograph)\s+is\s+(?:an?\s+)?(?:educational|mathematical|nonclinical)(?:\s+only)?|visible\s+(?:structures?|features?|findings?|text|objects?)\s+can\s+be\s+described\s+for\s+education|educational\s+(?:context|information|description)\s+only(?:,\s+not\s+(?:a\s+)?diagnos(?:is|tic))?)$/iu;
const EXPLICIT_DIAGNOSIS_ASSERTION =
  /\b(?:the\s+)?(?:diagnos(?:is|tic\s+conclusion)|disease|(?:medical\s+)?condition)\s*(?::|\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:is|are|would\s+be|appears?(?:\s+(?:likely|probably))?\s+(?:to\s+be|consistent\s+with)|seems?(?:\s+(?:likely|probably))?\s+to\s+be|looks?\s+like|likely\s+(?:is|represents)|is\s+consistent\s+with))\b/iu;
const PATIENT_CONDITION_ASSERTION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:appears?(?:\s+likely)?\s+to\s+have|seems?(?:\s+likely)?\s+to\s+have|is\s+likely\s+to\s+have|are\s+likely\s+to\s+have|suffers?\s+from|is\s+suffering\s+from|are\s+suffering\s+from|is\s+diagnosed\s+with|are\s+diagnosed\s+with|has|have|is|are)\s+(?:an?\s+)?(.+)$/iu;
const DEICTIC_CONDITION_ASSERTION =
  /\b(?:this|that|it)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:is(?:\s+(?:likely|probably))?|appears?(?:\s+(?:likely|probably))?\s+(?:to\s+be|consistent\s+with)|seems?(?:\s+(?:likely|probably))?\s+to\s+be|looks?\s+like|is\s+consistent\s+with|likely\s+(?:is|represents))\s+(?:an?\s+)?(.+)$/iu;
const IMAGE_CONDITION_ASSERTION =
  /\b(?:(?:this|that|the|these|those)\s+)?(?:(?:clinical|medical)\s+)?(?:image|scan|x-ray|radiograph|finding|findings)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:confirms?|suggests?|indicates?|reveals?|shows?|demonstrates?|depicts?|represents?|(?:is|are)\s+(?:diagnostic|indicative|suggestive|consistent)\s+(?:of|with)|appears?(?:\s+likely)?\s+consistent\s+with|likely\s+(?:shows?|represents?))\s+(?:an?\s+)?(.+)$/iu;
const IMAGE_COPULA_ASSERTION =
  /\b(?:(?:this|that|the)\s+)?(?:(?:clinical|medical)\s+)?(?:image|scan|x-ray|radiograph)\s+(?:is|appears?(?:\s+likely)?\s+to\s+be|seems?(?:\s+likely)?\s+to\s+be|looks?\s+like)\s+(?:an?\s+)?(.+)$/iu;
const FINDINGS_DIAGNOSIS_ASSERTION =
  /\b(?:these|those|the)?\s*findings?\s+(?:is|are|appear(?:s)?\s+to\s+be)?\s*(?:diagnostic|indicative|suggestive|consistent)\s+(?:of|with)\b/iu;
const PATIENT_DIRECTED_RECOMMENDATION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she)\s+(?:(?:definitely|probably|strongly)\s+)?(?:should|must|ought\s+to|need(?:s)?\s+to|has\s+to|have\s+to)\s+(.+)$/iu;
const DIRECT_RECOMMENDATION =
  /\b(?:i|we)\s+(?:(?:would|strongly|definitely|probably)\s+)?(?:recommend|advise|suggest)\s+(.+)$/iu;
const TREATMENT_PLAN_ASSERTION =
  /\b(?:the\s+)?(?:treatment|treatment\s+plan|medical\s+recommendation)\s+(?:is|would\s+be|should\s+be|must\s+be|could\s+be)\b/iu;
const PASSIVE_MEDICAL_RECOMMENDATION =
  /\b[^.!?;,\n]{1,120}?\s+(?:should|must|ought\s+to|needs?\s+to|could|would)\s+be\s+(?:immediately\s+|promptly\s+|urgently\s+)?(?:continued|given|administered|prescribed|started|stopped|taken|received|undergone|used|avoided|performed|scheduled|recommended|advised)\b/iu;
const PASSIVE_INDICATION_ASSERTION =
  /\b[^.!?;,\n]{1,120}?\s+(?:is|are|appears?\s+to\s+be)\s+(?:clearly\s+|definitely\s+|probably\s+)?(?:recommended|advised|indicated|required)\b/iu;
const IMPERATIVE_RECOMMENDATION =
  /^(?:please\s+)?(?:immediately\s+|promptly\s+|urgently\s+)?(?:administer|arrange|avoid|begin|call|commence|consider|continue|follow|get|give|go|have|perform|prescribe|pursue|receive|schedule|seek|start|stop|take|try|undergo|use)\b/iu;
const URGENCY_ASSERTION =
  /\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she|this|that|it)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:needs?|requires?)\s+(?:immediate|urgent|emergency|prompt|same[- ]day)\b|\b(?:(?:(?:the|this|a)\s+)?patient|you|they|he|she|this|that|it)\s+(?:(?:clearly|definitely|likely|probably)\s+)?(?:is|are|appears?\s+to\s+be|seems?\s+to\s+be)\s+(?:not\s+)?(?:an?\s+)?(?:urgent|emergency|critical|life[- ]threatening)\b|\b(?:urgency|emergency)\s+(?:is|appears?\s+to\s+be|seems?\s+to\s+be)\b|\b(?:immediate|urgent|emergency|prompt|same[- ]day)(?:\s+[\p{L}-]+){0,5}\s+(?:is|are|would\s+be|appears?\s+to\s+be)\s+(?:not\s+)?(?:needed|required|recommended|indicated)\b|\b(?:can|may)\s+safely\s+wait\b|\b(?:cannot|can't|should\s+not|must\s+not)\s+wait\b|\b(?:does\s+not|doesn't)\s+require\s+(?:urgent|emergency)\b|\b(?:emergency|urgent)\s+care\s+(?:is|appears?\s+to\s+be)\s+(?:not\s+)?(?:needed|required)\b/iu;
const WORD_TOKEN = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

const SAFE_ANATOMY_CORE_WORDS = new Set([
  "airway",
  "airways",
  "anatomy",
  "ap",
  "chest",
  "clavicle",
  "clavicles",
  "diaphragm",
  "diaphragms",
  "field",
  "fields",
  "heart",
  "image",
  "left",
  "lung",
  "lungs",
  "marker",
  "markers",
  "mediastinum",
  "orientation",
  "pa",
  "projection",
  "radiograph",
  "rib",
  "ribs",
  "right",
  "scan",
  "silhouette",
  "spine",
  "structure",
  "structures",
  "trachea",
  "x-ray",
]);
const SAFE_ANATOMY_WORDS = new Set([
  ...SAFE_ANATOMY_CORE_WORDS,
  "a",
  "advise",
  "an",
  "and",
  "appear",
  "appears",
  "are",
  "as",
  "at",
  "be",
  "below",
  "between",
  "bilateral",
  "by",
  "can",
  "cardiac",
  "centered",
  "chest",
  "check",
  "checking",
  "described",
  "describes",
  "definitely",
  "depict",
  "depicting",
  "depicts",
  "display",
  "displaying",
  "displays",
  "education",
  "educational",
  "feature",
  "features",
  "finding",
  "findings",
  "for",
  "frontal",
  "from",
  "has",
  "have",
  "he",
  "i",
  "identify",
  "identified",
  "identifies",
  "identifying",
  "image",
  "images",
  "in",
  "include",
  "including",
  "includes",
  "is",
  "it",
  "label",
  "labels",
  "lateral",
  "lies",
  "lower",
  "may",
  "medical",
  "midline",
  "must",
  "need",
  "needs",
  "no",
  "normal",
  "object",
  "objects",
  "of",
  "on",
  "only",
  "ought",
  "or",
  "orient",
  "oriented",
  "orienting",
  "patient",
  "please",
  "probably",
  "projection",
  "radiograph",
  "recommend",
  "recommended",
  "review",
  "reviewing",
  "rotate",
  "rotated",
  "rotating",
  "scan",
  "seen",
  "she",
  "show",
  "showing",
  "shown",
  "shows",
  "side",
  "strongly",
  "suggest",
  "surround",
  "surrounding",
  "surrounds",
  "text",
  "that",
  "the",
  "they",
  "this",
  "thorax",
  "to",
  "uncertain",
  "upper",
  "upright",
  "use",
  "using",
  "view",
  "visible",
  "we",
  "with",
  "without",
  "would",
  "x-ray",
  "you",
  "should",
]);
const SAFE_NONMEDICAL_CORE_WORDS = new Set([
  "algorithm",
  "algorithms",
  "application",
  "applications",
  "cache",
  "caches",
  "calculation",
  "calculations",
  "chart",
  "charts",
  "code",
  "concept",
  "concepts",
  "configuration",
  "configurations",
  "decay",
  "definition",
  "definitions",
  "derivative",
  "derivatives",
  "diagram",
  "diagrams",
  "equation",
  "equations",
  "exercise",
  "exercises",
  "formula",
  "formulas",
  "function",
  "functions",
  "graph",
  "graphs",
  "integral",
  "integrals",
  "latency",
  "lesson",
  "lessons",
  "model",
  "models",
  "ode",
  "odes",
  "plot",
  "plots",
  "problem",
  "problems",
  "provider",
  "providers",
  "separation",
  "software",
  "system",
  "systems",
  "variable",
  "variables",
  "workflow",
  "workflows",
]);
const SAFE_NONMEDICAL_WORDS = new Set([
  ...SAFE_NONMEDICAL_CORE_WORDS,
  "a",
  "advise",
  "an",
  "and",
  "apply",
  "applying",
  "are",
  "as",
  "at",
  "be",
  "by",
  "calculate",
  "calculating",
  "can",
  "check",
  "checking",
  "compare",
  "comparing",
  "compute",
  "computing",
  "configure",
  "configuring",
  "describe",
  "described",
  "describes",
  "definitely",
  "demonstrate",
  "demonstrates",
  "differentiate",
  "differentiating",
  "differential",
  "educational",
  "example",
  "examples",
  "explain",
  "explaining",
  "exponential",
  "first",
  "first-order",
  "for",
  "from",
  "graphing",
  "he",
  "has",
  "have",
  "i",
  "image",
  "in",
  "inspect",
  "inspecting",
  "integrate",
  "integrating",
  "is",
  "it",
  "local",
  "mathematical",
  "measure",
  "measuring",
  "method",
  "methods",
  "no",
  "must",
  "need",
  "needs",
  "of",
  "on",
  "only",
  "or",
  "order",
  "ordinary",
  "ought",
  "patient",
  "plotting",
  "please",
  "probably",
  "recommend",
  "recommended",
  "relate",
  "relates",
  "represent",
  "represents",
  "she",
  "should",
  "solution",
  "solutions",
  "solve",
  "solved",
  "solving",
  "stable",
  "stability",
  "strongly",
  "suggest",
  "suggested",
  "that",
  "the",
  "they",
  "this",
  "to",
  "use",
  "using",
  "we",
  "with",
  "without",
  "would",
  "you",
]);

const SAFE_ORIENTATION_REFERENCE_WORDS = new Set(["ap", "marker", "markers", "orientation", "pa"]);
const SAFE_ORIENTATION_ACTION_WORDS = new Set([
  "check",
  "checking",
  "identify",
  "identified",
  "identifies",
  "identifying",
  "orient",
  "oriented",
  "orienting",
  "review",
  "reviewing",
  "rotate",
  "rotated",
  "rotating",
  "use",
  "using",
]);

const OUTER_WRAPPERS = [
  ["```", "```"],
  ["**", "**"],
  ["__", "__"],
  ["~~", "~~"],
  ["`", "`"],
  ["*", "*"],
  ["_", "_"],
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
] as const;

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
  if (!result.historyAnswer.trim()) {
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
  if (!needsClinicianHandoff) {
    return {
      historyAnswer: answer,
      needsClinicianHandoff: false,
    };
  }
  const answerWithoutExistingHandoff = removeEquivalentClinicianHandoffs(answer);
  if (!answerWithoutExistingHandoff) {
    return {
      historyAnswer: CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
      needsClinicianHandoff: true,
    };
  }
  return {
    historyAnswer: answerWithoutExistingHandoff,
    needsClinicianHandoff: true,
  };
}

function hasUnsafeClinicalAssertion(question: string, answer: string): boolean {
  const context = `${question}\n${answer}`;
  const sentences = answer.match(ANSWER_SENTENCE) ?? [answer];
  for (const rawSentence of sentences) {
    const sentence = normalizeForClassification(rawSentence);
    if (!sentence) {
      continue;
    }
    for (const tail of contrastiveTails(sentence)) {
      if (isUnsafeClinicalSentence(tail, context)) {
        return true;
      }
    }
    if (isUnsafeClinicalSentence(sentence, context)) {
      return true;
    }
  }
  return false;
}

function isUnsafeClinicalSentence(rawSentence: string, context: string): boolean {
  const sentence = stripTerminalPunctuation(normalizeForClassification(rawSentence));
  if (!sentence) {
    return false;
  }
  if (
    isSafeClinicalStatement(sentence) ||
    isSafeAnatomyOrOrientationStatement(sentence) ||
    isSafeNonmedicalEducationalStatement(sentence)
  ) {
    return false;
  }
  if (
    EXPLICIT_DIAGNOSIS_ASSERTION.test(sentence) ||
    FINDINGS_DIAGNOSIS_ASSERTION.test(sentence) ||
    TREATMENT_PLAN_ASSERTION.test(sentence) ||
    URGENCY_ASSERTION.test(sentence) ||
    PASSIVE_MEDICAL_RECOMMENDATION.test(sentence) ||
    PASSIVE_INDICATION_ASSERTION.test(sentence)
  ) {
    return true;
  }
  if (
    PATIENT_DIRECTED_RECOMMENDATION.test(sentence) ||
    DIRECT_RECOMMENDATION.test(sentence) ||
    IMPERATIVE_RECOMMENDATION.test(sentence)
  ) {
    return true;
  }
  return hasAssertedMedicalCondition(sentence, context);
}

function hasAssertedMedicalCondition(sentence: string, context: string): boolean {
  const patientPredicate = sentence.match(PATIENT_CONDITION_ASSERTION)?.[1];
  if (patientPredicate !== undefined && !isSafeKnownPredicate(patientPredicate)) {
    return true;
  }
  const deicticPredicate = sentence.match(DEICTIC_CONDITION_ASSERTION)?.[1];
  if (
    deicticPredicate !== undefined &&
    !isSafeKnownPredicate(deicticPredicate) &&
    hasClinicalOrImageContext(context)
  ) {
    return true;
  }
  const imagePredicate =
    sentence.match(IMAGE_CONDITION_ASSERTION)?.[1] ?? sentence.match(IMAGE_COPULA_ASSERTION)?.[1];
  return imagePredicate !== undefined && !isSafeKnownPredicate(imagePredicate);
}

function isSafeClinicalStatement(sentence: string): boolean {
  const comparable = comparableSentence(sentence);
  if (
    comparable === comparableSentence(CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE) ||
    comparable === comparableSentence(CLINICIAN_HANDOFF_SENTENCE)
  ) {
    return true;
  }
  if (
    SAFE_EDUCATIONAL_BOUNDARY.test(sentence) &&
    !EXPLICIT_DIAGNOSIS_ASSERTION.test(sentence) &&
    !DIRECT_RECOMMENDATION.test(sentence) &&
    !PATIENT_DIRECTED_RECOMMENDATION.test(sentence) &&
    !URGENCY_ASSERTION.test(sentence)
  ) {
    return true;
  }
  if (isSafeClinicianDecisionStatement(sentence)) {
    return true;
  }
  if (containsAffirmativeClinicalDecision(sentence)) {
    return false;
  }
  return SAFE_REFUSAL.test(sentence) && CLINICAL_DECISION_REFERENCE.test(sentence);
}

function isSafeClinicianDecisionStatement(sentence: string): boolean {
  if (!isEquivalentClinicianHandoff(sentence)) {
    return false;
  }
  const assignsDecisionToClinician = CLINICIAN_DECISION_ASSIGNMENT.test(sentence);
  if (
    DIRECT_RECOMMENDATION.test(sentence) ||
    PATIENT_DIRECTED_RECOMMENDATION.test(sentence) ||
    (TREATMENT_PLAN_ASSERTION.test(sentence) && !assignsDecisionToClinician) ||
    (URGENCY_ASSERTION.test(sentence) && !assignsDecisionToClinician) ||
    PASSIVE_MEDICAL_RECOMMENDATION.test(sentence) ||
    PASSIVE_INDICATION_ASSERTION.test(sentence)
  ) {
    return false;
  }
  const patientPredicate = sentence.match(PATIENT_CONDITION_ASSERTION)?.[1];
  if (patientPredicate !== undefined && !isSafeKnownPredicate(patientPredicate)) {
    return false;
  }
  const deicticPredicate = sentence.match(DEICTIC_CONDITION_ASSERTION)?.[1];
  if (deicticPredicate !== undefined && !isSafeKnownPredicate(deicticPredicate)) {
    return false;
  }
  const imagePredicate =
    sentence.match(IMAGE_CONDITION_ASSERTION)?.[1] ?? sentence.match(IMAGE_COPULA_ASSERTION)?.[1];
  if (imagePredicate !== undefined && !isSafeKnownPredicate(imagePredicate)) {
    return false;
  }
  return !EXPLICIT_DIAGNOSIS_ASSERTION.test(sentence) || assignsDecisionToClinician;
}

function containsAffirmativeClinicalDecision(sentence: string): boolean {
  if (
    EXPLICIT_DIAGNOSIS_ASSERTION.test(sentence) ||
    FINDINGS_DIAGNOSIS_ASSERTION.test(sentence) ||
    TREATMENT_PLAN_ASSERTION.test(sentence) ||
    URGENCY_ASSERTION.test(sentence) ||
    DIRECT_RECOMMENDATION.test(sentence) ||
    PATIENT_DIRECTED_RECOMMENDATION.test(sentence)
  ) {
    return true;
  }
  const patientPredicate = sentence.match(PATIENT_CONDITION_ASSERTION)?.[1];
  if (patientPredicate !== undefined && !isSafeKnownPredicate(patientPredicate)) {
    return true;
  }
  const deicticPredicate = sentence.match(DEICTIC_CONDITION_ASSERTION)?.[1];
  if (deicticPredicate !== undefined && !isSafeKnownPredicate(deicticPredicate)) {
    return true;
  }
  const imagePredicate =
    sentence.match(IMAGE_CONDITION_ASSERTION)?.[1] ?? sentence.match(IMAGE_COPULA_ASSERTION)?.[1];
  return (
    (imagePredicate !== undefined && !isSafeKnownPredicate(imagePredicate)) ||
    PASSIVE_MEDICAL_RECOMMENDATION.test(sentence) ||
    PASSIVE_INDICATION_ASSERTION.test(sentence)
  );
}

function isSafeKnownPredicate(value: string): boolean {
  return isSafeAnatomyOrOrientationStatement(value) || isSafeNonmedicalEducationalStatement(value);
}

function isSafeAnatomyOrOrientationStatement(value: string): boolean {
  if (!isLexicallyBoundedStatement(value, SAFE_ANATOMY_WORDS, SAFE_ANATOMY_CORE_WORDS)) {
    return false;
  }
  if (
    !PATIENT_DIRECTED_RECOMMENDATION.test(value) &&
    !DIRECT_RECOMMENDATION.test(value) &&
    !IMPERATIVE_RECOMMENDATION.test(value)
  ) {
    return true;
  }
  const tokens = comparableSentence(value).match(WORD_TOKEN) ?? [];
  return (
    tokens.some((token) => SAFE_ORIENTATION_REFERENCE_WORDS.has(token)) &&
    tokens.some((token) => SAFE_ORIENTATION_ACTION_WORDS.has(token))
  );
}

function isSafeNonmedicalEducationalStatement(value: string): boolean {
  return isLexicallyBoundedStatement(value, SAFE_NONMEDICAL_WORDS, SAFE_NONMEDICAL_CORE_WORDS);
}

function isLexicallyBoundedStatement(
  value: string,
  allowedWords: ReadonlySet<string>,
  coreWords: ReadonlySet<string>,
): boolean {
  const tokens = comparableSentence(value).match(WORD_TOKEN) ?? [];
  return (
    tokens.some((token) => coreWords.has(token)) &&
    tokens.every(
      (token) => allowedWords.has(token) || /^[a-z]$/u.test(token) || /^\d+(?:[a-z])?$/u.test(token),
    )
  );
}

function hasClinicalOrImageContext(value: string): boolean {
  return /\b(?:patient|clinical|medical|diagnos(?:e|ed|es|ing|is|tic)|disease|symptom(?:s)?|treat(?:ment|ments|ed|ing|s)?|therap(?:y|ies)|medication(?:s)?|medicine(?:s)?|prescription(?:s)?|prescrib(?:e|ed|es|ing)|procedure(?:s)?|surgery|urgent|urgency|emergenc(?:y|ies)|hospital|clinic|clinician|doctor|physician|health(?:care|\s+care)|scan|image|x-ray|radiograph|findings?)\b/iu.test(
    value,
  );
}

function contrastiveTails(sentence: string): readonly string[] {
  const tails: string[] = [];
  for (const match of sentence.matchAll(CONTRASTIVE_CONNECTOR)) {
    const tail = sentence.slice((match.index ?? 0) + match[0].length).trim();
    if (tail) {
      tails.push(tail);
    }
  }
  for (const match of sentence.matchAll(/;\s*/gu)) {
    const tail = sentence.slice((match.index ?? 0) + match[0].length).trim();
    if (tail) {
      tails.push(tail);
    }
  }
  return tails;
}

function normalizeForClassification(value: string): string {
  let normalized = value
    .normalize("NFKC")
    .replace(/^(?:>\s*)+/u, "")
    .replace(/^(?:(?:[-+•]|\d+[.)])\s+)+/u, "")
    .trim();
  let previous = "";
  while (normalized && normalized !== previous) {
    previous = normalized;
    for (const [open, close] of OUTER_WRAPPERS) {
      const unwrapped = unwrapOuterWrapper(normalized, open, close);
      if (unwrapped !== normalized) {
        normalized = unwrapped;
        break;
      }
    }
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

function unwrapOuterWrapper(value: string, open: string, close: string): string {
  const terminal = value.match(/[.!?]+$/u)?.[0] ?? "";
  const core = terminal ? value.slice(0, -terminal.length).trimEnd() : value;
  if (!core.startsWith(open) || !core.endsWith(close) || core.length <= open.length + close.length) {
    return value;
  }
  if (open !== close && !wrapperEnclosesWholeValue(core, open, close)) {
    return value;
  }
  return `${core.slice(open.length, -close.length).trim()}${terminal}`;
}

function wrapperEnclosesWholeValue(value: string, open: string, close: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.startsWith(open, index)) {
      depth += 1;
      index += open.length - 1;
      continue;
    }
    if (value.startsWith(close, index)) {
      depth -= 1;
      if (depth === 0 && index + close.length < value.length) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
      index += close.length - 1;
    }
  }
  return depth === 0;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?]+$/u, "").trim();
}

function comparableSentence(value: string): string {
  return stripTerminalPunctuation(normalizeForClassification(value)).toLocaleLowerCase("en-US");
}

function removeEquivalentClinicianHandoffs(answer: string): string {
  return answer
    .replace(ANSWER_SENTENCE, (sentence) => (isEquivalentClinicianHandoff(sentence) ? "" : sentence))
    .replaceAll(/[ \t]{2,}/gu, " ")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n[ \t]+/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function isEquivalentClinicianHandoff(sentence: string): boolean {
  const normalized = normalizeForClassification(sentence);
  if (EXISTING_CLINICIAN_HANDOFF.test(normalized)) {
    return true;
  }
  if (!CLINICIAN_REFERENCE.test(normalized)) {
    return false;
  }
  return (
    DIRECT_CLINICIAN_REFERRAL.test(normalized) ||
    (CLINICAL_DECISION_REFERENCE.test(normalized) && CLINICIAN_HANDOFF_DIRECTION.test(normalized))
  );
}
