import { describe, expect, it } from "vitest";
import { parseAssistantTextSegments } from "../src/renderer/assistant-math";

describe("assistant math parsing", () => {
  it("extracts inline and display math while preserving prose and line breaks", () => {
    expect(
      parseAssistantTextSegments("Decay follows $y(t) = y_0 e^{-2t}$.\nThen:\n$$y'(t) = -2y(t)$$"),
    ).toEqual([
      { kind: "text", value: "Decay follows " },
      {
        kind: "math",
        value: "y(t) = y_0 e^{-2t}",
        source: "$y(t) = y_0 e^{-2t}$",
        displayMode: false,
      },
      { kind: "text", value: ".\nThen:\n" },
      {
        kind: "math",
        value: "y'(t) = -2y(t)",
        source: "$$y'(t) = -2y(t)$$",
        displayMode: true,
      },
    ]);
  });

  it("supports parenthesized delimiters without treating markup as HTML", () => {
    expect(parseAssistantTextSegments("<img src=x onerror=alert(1)> \\(x^2\\)")).toEqual([
      { kind: "text", value: "<img src=x onerror=alert(1)> " },
      {
        kind: "math",
        value: "x^2",
        source: "\\(x^2\\)",
        displayMode: false,
      },
    ]);
  });

  it("leaves currency, escaped, unmatched, and multiline inline dollars as ordinary text", () => {
    const text = "It costs $5.00 or $10 today. Keep \\$literal and $x\n+y$ unchanged.";

    expect(parseAssistantTextSegments(text)).toEqual([{ kind: "text", value: text }]);
  });

  it("does not let currency swallow a later valid math expression", () => {
    expect(parseAssistantTextSegments("Save $5, then solve $x + 1$ today.")).toEqual([
      { kind: "text", value: "Save $5, then solve " },
      {
        kind: "math",
        value: "x + 1",
        source: "$x + 1$",
        displayMode: false,
      },
      { kind: "text", value: " today." },
    ]);
  });

  it("keeps empty and unmatched supported delimiters literal", () => {
    const text = "Empty $$ stays; unmatched \\(x + 1 stays.";

    expect(parseAssistantTextSegments(text)).toEqual([{ kind: "text", value: text }]);
  });
});
