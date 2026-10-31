export interface SummaryDisplayFormatResult {
  readonly text: string;
  readonly formattingApplied: boolean;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface ExponentReplacement {
  readonly end: number;
  readonly text: string;
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
  const formattedMath = formatOutsideProtectedRegions(normalizedLineEndings);
  const text = normalizeWhitespacePreservingProtectedRegions(formattedMath);
  return {
    text,
    formattingApplied: text !== rawText,
  };
}

function formatOutsideProtectedRegions(value: string): string {
  let output = "";
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const protectedEnd = findProtectedRegionEnd(value, cursor);
    if (protectedEnd === null) {
      cursor += 1;
      continue;
    }

    output += formatUnprotectedText(value.slice(plainStart, cursor));
    output += value.slice(cursor, protectedEnd);
    cursor = protectedEnd;
    plainStart = cursor;
  }

  return output + formatUnprotectedText(value.slice(plainStart));
}

function findProtectedRegionEnd(value: string, index: number): number | null {
  const character = value[index];
  if (character === "`") {
    return findCodeDelimiterEnd(value, index, "`", false);
  }
  if (character === "~" && isLinePrefixWhitespace(value, index)) {
    return findCodeDelimiterEnd(value, index, "~", true);
  }
  if (character !== "<") {
    return null;
  }
  if (value.startsWith("<!--", index)) {
    const end = value.indexOf("-->", index + 4);
    return end === -1 ? value.length : end + 3;
  }

  const remainder = value.slice(index);
  const blockTag = remainder.match(/^<\s*(script|style|code|pre)\b/i)?.[1];
  if (blockTag !== undefined) {
    const openingEnd = findHtmlTagEnd(value, index);
    if (openingEnd === null) {
      return value.length;
    }
    const lowerValue = value.toLowerCase();
    const closingStart = lowerValue.indexOf(`</${blockTag.toLowerCase()}`, openingEnd);
    if (closingStart === -1) {
      return value.length;
    }
    return findHtmlTagEnd(value, closingStart) ?? value.length;
  }

  if (!/^<(?:\/?[A-Za-z]|![A-Za-z]|\?)/.test(remainder)) {
    return null;
  }
  return findHtmlTagEnd(value, index);
}

function findCodeDelimiterEnd(
  value: string,
  index: number,
  delimiterCharacter: "`" | "~",
  requireFence: boolean,
): number | null {
  let delimiterLength = 1;
  while (value[index + delimiterLength] === delimiterCharacter) {
    delimiterLength += 1;
  }
  if (requireFence && delimiterLength < 3) {
    return null;
  }

  const delimiter = delimiterCharacter.repeat(delimiterLength);
  const closingIndex = value.indexOf(delimiter, index + delimiterLength);
  return closingIndex === -1 ? value.length : closingIndex + delimiterLength;
}

function isLinePrefixWhitespace(value: string, index: number): boolean {
  const lineStart = value.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]*$/.test(value.slice(lineStart, index));
}

function findHtmlTagEnd(value: string, index: number): number | null {
  let quote: '"' | "'" | null = null;
  for (let cursor = index + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (quote !== null) {
      if (character === quote && !isEscaped(value, cursor)) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor + 1;
    }
  }
  return null;
}

