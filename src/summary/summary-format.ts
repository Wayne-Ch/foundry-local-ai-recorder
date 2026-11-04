export interface SummaryDisplayFormatResult {
  readonly text: string;
  readonly formattingApplied: boolean;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface SummarySpan extends TextRange {
  readonly kind: "plain" | "protected";
}

interface SummaryMathSpan extends TextRange {
  readonly kind: "math";
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly trim: boolean;
}

type SummaryFormatSpan = SummarySpan | SummaryMathSpan;

interface HtmlTagToken {
  readonly name: string | null;
  readonly kind: "opening" | "closing" | "self-closing" | "declaration" | "malformed";
  readonly end: number;
}

interface ExponentReplacement {
  readonly end: number;
  readonly text: string;
}

type MathOpeningDelimiter = "{" | "(" | "[";

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
const htmlVoidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function formatSummaryForDisplay(rawText: string): SummaryDisplayFormatResult {
  const normalizedLineEndings = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const formattedMath = formatOutsideProtectedRegions(normalizedLineEndings);
  const text = normalizeWhitespacePreservingProtectedRegions(formattedMath);
  return {
    text,
    formattingApplied: text !== rawText,
  };
}

export function formatSummaryPresentation(rawText: string): SummaryDisplayFormatResult {
  const formatted = formatSummaryForDisplay(rawText);
  const text = structureSummaryContent(formatted.text);
  return {
    text,
    formattingApplied: formatted.formattingApplied || text !== formatted.text,
  };
}

function formatOutsideProtectedRegions(value: string): string {
  const delimiterStack: MathOpeningDelimiter[] = [];
  let output = "";
  let repairingMathAdjacentClosers = false;

  for (const span of tokenizeFormattingSpans(value)) {
    if (span.kind === "math") {
      const formatted = formatMathTokens(value.slice(span.contentStart, span.contentEnd));
      output += span.trim ? formatted.trim() : formatted;
      repairingMathAdjacentClosers = true;
      continue;
    }

    if (span.kind === "protected") {
      output += value.slice(span.start, span.end);
      repairingMathAdjacentClosers = false;
      continue;
    }

    for (let index = span.start; index < span.end; index += 1) {
      const character = value[index] ?? "";
      if (repairingMathAdjacentClosers && /\s/u.test(character)) {
        output += character;
        continue;
      }

      const opening = openingDelimiterFor(character);
      if (repairingMathAdjacentClosers && opening !== null && !isEscaped(value, index)) {
        if (delimiterStack.at(-1) === opening) {
          delimiterStack.pop();
          output += character;
        } else if (delimiterStack.includes(opening)) {
          output += character;
        }
        continue;
      }

      repairingMathAdjacentClosers = false;
      if (!isEscaped(value, index)) {
        if (isMathOpeningDelimiter(character)) {
          delimiterStack.push(character);
        } else if (opening !== null && delimiterStack.at(-1) === opening) {
          delimiterStack.pop();
        }
      }
      output += character;
    }
  }

  return output;
}

function tokenizeFormattingSpans(value: string): readonly SummaryFormatSpan[] {
  const spans: SummaryFormatSpan[] = [];
  for (const span of tokenizeProtectedRegions(value)) {
    if (span.kind === "protected") {
      spans.push(span);
      continue;
    }
    spans.push(...tokenizePlainFormattingSpans(value, span.start, span.end));
  }
  return spans;
}

function tokenizePlainFormattingSpans(
  value: string,
  start: number,
  end: number,
): readonly SummaryFormatSpan[] {
  const text = value.slice(start, end);
  const opaqueRanges = mergeRanges([...findCurrencyRanges(text), ...findPathRanges(text)]);
  const explicitMathRanges = findExplicitMathRanges(text, opaqueRanges);
  const fixedSpans: SummaryFormatSpan[] = [
    ...opaqueRanges.map(
      (range): SummarySpan => ({
        kind: "protected",
        start: range.start,
        end: range.end,
      }),
    ),
    ...explicitMathRanges,
  ].sort((left, right) => left.start - right.start || left.end - right.end);

  const spans: SummaryFormatSpan[] = [];
  let cursor = 0;
  for (const fixedSpan of fixedSpans) {
    appendImplicitFormattingSpans(text, cursor, fixedSpan.start, start, spans);
    spans.push(offsetFormattingSpan(fixedSpan, start));
    cursor = fixedSpan.end;
  }
  appendImplicitFormattingSpans(text, cursor, text.length, start, spans);
  return spans;
}

function findExplicitMathRanges(
  value: string,
  opaqueRanges: readonly TextRange[],
): readonly SummaryMathSpan[] {
  const ranges: SummaryMathSpan[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const opaque = rangeStartingAt(opaqueRanges, cursor);
    if (opaque !== null) {
      cursor = opaque.end;
      continue;
    }
    if (value[cursor] !== "$" || isEscaped(value, cursor)) {
      cursor += 1;
      continue;
    }

    const delimiterLength = value[cursor + 1] === "$" ? 2 : 1;
    if (!canOpenMathDelimiter(value, cursor, delimiterLength)) {
      cursor += delimiterLength;
      continue;
    }

    const closingIndex = findClosingDelimiter(value, cursor + delimiterLength, delimiterLength, opaqueRanges);
    if (closingIndex === -1) {
      cursor += delimiterLength;
      continue;
    }

    const contentStart = cursor + delimiterLength;
    if (!isValidDelimitedMath(value.slice(contentStart, closingIndex))) {
      cursor += delimiterLength;
      continue;
    }

    const end = closingIndex + delimiterLength;
    ranges.push({
      kind: "math",
      start: cursor,
      end,
      contentStart,
      contentEnd: closingIndex,
      trim: true,
    });
    cursor = end;
  }

  return ranges;
}

function appendImplicitFormattingSpans(
  value: string,
  start: number,
  end: number,
  offset: number,
  spans: SummaryFormatSpan[],
): void {
  if (start >= end) {
    return;
  }

  const text = value.slice(start, end);
  const mathRanges = mergeRanges([...findImplicitEquationRanges(text), ...findStructuredMathRanges(text)]);
  let cursor = 0;
  for (const range of mathRanges) {
    if (cursor < range.start) {
      spans.push({
        kind: "plain",
        start: offset + start + cursor,
        end: offset + start + range.start,
      });
    }
    spans.push({
      kind: "math",
      start: offset + start + range.start,
      end: offset + start + range.end,
      contentStart: offset + start + range.start,
      contentEnd: offset + start + range.end,
      trim: false,
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    spans.push({
      kind: "plain",
      start: offset + start + cursor,
      end: offset + end,
    });
  }
}

function offsetFormattingSpan(span: SummaryFormatSpan, offset: number): SummaryFormatSpan {
  if (span.kind !== "math") {
    return {
      kind: span.kind,
      start: span.start + offset,
      end: span.end + offset,
    };
  }
  return {
    kind: "math",
    start: span.start + offset,
    end: span.end + offset,
    contentStart: span.contentStart + offset,
    contentEnd: span.contentEnd + offset,
    trim: span.trim,
  };
}

function tokenizeProtectedRegions(value: string): readonly SummarySpan[] {
  const spans: SummarySpan[] = [];
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const protectedEnd = findProtectedRegionEnd(value, cursor);
    if (protectedEnd === null) {
      cursor += 1;
      continue;
    }

    if (plainStart < cursor) {
      spans.push({ kind: "plain", start: plainStart, end: cursor });
    }
    spans.push({ kind: "protected", start: cursor, end: protectedEnd });
    cursor = protectedEnd;
    plainStart = cursor;
  }

  if (plainStart < value.length) {
    spans.push({ kind: "plain", start: plainStart, end: value.length });
  }
  return spans;
}

function findProtectedRegionEnd(value: string, index: number): number | null {
  const character = value[index];
  if (character === "`") {
    return findCodeDelimiterEnd(value, index, "`", false);
  }
  if (character === "~" && isLinePrefixWhitespace(value, index)) {
    return findCodeDelimiterEnd(value, index, "~", true);
  }
  if (character === '"' || character === "'" || character === "“" || character === "‘") {
    return findQuotedRegionEnd(value, index);
  }
  if (character !== "<") {
    return null;
  }
  if (value.startsWith("<!--", index)) {
    const end = value.indexOf("-->", index + 4);
    return end === -1 ? value.length : end + 3;
  }
  const tag = readHtmlTag(value, index);
  if (tag === null) {
    return null;
  }
  if (tag.kind !== "opening" || tag.name === null) {
    return tag.end;
  }
  return findHtmlElementEnd(value, tag);
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

function readHtmlTag(value: string, index: number): HtmlTagToken | null {
  if (value[index] !== "<") {
    return null;
  }

  let cursor = index + 1;
  while (/[ \t\r\n]/.test(value[cursor] ?? "")) {
    cursor += 1;
  }

  if (value[cursor] === "!" || value[cursor] === "?") {
    const end = findHtmlTagEnd(value, index);
    return {
      name: null,
      kind: end === null ? "malformed" : "declaration",
      end: end ?? value.length,
    };
  }

  let closing = false;
  if (value[cursor] === "/") {
    closing = true;
    cursor += 1;
    while (/[ \t\r\n]/.test(value[cursor] ?? "")) {
      cursor += 1;
    }
  }

  if (!isHtmlNameStart(value[cursor])) {
    return null;
  }
  const nameStart = cursor;
  cursor += 1;
  while (isHtmlNameCharacter(value[cursor])) {
    cursor += 1;
  }
  const name = value.slice(nameStart, cursor);
  const end = findHtmlTagEnd(value, index);
  if (end === null) {
    return { name, kind: "malformed", end: value.length };
  }

  let suffix = end - 2;
  while (suffix > index && /[ \t\r\n]/.test(value[suffix] ?? "")) {
    suffix -= 1;
  }
  return {
    name,
    kind: closing
      ? "closing"
      : value[suffix] === "/" || htmlVoidElements.has(name.toLowerCase())
        ? "self-closing"
        : "opening",
    end,
  };
}

function isHtmlNameStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isHtmlNameCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9:._-]/.test(character);
}

function findHtmlElementEnd(value: string, opening: HtmlTagToken): number {
  const openingName = opening.name?.toLowerCase();
  if (openingName === undefined) {
    return opening.end;
  }
  if (
    openingName === "script" ||
    openingName === "style" ||
    openingName === "code" ||
    openingName === "pre"
  ) {
    return findRawTextElementEnd(value, opening.end, openingName);
  }

  const stack = [openingName];
  let cursor = opening.end;
  while (cursor < value.length) {
    const nextTagStart = value.indexOf("<", cursor);
    if (nextTagStart === -1) {
      return value.length;
    }
    if (value.startsWith("<!--", nextTagStart)) {
      const commentEnd = value.indexOf("-->", nextTagStart + 4);
      if (commentEnd === -1) {
        return value.length;
      }
      cursor = commentEnd + 3;
      continue;
    }

    const tag = readHtmlTag(value, nextTagStart);
    if (tag === null) {
      cursor = nextTagStart + 1;
      continue;
    }
    if (tag.kind === "malformed") {
      return value.length;
    }
    if (tag.kind === "opening" && tag.name !== null) {
      stack.push(tag.name.toLowerCase());
    } else if (tag.kind === "closing" && tag.name !== null) {
      const closingName = tag.name.toLowerCase();
      if (stack.at(-1) !== closingName) {
        return value.length;
      }
      stack.pop();
      if (stack.length === 0) {
        return tag.end;
      }
    }
    cursor = tag.end;
  }
  return value.length;
}

function findRawTextElementEnd(value: string, start: number, name: string): number {
  const lowerValue = value.toLowerCase();
  let cursor = start;
  while (cursor < value.length) {
    const closingStart = lowerValue.indexOf(`</${name}`, cursor);
    if (closingStart === -1) {
      return value.length;
    }
    const closing = readHtmlTag(value, closingStart);
    if (closing?.kind === "closing" && closing.name?.toLowerCase() === name) {
      return closing.end;
    }
    cursor = closingStart + 2;
  }
  return value.length;
}

function findCurrencyRanges(value: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$" || value[index + 1] === "$" || isEscaped(value, index)) {
      continue;
    }
    const amountEnd = consumeCurrencyAmount(value, index + 1);
    if (amountEnd === null) {
      continue;
    }

    const closing = findFirstInlineClosing(value, amountEnd);
    if (closing !== -1 && isCompleteDelimitedMath(value.slice(index + 1, closing))) {
      continue;
    }
    ranges.push({ start: index, end: amountEnd });
    index = amountEnd - 1;
  }
  return ranges;
}

