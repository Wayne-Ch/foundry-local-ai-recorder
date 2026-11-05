import { canonicalSummarySemanticText } from "./summary-canonical";
import { GENERIC_SUMMARY_OVERVIEW, hasDuplicateSummaryUnits, isCompleteSummaryUnit } from "./summary-unit";

export const SUMMARY_MODEL_DETAIL_COUNT = 4;
export { GENERIC_SUMMARY_OVERVIEW } from "./summary-unit";

export const SUMMARY_JSON_SCHEMA = JSON.stringify(summaryJsonSchemaShape());

export interface SummaryRequestPlan {
  readonly overview: string;
  readonly facts: readonly string[];
  readonly prompt: string;
  readonly jsonSchema: string;
}

function summaryJsonSchemaShape(overview?: string, facts?: readonly string[]): object {
  return {
    type: "object",
    properties: {
      overview: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description:
          "One complete subject-only sentence, or the exact generic meta overview supplied in the prompt.",
        ...(overview === undefined ? {} : { enum: [overview] }),
      },
      details: {
        type: "array",
        minItems: SUMMARY_MODEL_DETAIL_COUNT,
        maxItems: SUMMARY_MODEL_DETAIL_COUNT,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "One complete, source-supported fact with terminal punctuation.",
          ...(facts?.length === SUMMARY_MODEL_DETAIL_COUNT ? { enum: facts } : {}),
        },
      },
    },
    required: ["overview", "details"],
    additionalProperties: false,
  };
}

export const SUMMARY_SYSTEM_PROMPT = `
Summarize only the FINAL TRANSCRIPT. Faithfulness is more important than style.
Do not add, infer, calculate, classify, or generalize anything that the transcript does not explicitly state.
Copy every name, project, named concept, and technical term exactly.
Preserve every stated equation, initial condition, resolved constant, number with its unit, date, owner/action, and explicit cause/result.
Keep the original equation and a later resolved value as separate facts. Do not substitute, simplify, or recompute them.
Never combine separate transcript facts into a new equation, value, cause, or conclusion.
For example, if the transcript separately states y(t) = c · e^(−2t) and c = 3, never write y(t) = 3e^(−2t).
Never describe e^(−2t) as having a coefficient of 3 when the transcript states c = 3 separately.
Do not reinterpret an "initial value" as y(0), t = 0, or an "initial condition" unless the transcript explicitly states that notation or phrase.
Choose four complete transcript clauses in source order. Prefer subject/relationship, equation/action, general solution/behavior, and explicit value/owner/date clauses when present.
For differential-equation transcripts, use one detail for the definition/relationship, one for the equation and method, one for the general solution and stated behavior, and one for the stated condition/value and resolved constant.
Do not use two details for the same condition, value, equation, target, owner, cause, or date relationship.
For measurement transcripts, select explicit measurement, change/cause, target, owner/action, and date clauses as details.
The phrases "initial condition" and "final condition" are forbidden unless the transcript uses those exact phrases.
Return one JSON object with exactly two keys: "overview" and "details".
"overview" is one concise subject-only sentence and must not absorb or restate the four detail facts.
"overview" and every detail must end with terminal punctuation and must not end in a dangling conjunction, name, preposition, or incomplete predicate.
For a transcript without a recognized Project, Team, or ordinary-differential-equation subject, use the exact non-factual meta overview supplied by the user prompt only when there are exactly four independent source facts.
The generic meta overview is presentation text, not a transcript claim, and it never replaces a detail.
"details" is an array containing exactly four complete, nonempty, non-overlapping transcript-stated detail strings.
If the FINAL TRANSCRIPT has exactly four complete sentences, copy those four sentences into "details" in the same order, changing only notation.
If it has three sentences, split one sentence only at an explicitly stated independent clause so that no fact is repeated or inferred.
Never repeat, manufacture, or split a fact merely to fill the array.
Keep compound transcript clauses together when splitting them would create a false relationship.
Do not include bullet markers, titles, headings, labels, Markdown, HTML, dollar signs, backslash commands, or LaTeX braces inside the strings.
Use readable Unicode/plain math and keep the combined strings under 180 words.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return summaryRequestPlan(transcript).prompt;
}

export function summaryRequestPlan(transcript: string): SummaryRequestPlan {
  const sentences = splitTranscriptSentences(transcript);
  const recognizedOverview = sourceOverview(transcript);
  const facts =
    recognizedOverview === null ? validateGenericFacts(sentences) : sourceFactCandidates(sentences);
  const overview = recognizedOverview ?? GENERIC_SUMMARY_OVERVIEW;
  const numberedFacts = facts.map((fact, index) => `[F${index + 1}] ${fact}`).join("\n");
  const detailInstruction =
    facts.length === SUMMARY_MODEL_DETAIL_COUNT
      ? "Set details[0] to the exact text after [F1], details[1] to [F2], details[2] to [F3], and details[3] to [F4]. The overview does not replace any detail."
      : "Select four different complete source facts in source order without repeating or combining them.";
  return {
    overview,
    facts,
    prompt: `FINAL TRANSCRIPT:\n${transcript}\n\nOVERVIEW TEXT (copy exactly):\n${overview}\n\nSOURCE FACTS (${facts.length}):\n${numberedFacts}\n\nSet "overview" to the exact OVERVIEW TEXT above.\nThe [F#] labels, the words "source fact", and any discussion of these instructions are forbidden in the output.\n${detailInstruction}\nWrite the JSON summary now.`,
    jsonSchema: JSON.stringify(summaryJsonSchemaShape(overview, facts)),
  };
}