function formatUnprotectedText(value: string): string {
  let output = "";
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] !== "$" || isEscaped(value, cursor)) {
      cursor += 1;
      continue;
    }

    const delimiterLength = value[cursor + 1] === "$" ? 2 : 1;
    if (delimiterLength === 1 && !canOpenInlineMath(value, cursor)) {
      cursor += 1;
      continue;
    }

    const closingIndex = findClosingDelimiter(value, cursor + delimiterLength, delimiterLength);
    if (closingIndex === -1) {
      cursor += delimiterLength;
      continue;
    }

    const math = value.slice(cursor + delimiterLength, closingIndex);
    if (!looksLikeMath(math)) {
      cursor = closingIndex + delimiterLength;
      continue;
    }

    output += formatImplicitText(value.slice(plainStart, cursor));
    output += formatMathTokens(math).trim();
    cursor = closingIndex + delimiterLength;
    plainStart = cursor;
  }

  return output + formatImplicitText(value.slice(plainStart));
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
    if (delimiterLength === 1) {
      return -1;
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

function formatImplicitText(value: string): string {
  let output = "";
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const quotedEnd = findQuotedRegionEnd(value, cursor);
    if (quotedEnd === null) {
      cursor += 1;
      continue;
    }

    output += formatImplicitUnquoted(value.slice(plainStart, cursor));
    output += value.slice(cursor, quotedEnd);
    cursor = quotedEnd;
    plainStart = cursor;
  }

  return output + formatImplicitUnquoted(value.slice(plainStart));
}

function findQuotedRegionEnd(value: string, index: number): number | null {
  const opening = value[index] ?? "";
  const closing =
    opening === '"' ? '"' : opening === "“" ? "”" : opening === "‘" ? "’" : opening === "'" ? "'" : null;
  if (closing === null) {
    return null;
  }
  if (opening === "'" && index > 0 && /[\p{L}\d_]/u.test(value[index - 1] ?? "")) {
    return null;
  }

  for (let cursor = index + opening.length; cursor < value.length; cursor += 1) {
    if (value.startsWith(closing, cursor) && !isEscaped(value, cursor)) {
      return cursor + closing.length;
    }
  }
  return value.length;
}

function formatImplicitUnquoted(value: string): string {
  const ranges = mergeRanges([...findImplicitEquationRanges(value), ...findStructuredMathRanges(value)]);
  if (ranges.length === 0) {
    return value;
  }

  let output = "";
  let cursor = 0;
  for (const range of ranges) {
    output += value.slice(cursor, range.start);
    output += formatMathTokens(value.slice(range.start, range.end));
    cursor = range.end;
  }
  return output + value.slice(cursor);
}

function findImplicitEquationRanges(value: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  for (let equalsIndex = 0; equalsIndex < value.length; equalsIndex += 1) {
    if (value[equalsIndex] !== "=" || isComparisonOperator(value, equalsIndex)) {
      continue;
    }

    const start = findEquationStart(value, equalsIndex);
    if (start === null) {
      continue;
    }
    const rightStart = skipHorizontalWhitespace(value, equalsIndex + 1);
    const end = consumeMathExpression(value, rightStart);
    if (end === null) {
      continue;
    }

    ranges.push({ start, end });
    equalsIndex = end - 1;
  }
  return ranges;
}

function isComparisonOperator(value: string, index: number): boolean {
  return /[=<>!]/.test(value[index - 1] ?? "") || /[=>]/.test(value[index + 1] ?? "");
}

function findEquationStart(value: string, equalsIndex: number): number | null {
  const minimum = Math.max(0, equalsIndex - 160);
  for (let start = minimum; start < equalsIndex; start += 1) {
    if (!isExpressionStartBoundary(value, start)) {
      continue;
    }
    const end = consumeMathExpression(value, start);
    if (end !== null && skipHorizontalWhitespace(value, end) === equalsIndex) {
      return start;
    }
  }
  return null;
}