function findPathRanges(value: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!isPathStartBoundary(value, index)) {
      continue;
    }
    const end = findPathEnd(value, index);
    if (end === null) {
      continue;
    }
    ranges.push({ start: index, end });
    index = end - 1;
  }
  return ranges;
}

function isPathStartBoundary(value: string, index: number): boolean {
  const previous = value[index - 1];
  return previous === undefined || /[\s([{:;,=]/u.test(previous);
}

function findPathEnd(value: string, index: number): number | null {
  let cursor: number;
  if (
    /[A-Za-z]/.test(value[index] ?? "") &&
    value[index + 1] === ":" &&
    (value[index + 2] === "\\" || value[index + 2] === "/")
  ) {
    cursor = index + 3;
  } else if (value.startsWith("\\\\", index)) {
    cursor = index + 2;
    const serverStart = cursor;
    while (cursor < value.length && value[cursor] !== "\\" && value[cursor] !== "/") {
      if (isPathTerminator(value[cursor])) {
        return null;
      }
      cursor += 1;
    }
    if (cursor === serverStart || (value[cursor] !== "\\" && value[cursor] !== "/")) {
      return null;
    }
    cursor += 1;
  } else if (value[index] === "/") {
    const nextSeparator = value.indexOf("/", index + 1);
    if (
      nextSeparator === -1 ||
      nextSeparator === index + 1 ||
      value
        .slice(index + 1, nextSeparator)
        .split("")
        .some(isPathTerminator)
    ) {
      return null;
    }
    cursor = index + 1;
  } else {
    return null;
  }

  while (cursor < value.length && !isPathTerminator(value[cursor])) {
    cursor += 1;
  }
  while (cursor > index && /[.,;:!?)}\]]/u.test(value[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  return cursor > index ? cursor : null;
}

function isPathTerminator(character: string | undefined): boolean {
  return character === undefined || /[\s<>"'`]/u.test(character);
}

function consumeCurrencyAmount(value: string, start: number): number | null {
  if (!/\d/.test(value[start] ?? "")) {
    return null;
  }

  let cursor = start;
  while (/\d/.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  while ((value[cursor] === "," || value[cursor] === ".") && /\d/.test(value[cursor + 1] ?? "")) {
    cursor += 1;
    while (/\d/.test(value[cursor] ?? "")) {
      cursor += 1;
    }
  }
  return cursor;
}

function findFirstInlineClosing(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (
      value[index] === "$" &&
      value[index + 1] !== "$" &&
      !isEscaped(value, index) &&
      canCloseMathDelimiter(value, index, 1)
    ) {
      return index;
    }
  }
  return -1;
}

function rangeStartingAt(ranges: readonly TextRange[], index: number): TextRange | null {
  return ranges.find((range) => range.start === index) ?? null;
}

function canOpenMathDelimiter(value: string, index: number, delimiterLength: number): boolean {
  const next = value[index + delimiterLength];
  return next !== undefined && next !== "\r" && next !== "\n" && next !== "$";
}

function canCloseMathDelimiter(value: string, index: number, delimiterLength: number): boolean {
  const next = value[index + delimiterLength];
  return next === undefined || /[\s.,;:!?)}\]>'"]/u.test(next);
}

function findClosingDelimiter(
  value: string,
  start: number,
  delimiterLength: number,
  opaqueRanges: readonly TextRange[],
): number {
  const delimiter = "$".repeat(delimiterLength);
  for (let index = start; index <= value.length - delimiterLength; index += 1) {
    const opaque = rangeStartingAt(opaqueRanges, index);
    if (opaque !== null) {
      return -1;
    }
    if (!value.startsWith(delimiter, index) || isEscaped(value, index)) {
      continue;
    }
    if (delimiterLength === 1 && value[index + 1] === "$") {
      return -1;
    }
    if (canCloseMathDelimiter(value, index, delimiterLength)) {
      return index;
    }
    return -1;
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

function isValidDelimitedMath(value: string): boolean {
  const unwrapped = prepareDelimitedMathForValidation(value);
  if (unwrapped === null) {
    return false;
  }
  if (isCompleteMathExpression(unwrapped) || isCompleteEquation(unwrapped)) {
    return true;
  }
  return looksLikeMath(unwrapped);
}

function isCompleteDelimitedMath(value: string): boolean {
  const unwrapped = prepareDelimitedMathForValidation(value);
  return unwrapped !== null && (isCompleteMathExpression(unwrapped) || isCompleteEquation(unwrapped));
}

function prepareDelimitedMathForValidation(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || containsUnescapedDollar(trimmed)) {
    return null;
  }

  const repaired = repairUnmatchedMathClosers(trimmed);
  const unwrapped = unwrapBalancedMathGroups(repaired);
  if (!unwrapped || containsProseWord(unwrapped)) {
    return null;
  }
  return unwrapped;
}

function containsUnescapedDollar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "$" && !isEscaped(value, index)) {
      return true;
    }
  }
  return false;
}