function sourceOverview(transcript: string): string | null {
  const namedSubject = transcript.match(/\b(?:Project|Team)\s+[\p{L}\p{N}-]+/u)?.[0];
  if (namedSubject !== undefined) {
    return `The transcript concerns ${namedSubject}.`;
  }
  if (/\bordinary differential equation\b/iu.test(transcript)) {
    return "The transcript concerns an ordinary differential equation.";
  }
  return null;
}

function validateGenericFacts(sentences: readonly string[]): readonly string[] {
  if (
    sentences.length !== SUMMARY_MODEL_DETAIL_COUNT ||
    sentences.some((sentence) => !isCompleteSummaryUnit(sentence)) ||
    hasDuplicateSummaryUnits(sentences) ||
    sentences.some((sentence) => canonicalSummarySemanticText(sentence).length === 0)
  ) {
    throw new Error(
      "The final transcript did not contain exactly four independent complete facts for a generic summary.",
    );
  }
  return sentences;
}

function sourceFactCandidates(sentences: readonly string[]): readonly string[] {
  if (sentences.length !== SUMMARY_MODEL_DETAIL_COUNT - 1) {
    return sentences;
  }
  for (const [index, sentence] of sentences.entries()) {
    const split = splitCoordinatedFacts(sentence) ?? splitMeasurementFacts(sentence);
    if (split !== null) {
      return [...sentences.slice(0, index), ...split, ...sentences.slice(index + 1)];
    }
  }
  return sentences;
}

function splitCoordinatedFacts(sentence: string): readonly [string, string] | null {
  const match = sentence.match(/^(.*?),\s+and\s+((?:the|a|an|[\p{Lu}])\b.*)$/u);
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();
  if (left === undefined || right === undefined || wordCount(left) < 3 || wordCount(right) < 3) {
    return null;
  }
  return [withTerminalPunctuation(left), withTerminalPunctuation(capitalizeFirst(right))];
}

function splitMeasurementFacts(sentence: string): readonly [string, string] | null {
  const match = sentence.match(
    /^(.*\bmeasured\b.*\bat\s+\d+(?:\.\d+)?\s+[\p{L}-]+)\s+at\s+(\d+(?:\.\d+)?\s+(?:degrees?\s+Celsius|°C))[.!?]?$/iu,
  );
  const measurement = match?.[1]?.trim();
  const condition = match?.[2]?.trim();
  if (measurement === undefined || condition === undefined) {
    return null;
  }
  return [withTerminalPunctuation(measurement), withTerminalPunctuation(`The temperature was ${condition}`)];
}

function withTerminalPunctuation(value: string): string {
  return /[.!?]$/u.test(value) ? value : `${value}.`;
}

function capitalizeFirst(value: string): string {
  const [first, ...rest] = [...value];
  return first === undefined ? value : `${first.toLocaleUpperCase()}${rest.join("")}`;
}

function wordCount(value: string): number {
  return value.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function splitTranscriptSentences(transcript: string): readonly string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < transcript.length; index += 1) {
    if (!/[.!?]/u.test(transcript[index] ?? "")) {
      continue;
    }
    if (/\d/u.test(transcript[index - 1] ?? "") && /\d/u.test(transcript[index + 1] ?? "")) {
      continue;
    }
    let end = index + 1;
    while (/["'”’)\]}]/u.test(transcript[end] ?? "")) {
      end += 1;
    }
    const whitespace = transcript.slice(end).match(/^\s+/u)?.[0] ?? "";
    const atEnd = end === transcript.length;
    const next = transcript[end + whitespace.length];
    if (!atEnd && (!whitespace || next === undefined || !/[\p{Lu}\p{N}]/u.test(next))) {
      continue;
    }
    const sentence = transcript.slice(start, end).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    start = end + whitespace.length;
    index = start - 1;
  }
  const tail = transcript.slice(start).trim();
  if (tail) {
    sentences.push(tail);
  }
  return sentences.length === 0 ? [transcript.trim()] : sentences;
}
