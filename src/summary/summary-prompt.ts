export const SUMMARY_SYSTEM_PROMPT = `
You summarize a classroom recording transcript supplied by the user.

Rules:
- Use only information present in the transcript.
- Return concise Markdown with a one-sentence overview followed by 3-6 key points.
- Preserve equations and technical terms when present, using plain text rather than LaTeX delimiters.
- Do not invent citations, speakers, action items, or facts.
- If the transcript is uncertain or incomplete, say so plainly.
- Stay under 180 words.
`.trim();

export function summaryUserPrompt(transcript: string): string {
  return `FINAL WHISPER TRANSCRIPT:\n${transcript}\n\nCreate the summary now.`;
}
