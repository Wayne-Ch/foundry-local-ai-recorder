const SUMMARY_VISUAL_LIST_MARKER = /^(?:•\s+|[-*]\s+(?=[\p{Lu}"'“‘`]))/u;
const SEMANTIC_TOKEN = /<=>|<->|=>|->|<-|<=|>=|!=|==|<>|[=<>+\-±'°%×·*]|\p{L}+|\p{N}+(?:\.\p{N}+)?/gu;

export function canonicalSummarySemanticText(value: string): string {
  const tokens = summarySemanticTokens(
    value
      .split("\n")
      .map((line) => line.trim().replace(SUMMARY_VISUAL_LIST_MARKER, ""))
      .filter(Boolean)
      .join(" "),
  );
  if ((tokens[0] === "where" || tokens[0] === "which") && tokens[1] === "the") {
    return tokens.slice(2).join(" ");
  }
  return (tokens[0] === "the" ? tokens.slice(1) : tokens).join(" ");
}

export function summarySemanticTokens(value: string): readonly string[] {
  const normalized = normalizeSemanticGlyphs(value);
  const tokens: string[] = [];
  for (const match of normalized.matchAll(SEMANTIC_TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (token === "-" && isLexicalHyphen(normalized, index)) {
      continue;
    }
    if (token === "'" && isApostrophe(normalized, index)) {
      continue;
    }
    tokens.push(normalizeSemanticToken(token));
  }
  return tokens;
}

function normalizeSemanticGlyphs(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[−﹣]/gu, "-")
    .replaceAll("≤", "<=")
    .replaceAll("≥", ">=")
    .replaceAll("≠", "!=")
    .replaceAll(/[→⟶⟹⇒]/gu, "->")
    .replaceAll(/[←⟵⇐]/gu, "<-")
    .replaceAll(/[↔⟷⇔]/gu, "<->")
    .replaceAll(/[′’]/gu, "'");
}

function normalizeSemanticToken(token: string): string {
  switch (token) {
    case "==":
      return "=";
    case "<>":
      return "!=";
    case "=>":
      return "->";
    case "<=>":
      return "<->";
    case "×":
    case "·":
      return "*";
    case "°":
      return "deg";
    default:
      return token;
  }
}

function isLexicalHyphen(value: string, index: number): boolean {
  const previous = value[index - 1] ?? "";
  const next = value[index + 1] ?? "";
  if (!/\p{L}/u.test(previous) || !/\p{L}/u.test(next)) {
    return false;
  }
  const left = value.slice(0, index).match(/\p{L}+$/u)?.[0] ?? "";
  const right = value.slice(index + 1).match(/^\p{L}+/u)?.[0] ?? "";
  return left.length > 1 && right.length > 1;
}

function isApostrophe(value: string, index: number): boolean {
  return /\p{L}/u.test(value[index - 1] ?? "") && /\p{L}/u.test(value[index + 1] ?? "");
}
