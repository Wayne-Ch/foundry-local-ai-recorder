export interface SummaryDisplayFormatResult {
  readonly text: string;
  readonly formattingApplied: boolean;
}

const superscriptCharacters: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "−": "⁻",
};

const primeCharacters = ["", "′", "″", "‴"] as const;

export function formatSummaryForDisplay(rawText: string): SummaryDisplayFormatResult {
  const normalizedLineEndings = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const withoutMathDelimiters = replaceMathDelimiters(normalizedLineEndings);
  const normalizedMath = formatMathTokens(withoutMathDelimiters, false);
  const text = normalizeWhitespace(normalizedMath);
  return {
    text,
    formattingApplied: text !== rawText,
  };
}

function replaceMathDelimiters(value: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] !== "$" || isEscaped(value, cursor)) {
      output += value[cursor];
      cursor += 1;
      continue;
    }

    const delimiterLength = value[cursor + 1] === "$" ? 2 : 1;
    if (delimiterLength === 1 && !canOpenInlineMath(value, cursor)) {
      output += "$";
      cursor += 1;
      continue;
    }

    const closingIndex = findClosingDelimiter(value, cursor + delimiterLength, delimiterLength);
    if (closingIndex === -1) {
      output += value.slice(cursor, cursor + delimiterLength);
      cursor += delimiterLength;
      continue;
    }

    const math = value.slice(cursor + delimiterLength, closingIndex);
    if (!looksLikeMath(math)) {
      output += value.slice(cursor, closingIndex + delimiterLength);
      cursor = closingIndex + delimiterLength;
      continue;
    }

    output += formatMathTokens(math, true).trim();
    cursor = closingIndex + delimiterLength;
  }

  return output;
}

function canOpenInlineMath(value: string, index: number): boolean {
  const next = value[index + 1];
  return next !== undefined && /[\s\d\p{L}([{\\+\-−]/u.test(next);
}

function findClosingDelimiter(value: string, start: number, delimiterLength: number): number {
  const delimiter = "$".repeat(delimiterLength);
  for (let index = start; index <= value.length - delimiterLength; index += 1) {
    if (!value.startsWith(delimiter, index) || isEscaped(value, index)) {
      continue;
    }
    if (delimiterLength === 1 && value[index + 1] === "$") {
      continue;
    }
    const next = value[index + delimiterLength];
    if (next === undefined || /[\s.,;:!?)}\]]/.test(next)) {
      return index;
    }
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function looksLikeMath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\p{L}$/u.test(trimmed) || /^\p{L}\s*\([^()\r\n]*\)$/u.test(trimmed)) {
    return true;
  }
  if (/^[+\-−]?\d+(?:\.\d+)?\s*\p{L}[\p{L}\d()]*$/u.test(trimmed)) {
    return true;
  }
  return /(?:\\+(?:cdot|times|prime)\b|[=^{}]|[+\-−*/×·]|[\p{L}\d]\s*′)/u.test(trimmed);
}

function formatMathTokens(value: string, mathContext: boolean): string {
  let formatted = value
    .replace(/\\+cdot\b/g, "·")
    .replace(/\\+times\b/g, "×")
    .replace(/\^\s*\{\s*\\+prime\s*\}/g, "′")
    .replace(/\^\s*\\+prime\b/g, "′")
    .replace(/\\+prime\b/g, "′")
    .replace(/\b([A-Za-z])('{1,3})(?=\s*(?:\(|=|[+\-−*/]|$|[.,;:]))/g, (_match, variable, marks) => {
      return `${variable}${primeCharacters[marks.length] ?? marks}`;
    })
    .replace(
      /([A-Za-z0-9)\]])\s*\^\s*\{([^{}\r\n]*)\}/g,
      (_match, base, exponent: string) => `${base}${formatExponent(exponent)}`,
    )
    .replace(/([A-Za-z0-9)\]])\^([+\-−]?\d+[A-Za-z]+)/g, (_match, base, exponent: string) => {
      return `${base}${formatExponent(exponent)}`;
    })
    .replace(/([A-Za-z0-9)\]])\^([+\-−]?\d+)/g, (_match, base, exponent: string) => {
      return `${base}${formatExponent(exponent)}`;
    })
    .replace(/([A-Za-z0-9)\]])\^([A-Za-z])\b/g, "$1^($2)");

  formatted = mathContext
    ? normalizeMathMinus(formatted)
    : formatted.replace(/([=^(]\s*)-(?=\s*[A-Za-z0-9])/g, "$1−");

  const withoutExponentResidue = removeUnmatchedExponentClosers(formatted);
  return mathContext ? removeUnmatchedMathDelimiters(withoutExponentResidue) : withoutExponentResidue;
}

function formatExponent(value: string): string {
  const normalized = normalizeMathMinus(value.trim().replaceAll(/[ \t\u00a0]+/g, " "));
  if (/^[+−]?\d+$/.test(normalized)) {
    return Array.from(normalized, (character) => superscriptCharacters[character] ?? character).join("");
  }
  const compact = /^[+−]?\d+\s*[A-Za-z]+$/.test(normalized) ? normalized.replaceAll(/\s+/g, "") : normalized;
  return `^(${compact})`;
}

function normalizeMathMinus(value: string): string {
  return value.replace(/(^|[=^(+\s])-(?=\s*[A-Za-z0-9])/g, "$1−");
}

function removeUnmatchedExponentClosers(value: string): string {
  const characters = Array.from(value);
  const removed = new Set<number>();
  const braces = findUnmatchedDelimiters(characters, "{", "}");
  const parentheses = findUnmatchedDelimiters(characters, "(", ")");

  for (const index of braces.closings) {
    const before = characters.slice(Math.max(0, index - 120), index).join("");
    if (/(?:\^\([^()\r\n]*\)|[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻])}*$/.test(before)) {
      removed.add(index);
    }
  }
  for (const index of parentheses.closings) {
    const before = characters.slice(Math.max(0, index - 120), index).join("");
    if (/\^\([^()\r\n]*\)\)*$/.test(before)) {
      removed.add(index);
    }
  }

  return characters.filter((_character, index) => !removed.has(index)).join("");
}

function removeUnmatchedMathDelimiters(value: string): string {
  const characters = Array.from(value);
  const removed = new Set<number>();
  const braces = findUnmatchedDelimiters(characters, "{", "}");
  const parentheses = findUnmatchedDelimiters(characters, "(", ")");

  for (const index of [...braces.openings, ...braces.closings, ...parentheses.closings]) {
    removed.add(index);
  }

  return characters.filter((_character, index) => !removed.has(index)).join("");
}

function findUnmatchedDelimiters(
  characters: readonly string[],
  openingCharacter: string,
  closingCharacter: string,
): {
  readonly openings: readonly number[];
  readonly closings: readonly number[];
} {
  const openings: number[] = [];
  const closings: number[] = [];

  for (const [index, character] of characters.entries()) {
    if (character === openingCharacter) {
      openings.push(index);
    } else if (character === closingCharacter && openings.pop() === undefined) {
      closings.push(index);
    }
  }
  return { openings, closings };
}

function normalizeWhitespace(value: string): string {
  const lines: string[] = [];
  let previousWasBlank = true;

  for (const line of value.split("\n")) {
    const normalized = line.replaceAll(/[ \t\f\v\u00a0]+/g, " ").trim();
    if (!normalized) {
      if (!previousWasBlank) {
        lines.push("");
      }
      previousWasBlank = true;
      continue;
    }
    lines.push(normalized);
    previousWasBlank = false;
  }

  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.join("\n");
}
