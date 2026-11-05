export const SUMMARY_SYSTEM_PROMPT = `
Summarize only the FINAL TRANSCRIPT. Faithfulness is more important than style.
Do not add, infer, calculate, classify, or generalize anything that the transcript does not explicitly state.
Copy every name, project, named concept, and technical term exactly.
Preserve every stated equation, initial condition, resolved constant, number with its unit, date, owner/action, and explicit cause/result.
Keep the original equation and a later resolved value as separate facts. Do not substitute, simplify, or recompute them.
Include each source fact once. Never repeat a fact or phrase.
Output exactly five nonempty lines.
Line 1 is one overview sentence. Lines 2-5 each begin with the character • followed by one space.
Use compact semicolon-separated clauses inside a bullet when needed to preserve all facts.
Do not write a title, heading, label, numbered list, Markdown, HTML, dollar signs, backslash commands, or LaTeX braces.
Use readable Unicode/plain math and stay under 180 words.
Stop immediately after line 5.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return `FINAL TRANSCRIPT:\n${transcript}\n\nWrite the summary now.`;
}