function isExpressionStartBoundary(value: string, index: number): boolean {
  if (!beginsMathFactor(value, index)) {
    return false;
  }
  const previous = value[index - 1];
  return previous === undefined || /[\s([{:;,!.?]/.test(previous);
}

function consumeMathExpression(value: string, start: number): number | null {
  let cursor = skipHorizontalWhitespace(value, start);
  const firstEnd = consumeSignedFactor(value, cursor);
  if (firstEnd === null) {
    return null;
  }
  cursor = firstEnd;

  while (cursor < value.length) {
    const spacedCursor = skipHorizontalWhitespace(value, cursor);
    const operatorEnd = consumeMathOperator(value, spacedCursor);
    if (operatorEnd !== null) {
      const factorStart = skipHorizontalWhitespace(value, operatorEnd);
      const factorEnd = consumeSignedFactor(value, factorStart);
      if (factorEnd === null) {
        return cursor;
      }
      cursor = factorEnd;
      continue;
    }

    if (spacedCursor > cursor) {
      const factorEnd = consumeFactor(value, spacedCursor);
      if (factorEnd !== null) {
        cursor = factorEnd;
        continue;
      }
    }
    return cursor;
  }

  return cursor;
}

function consumeSignedFactor(value: string, start: number): number | null {
  let cursor = start;
  if (/[+\-−]/.test(value[cursor] ?? "")) {
    cursor = skipHorizontalWhitespace(value, cursor + 1);
  }
  return consumeFactor(value, cursor);
}

function consumeFactor(value: string, start: number): number | null {
  const number = value.slice(start).match(/^\d+(?:\.\d+)?/);
  if (number !== null) {
    let cursor = start + number[0].length;
    const coefficient = readLetter(value, cursor);
    if (coefficient !== null) {
      cursor += coefficient.length;
      if (/[\p{L}\d_]/u.test(value[cursor] ?? "")) {
        return null;
      }
    }
    return consumeExponentSuffix(value, cursor);
  }

  const letter = readLetter(value, start);
  if (letter !== null) {
    let cursor = start + letter.length;
    if (/[\p{L}\d_]/u.test(value[cursor] ?? "")) {
      return null;
    }
    while (value[cursor] === "'" || /[′″‴]/.test(value[cursor] ?? "")) {
      cursor += 1;
    }
    if (value[cursor] === "(") {
      const closing = findMatchingDelimiter(value, cursor, "(", ")");
      if (closing === null || closing - cursor > 80 || value.slice(cursor, closing + 1).includes("\n")) {
        return null;
      }
      cursor = closing + 1;
    }
    return consumeExponentSuffix(value, cursor);
  }

  if (value[start] === "(") {
    const closing = findMatchingDelimiter(value, start, "(", ")");
    return closing === null ? null : consumeExponentSuffix(value, closing + 1);
  }
  return null;
}

function consumeExponentSuffix(value: string, factorEnd: number): number {
  const caret = skipHorizontalWhitespace(value, factorEnd);
  if (value[caret] !== "^") {
    return factorEnd;
  }

  let cursor = skipHorizontalWhitespace(value, caret + 1);
  if (value[cursor] === "{") {
    const closing = findMatchingDelimiter(value, cursor, "{", "}");
    if (closing === null) {
      return factorEnd;
    }
    cursor = closing + 1;
    return value[cursor] === "}" ? cursor + 1 : cursor;
  }
  if (value[cursor] === "(") {
    const closing = findMatchingDelimiter(value, cursor, "(", ")");
    if (closing === null) {
      return factorEnd;
    }
    cursor = closing + 1;
    return value[cursor] === ")" ? cursor + 1 : cursor;
  }

  const prime = value.slice(cursor).match(/^\\+prime\b/);
  if (prime !== null) {
    return cursor + prime[0].length;
  }

  if (/[+\-−]/.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  const exponent = value.slice(cursor).match(/^\d+\p{L}*|^\p{L}/u);
  return exponent === null ? factorEnd : cursor + exponent[0].length;
}

function consumeMathOperator(value: string, start: number): number | null {
  const command = value.slice(start).match(/^\\+(?:cdot|times)\b/);
  if (command !== null) {
    return start + command[0].length;
  }
  return /[+\-−*/×·]/.test(value[start] ?? "") ? start + 1 : null;
}

function beginsMathFactor(value: string, index: number): boolean {
  return /[\d(+\-−]/.test(value[index] ?? "") || readLetter(value, index) !== null;
}

function readLetter(value: string, index: number): string | null {
  return value.slice(index).match(/^\p{L}/u)?.[0] ?? null;
}

function skipHorizontalWhitespace(value: string, index: number): number {
  let cursor = index;
  while (/[ \t\u00a0]/.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findStructuredMathRanges(value: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const letter = readLetter(value, index);
    if (letter !== null && isStandaloneMathLetter(value, index, letter.length)) {
      let primeEnd = index + letter.length;
      while (value[primeEnd] === "'") {
        primeEnd += 1;
      }
      if (
        primeEnd > index + letter.length &&
        primeEnd - index - letter.length <= 3 &&
        !/[\p{L}\d_']/u.test(value[primeEnd] ?? "")
      ) {
        ranges.push({ start: index, end: primeEnd });
      }
    }

    if (!isImplicitExponentBase(value, index)) {
      continue;
    }
    const caret = skipHorizontalWhitespace(value, index + 1);
    if (value[caret] !== "^") {
      continue;
    }
    const exponentStart = skipHorizontalWhitespace(value, caret + 1);
    if (value[exponentStart] === "{") {
      const closing = findMatchingDelimiter(value, exponentStart, "{", "}");
      if (closing !== null) {
        ranges.push({
          start: index,
          end: value[closing + 1] === "}" ? closing + 2 : closing + 1,
        });
      }
      continue;
    }
    if (value[exponentStart] === "(") {
      const closing = findMatchingDelimiter(value, exponentStart, "(", ")");
      if (closing !== null) {
        ranges.push({
          start: index,
          end: value[closing + 1] === ")" ? closing + 2 : closing + 1,
        });
      }
      continue;
    }
    const prime = value.slice(exponentStart).match(/^\\+prime\b/);
    if (prime !== null) {
      ranges.push({ start: index, end: exponentStart + prime[0].length });
    }
  }
  return ranges;
}

function isStandaloneMathLetter(value: string, index: number, length: number): boolean {
  return !/[\p{L}\d_]/u.test(value[index - 1] ?? "") && !/[\p{L}\d_]/u.test(value[index + length] ?? "");
}

function isImplicitExponentBase(value: string, index: number): boolean {
  const character = value[index];
  if (/[\d)\]]/.test(character ?? "")) {
    return true;
  }
  const letter = readLetter(value, index);
  if (letter === null) {
    return false;
  }
  return !/[\p{L}_]/u.test(value[index - 1] ?? "");
}

function mergeRanges(ranges: readonly TextRange[]): readonly TextRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end) {
      merged.push(range);
      continue;
    }
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    };
  }
  return merged;
}

function formatMathTokens(value: string): string {
  const prepared = value
    .replace(/\^\s*\{\s*\\+prime\s*\}/g, "′")
    .replace(/\^\s*\\+prime\b/g, "′")
    .replace(/\\+prime\b/g, "′")
    .replace(/\\+cdot\b/g, "·")
    .replace(/\\+times\b/g, "×")
    .replace(
      /(^|[^\p{L}\d_])(\p{L})('{1,3})(?=$|[^\p{L}\d_'])/gu,
      (_match, prefix: string, variable: string, marks: string) =>
        `${prefix}${variable}${primeCharacters[marks.length] ?? marks}`,
    );

  let output = "";
  let cursor = 0;
  while (cursor < prepared.length) {
    if (prepared[cursor] === "^" && hasExponentBaseBefore(prepared, cursor)) {
      const replacement = formatExponentAt(prepared, cursor);
      if (replacement !== null) {
        output += replacement.text;
        cursor = replacement.end;
        continue;
      }
    }
    output += prepared[cursor];
    cursor += 1;
  }
  return normalizeMathMinus(output);
}

