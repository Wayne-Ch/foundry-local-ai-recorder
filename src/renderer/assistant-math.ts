import katex from "katex";

export type AssistantTextSegment =
  | {
      readonly kind: "text";
      readonly value: string;
    }
  | {
      readonly kind: "math";
      readonly value: string;
      readonly source: string;
      readonly displayMode: boolean;
    };

interface MathDelimiter {
  readonly open: string;
  readonly close: string;
  readonly displayMode: boolean;
  readonly allowNewlines: boolean;
  readonly inlineDollar: boolean;
}

const MATH_DELIMITERS: readonly MathDelimiter[] = [
  {
    open: "$$",
    close: "$$",
    displayMode: true,
    allowNewlines: true,
    inlineDollar: false,
  },
  {
    open: "\\[",
    close: "\\]",
    displayMode: true,
    allowNewlines: true,
    inlineDollar: false,
  },
  {
    open: "\\(",
    close: "\\)",
    displayMode: false,
    allowNewlines: false,
    inlineDollar: false,
  },
  {
    open: "$",
    close: "$",
    displayMode: false,
    allowNewlines: false,
    inlineDollar: true,
  },
];

export function parseAssistantTextSegments(text: string): readonly AssistantTextSegment[] {
  const segments: AssistantTextSegment[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const delimiter = openingDelimiterAt(text, cursor);
    if (delimiter === null) {
      cursor += 1;
      continue;
    }

    const expressionStart = cursor + delimiter.open.length;
    const expressionEnd = findClosingDelimiter(text, expressionStart, delimiter);
    if (expressionEnd < 0) {
      cursor += delimiter.open.length;
      continue;
    }

    const expression = text.slice(expressionStart, expressionEnd).trim();
    if (!expression) {
      cursor += delimiter.open.length;
      continue;
    }

    if (textStart < cursor) {
      segments.push({ kind: "text", value: text.slice(textStart, cursor) });
    }
    const segmentEnd = expressionEnd + delimiter.close.length;
    segments.push({
      kind: "math",
      value: expression,
      source: text.slice(cursor, segmentEnd),
      displayMode: delimiter.displayMode,
    });
    cursor = segmentEnd;
    textStart = segmentEnd;
  }

  if (textStart < text.length) {
    segments.push({ kind: "text", value: text.slice(textStart) });
  }

  return segments;
}

export function renderAssistantMessageText(text: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "assistant-message-text";

  for (const segment of parseAssistantTextSegments(text)) {
    if (segment.kind === "text") {
      container.append(document.createTextNode(segment.value));
      continue;
    }

    const math = document.createElement(segment.displayMode ? "div" : "span");
    math.className = segment.displayMode
      ? "assistant-math assistant-math-display"
      : "assistant-math assistant-math-inline";
    try {
      katex.render(segment.value, math, {
        displayMode: segment.displayMode,
        output: "htmlAndMathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1_000,
        maxSize: 10,
      });
      container.append(math);
    } catch {
      container.append(document.createTextNode(segment.source));
    }
  }

  return container;
}

function openingDelimiterAt(text: string, index: number): MathDelimiter | null {
  if (isEscaped(text, index)) {
    return null;
  }
  for (const delimiter of MATH_DELIMITERS) {
    if (!text.startsWith(delimiter.open, index)) {
      continue;
    }
    if (
      delimiter.inlineDollar &&
      (isWhitespace(text[index + delimiter.open.length]) || text[index + delimiter.open.length] === "$")
    ) {
      return null;
    }
    return delimiter;
  }
  return null;
}

function findClosingDelimiter(text: string, expressionStart: number, delimiter: MathDelimiter): number {
  for (let index = expressionStart; index <= text.length - delimiter.close.length; index += 1) {
    if (!delimiter.allowNewlines && text[index] === "\n") {
      return -1;
    }
    if (!text.startsWith(delimiter.close, index) || isEscaped(text, index)) {
      continue;
    }
    if (!delimiter.inlineDollar) {
      return index;
    }
    if (text[index + 1] === "$") {
      return -1;
    }
    const previous = text[index - 1];
    const next = text[index + 1];
    if (isWhitespace(previous) || isAsciiDigit(next)) {
      return -1;
    }
    return index;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value);
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}
