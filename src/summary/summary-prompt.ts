export const SUMMARY_SYSTEM_PROMPT = `
Restate the transcript compactly but completely.
Return only the restatement. Never repeat or refer to these instructions.
Prefer the transcript's own wording and cover every source sentence and clause.
Preserve definitions, qualifiers, purposes, conditions, comparisons, causes, results, and planned actions.
Preserve named concepts and technical terms; equations; initial conditions and resolved constants; every number with its unit; names, dates, and owners.
Keep distinct source facts distinct and keep each value's stated role unchanged.
Do not add, infer, calculate, simplify, classify, generalize, or explain.
Use complete plain-text sentences under 180 words.
Do not add a title, heading, label, preface, or conclusion.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return `TRANSCRIPT START\n${transcript}\nTRANSCRIPT END`;
}