function hasExponentBaseBefore(value: string, caretIndex: number): boolean {
  let cursor = caretIndex - 1;
  while (cursor >= 0 && /[ \t\u00a0]/.test(value[cursor] ?? "")) {
    cursor -= 1;
  }
  return cursor >= 0 && (/[\d)\]]/.test(value[cursor] ?? "") || readLetter(value, cursor) !== null);
}

function formatExponentAt(value: string, caretIndex: number): ExponentReplacement | null {
  let exponentStart = skipHorizontalWhitespace(value, caretIndex + 1);
  if (value[exponentStart] === "{") {
    const closing = findMatchingDelimiter(value, exponentStart, "{", "}");
    if (closing === null) {
      return null;
    }
    const exponent = value.slice(exponentStart + 1, closing);
    if (/[{}\r\n]/.test(exponent)) {
      return null;
    }
    const formatted = formatExponent(exponent);
    if (formatted === null) {
      return null;
    }
    const end = value[closing + 1] === "}" ? closing + 2 : closing + 1;
    return { text: formatted, end };
  }
  if (value[exponentStart] === "(") {
    const closing = findMatchingDelimiter(value, exponentStart, "(", ")");
    if (closing === null) {
      return null;
    }
    const exponent = value.slice(exponentStart + 1, closing);
    if (/[()]/.test(exponent)) {
      return null;
    }
    const normalized = normalizeExponentText(exponent);
    if (!normalized) {
      return null;
    }
    const end = value[closing + 1] === ")" ? closing + 2 : closing + 1;
    return { text: `^(${normalized})`, end };
  }

  if (/[+\-−]/.test(value[exponentStart] ?? "")) {
    exponentStart += 1;
  }
  const digits = value.slice(exponentStart).match(/^\d+/)?.[0];
  if (digits === undefined) {
    return null;
  }
  const end = exponentStart + digits.length;
  if (readLetter(value, end) !== null || /[\d_]/.test(value[end] ?? "")) {
    return null;
  }
  const exponent = value.slice(skipHorizontalWhitespace(value, caretIndex + 1), end);
  const formatted = formatExponent(exponent);
  return formatted === null ? null : { text: formatted, end };
}

