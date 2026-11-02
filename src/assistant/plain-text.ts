const MAX_ASSISTANT_DISPLAY_CHARS = 4_000;

export function formatAssistantPlainText(value: string): string {
  const normalized = [...value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 0x09 || codePoint === 0x0a || (codePoint > 0x1f && codePoint !== 0x7f);
    })
    .join("")
    .trim();
  if (!normalized) {
    throw new Error("The local assistant returned no displayable text.");
  }
  if (normalized.length > MAX_ASSISTANT_DISPLAY_CHARS) {
    throw new Error("The local assistant response exceeded the display bound.");
  }
  return normalized;
}
