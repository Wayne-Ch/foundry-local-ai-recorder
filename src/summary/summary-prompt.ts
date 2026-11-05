export const SUMMARY_SYSTEM_PROMPT = `
Summarize only the FINAL TRANSCRIPT. Faithfulness is more important than style.
Do not add, infer, calculate, classify, or generalize anything that the transcript does not explicitly state.
Copy every name, project, named concept, and technical term exactly.
Preserve every stated equation, initial condition, resolved constant, number with its unit, date, owner/action, and explicit cause/result.
Keep the original equation and a later resolved value as separate facts. Do not substitute, simplify, or recompute them.
Never combine separate transcript facts into a new equation, value, cause, or conclusion.
For example, if the transcript separately states y(t) = c · e^(−2t) and c = 3, never write y(t) = 3e^(−2t).
Do not repeat a detail fact or phrase across the four bullets.
Output exactly five nonempty lines.
Line 1 is one overview sentence grounded only in the transcript and names its explicit subject exactly.
Lines 2-5 each begin with the character • followed by one space and contain four non-overlapping detail groups.
Plan all five lines before writing. Never stop after only three bullets.
If the transcript has fewer than four sentences, split its compound sentences or clauses across the four bullets.
Each bullet must add a different transcript-stated fact; remove any bullet that only repeats another bullet.
Use compact semicolon-separated clauses inside a bullet when needed to preserve all stated facts.
Do not write a title, heading, label, numbered list, Markdown, HTML, dollar signs, backslash commands, or LaTeX braces.
Use readable Unicode/plain math and stay under 180 words.
Stop immediately after line 5.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return `FINAL TRANSCRIPT:\n${transcript}\n\nWrite the summary now.`;
}