function unwrapBalancedMathGroups(value: string): string {
  let unwrapped = value.trim();
  while (unwrapped.length >= 2) {
    const opening = unwrapped[0] as MathOpeningDelimiter;
    const closing = closingDelimiterFor(opening);
    if (closing === null) {
      break;
    }
    const closingIndex = findMatchingDelimiter(unwrapped, 0, opening, closing);
    if (closingIndex !== unwrapped.length - 1) {
      break;
    }
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  return unwrapped;
}

function containsProseWord(value: string): boolean {
  const mathWords = new Set(["cos", "exp", "ln", "log", "sin", "sqrt", "tan"]);
  for (const match of value.matchAll(/\p{L}+/gu)) {
    const word = match[0];
    if (Array.from(word).length <= 1 || mathWords.has(word.toLowerCase())) {
      continue;
    }
    const start = match.index;
    if (start > 0 && value[start - 1] === "\\") {
      continue;
    }
    return true;
  }
  return false;
}

function isCompleteMathExpression(value: string): boolean {
  const start = skipHorizontalWhitespace(value, 0);
  const end = consumeMathExpression(value, start);
  return end !== null && skipHorizontalWhitespace(value, end) === value.length;
}

function isCompleteEquation(value: string): boolean {
  let equalsIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "=" || isComparisonOperator(value, index)) {
      continue;
    }
    if (equalsIndex !== -1) {
      return false;
    }
    equalsIndex = index;
  }
  if (equalsIndex === -1) {
    return false;
  }

  const left = value.slice(0, equalsIndex).trim();
  const right = value.slice(equalsIndex + 1).trim();
  return Boolean(left && right && isCompleteMathExpression(left) && isCompleteMathExpression(right));
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
    return closing + 1;
  }
  if (value[cursor] === "(") {
    const closing = findMatchingDelimiter(value, cursor, "(", ")");
    if (closing === null) {
      return factorEnd;
    }
    return closing + 1;
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
        ranges.push({ start: index, end: closing + 1 });
      }
      continue;
    }
    if (value[exponentStart] === "(") {
      const closing = findMatchingDelimiter(value, exponentStart, "(", ")");
      if (closing !== null) {
        ranges.push({ start: index, end: closing + 1 });
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
  const prepared = repairUnmatchedMathClosers(value)
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
    return { text: formatted, end: closing + 1 };
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
    return { text: `^(${normalized})`, end: closing + 1 };
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

function repairUnmatchedMathClosers(value: string): string {
  const stack: MathOpeningDelimiter[] = [];
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (isMathOpeningDelimiter(character) && !isEscaped(value, index)) {
      stack.push(character);
      output += character;
      continue;
    }

    const opening = openingDelimiterFor(character);
    if (opening === null || isEscaped(value, index)) {
      output += character;
      continue;
    }

    if (stack.at(-1) === opening) {
      stack.pop();
      output += character;
      continue;
    }

    if (stack.includes(opening)) {
      output += character;
    }
  }
  return output;
}

function isMathOpeningDelimiter(character: string): character is MathOpeningDelimiter {
  return character === "{" || character === "(" || character === "[";
}

function openingDelimiterFor(character: string): MathOpeningDelimiter | null {
  return character === "}" ? "{" : character === ")" ? "(" : character === "]" ? "[" : null;
}

function closingDelimiterFor(opening: MathOpeningDelimiter): string | null {
  return opening === "{" ? "}" : opening === "(" ? ")" : opening === "[" ? "]" : null;
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
  for (const span of tokenizeProtectedRegions(value)) {
    const text = value.slice(span.start, span.end);
    if (span.kind === "plain") {
      masked += text;
      continue;
    }
    let placeholder = `\uE000summary-protected-${protectedRegions.length}\uE001`;
    while (value.includes(placeholder)) {
      placeholder += "\uE002";
    }
    masked += placeholder;
    protectedRegions.push({
      placeholder,
      text,
    });
  }

  let normalized = normalizeWhitespace(masked);
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

const SUMMARY_MAX_BULLET_LINES = 6;
const SUMMARY_LIST_MARKER = /^(?:•\s+|[-*]\s+(?=[\p{Lu}"'“‘`])|\d+[.)]\s+)/u;
const SUMMARY_SENTENCE_ABBREVIATIONS = new Set([
  "dr",
  "e.g",
  "etc",
  "i.e",
  "mr",
  "mrs",
  "ms",
  "prof",
  "sr",
  "st",
  "vs",
]);

function structureSummaryContent(value: string): string {
  const protectedContent = maskSummaryStructureRegions(value);
  const lines = protectedContent.masked
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const units: string[] = [];

  for (const line of lines) {
    const content = line.replace(SUMMARY_LIST_MARKER, "").trim();
    if (!content) {
      continue;
    }
    const sentences = splitCompleteSummarySentences(content);
    if (sentences === null) {
      if (lines.length === 1) {
        return value;
      }
      units.push(content);
    } else {
      const onlySentence = sentences.length === 1 ? sentences[0] : undefined;
      units.push(...(onlySentence === undefined ? sentences : splitCompleteSummaryClauses(onlySentence)));
    }
  }

  if (units.length < 2) {
    return value;
  }

  const restored = units.map(protectedContent.restore);
  const [overview, ...details] = restored;
  if (overview === undefined || details.length === 0) {
    return value;
  }
  const bullets = groupSummaryUnits(details, SUMMARY_MAX_BULLET_LINES);
  const structured = [overview, ...bullets.map((bullet) => `• ${bullet}`)].join("\n");
  return canonicalSummaryContent(structured) === canonicalSummaryContent(value) ? structured : value;
}

function maskSummaryStructureRegions(value: string): {
  readonly masked: string;
  readonly restore: (value: string) => string;
} {
  const regions: { readonly placeholder: string; readonly text: string }[] = [];
  let masked = "";
  for (const span of tokenizeProtectedRegions(value)) {
    const text = value.slice(span.start, span.end);
    if (span.kind === "plain") {
      masked += text;
      continue;
    }
    let placeholder = `\uE100summary-structure-${regions.length}\uE101`;
    while (value.includes(placeholder)) {
      placeholder += "\uE102";
    }
    masked += placeholder;
    regions.push({ placeholder, text });
  }
  return {
    masked,
    restore: (candidate) => {
      let restored = candidate;
      for (const region of regions) {
        restored = restored.replaceAll(region.placeholder, region.text);
      }
      return restored;
    },
  };
}

function splitCompleteSummarySentences(value: string): readonly string[] | null {
  const sentences: string[] = [];
  let start = 0;
  let index = 0;

  while (index < value.length) {
    const character = value[index] ?? "";
    if (!/[.!?]/u.test(character) || isSummaryNonTerminalPeriod(value, index)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (/["'”’)\]}]/u.test(value[end] ?? "")) {
      end += 1;
    }
    const atEnd = end === value.length;
    const whitespace = value.slice(end).match(/^\s+/u)?.[0] ?? "";
    const next = value[end + whitespace.length];
    if (!atEnd && (!whitespace || next === undefined || !/[\p{Lu}\p{N}\uE100]/u.test(next))) {
      index = end;
      continue;
    }

    const sentence = value.slice(start, end).trim();
    if (!sentence) {
      return null;
    }
    sentences.push(sentence);
    start = end + whitespace.length;
    index = start;
  }

  const tail = value.slice(start).trim();
  if (tail) {
    return null;
  }
  return sentences.length === 0 ? null : sentences;
}

function isSummaryNonTerminalPeriod(value: string, index: number): boolean {
  if (value[index] !== ".") {
    return false;
  }
  if (/\d/u.test(value[index - 1] ?? "") && /\d/u.test(value[index + 1] ?? "")) {
    return true;
  }
  const prefix = value.slice(0, index + 1);
  const abbreviation = prefix.match(/(?:^|\s)([A-Za-z](?:[A-Za-z.]*)?)\.$/u)?.[1];
  return (
    abbreviation !== undefined &&
    (SUMMARY_SENTENCE_ABBREVIATIONS.has(abbreviation.toLowerCase()) ||
      /^[A-Z]$/u.test(abbreviation) ||
      /^(?:[A-Z]\.)+[A-Z]$/u.test(abbreviation))
  );
}

function splitCompleteSummaryClauses(value: string): readonly string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ";") {
      continue;
    }
    const whitespace = value.slice(index + 1).match(/^\s+/u)?.[0] ?? "";
    const next = value[index + 1 + whitespace.length];
    if (!whitespace || next === undefined || !/[\p{Lu}\p{N}\uE100]/u.test(next)) {
      continue;
    }
    const clause = value.slice(start, index + 1).trim();
    if (!clause) {
      return [value];
    }
    clauses.push(clause);
    start = index + 1 + whitespace.length;
    index = start - 1;
  }
  const tail = value.slice(start).trim();
  if (!tail || clauses.length === 0) {
    return [value];
  }
  clauses.push(tail);
  return clauses;
}

function groupSummaryUnits(units: readonly string[], maximumGroups: number): readonly string[] {
  if (units.length <= maximumGroups) {
    return units;
  }
  const groups: string[] = [];
  let cursor = 0;
  for (let remainingGroups = maximumGroups; remainingGroups > 0; remainingGroups -= 1) {
    const remainingUnits = units.length - cursor;
    const size = Math.ceil(remainingUnits / remainingGroups);
    groups.push(units.slice(cursor, cursor + size).join(" "));
    cursor += size;
  }
  return groups;
}

function canonicalSummaryContent(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim().replace(SUMMARY_LIST_MARKER, ""))
    .filter(Boolean)
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}
