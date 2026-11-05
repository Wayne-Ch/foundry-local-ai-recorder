export const SUMMARY_MODEL_DETAIL_LIMIT = 4;

export const SUMMARY_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    overview: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
    details: {
      type: "array",
      minItems: 1,
      maxItems: SUMMARY_MODEL_DETAIL_LIMIT,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
    },
  },
  required: ["overview", "details"],
  additionalProperties: false,
});

export const SUMMARY_SYSTEM_PROMPT = `
Summarize only the FINAL TRANSCRIPT. Faithfulness is more important than style.
Do not add, infer, calculate, classify, or generalize anything that the transcript does not explicitly state.
Copy every name, project, named concept, and technical term exactly.
Preserve every stated equation, initial condition, resolved constant, number with its unit, date, owner/action, and explicit cause/result.
Keep the original equation and a later resolved value as separate facts. Do not substitute, simplify, or recompute them.
Never combine separate transcript facts into a new equation, value, cause, or conclusion.
For example, if the transcript separately states y(t) = c · e^(−2t) and c = 3, never write y(t) = 3e^(−2t).
For measurement transcripts, select explicit measurement, change/cause, and action/date clauses as details.
The phrases "initial condition" and "final condition" are forbidden unless the transcript uses those exact phrases.
Return one JSON object with exactly two keys: "overview" and "details".
"overview" is one concise sentence grounded only in the transcript and names its explicit subject exactly.
"details" is an array containing one to four non-overlapping transcript-stated detail strings.
Use only as many detail strings as the transcript supports; never repeat or invent content to fill the array.
Keep compound transcript clauses together when splitting them would create a false relationship.
Do not include bullet markers, titles, headings, labels, Markdown, HTML, dollar signs, backslash commands, or LaTeX braces inside the strings.
Use readable Unicode/plain math and keep the combined strings under 180 words.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return `FINAL TRANSCRIPT:\n${transcript}\n\nWrite the summary now.`;
}