function formatExponent(value: string): string | null {
  const normalized = normalizeExponentText(value);
  if (!normalized) {
    return null;
  }
  if (/^[+−]?\d+$/.test(normalized)) {
    return Array.from(normalized, (character) => superscriptCharacters[character] ?? character).join("");
  }
  return `^(${normalized})`;
}

function normalizeExponentText(value: string): string {
  return normalizeMathMinus(value.trim().replaceAll(/[ \t\u00a0]+/g, " "));
}

function normalizeMathMinus(value: string): string {
  return value.replace(/^-(?=\s*[\p{L}\d])/u, "−").replace(/([=^(+\s])-(?=\s*[\p{L}\d])/gu, "$1−");
}

function findMatchingDelimiter(
  value: string,
  openingIndex: number,
  openingCharacter: string,
  closingCharacter: string,
): number | null {
  let depth = 0;
  for (let index = openingIndex; index < value.length; index += 1) {
    if (value[index] === openingCharacter) {
      depth += 1;
    } else if (value[index] === closingCharacter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function normalizeWhitespacePreservingProtectedRegions(value: string): string {
  const protectedRegions: { readonly placeholder: string; readonly text: string }[] = [];
  let masked = "";
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const protectedEnd = findProtectedRegionEnd(value, cursor);
    if (protectedEnd === null) {
      cursor += 1;
      continue;
    }

    let placeholder = `\uE000summary-protected-${protectedRegions.length}\uE001`;
    while (value.includes(placeholder)) {
      placeholder += "\uE002";
    }
    masked += value.slice(plainStart, cursor);
    masked += placeholder;
    protectedRegions.push({
      placeholder,
      text: value.slice(cursor, protectedEnd),
    });
    cursor = protectedEnd;
    plainStart = cursor;
  }

  let normalized = normalizeWhitespace(masked + value.slice(plainStart));
  for (const region of protectedRegions) {
    normalized = normalized.replaceAll(region.placeholder, region.text);
  }
  return normalized;
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
