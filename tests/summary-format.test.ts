import { describe, expect, it } from "vitest";
import { formatSummaryForDisplay } from "../src/summary/summary-format";
import { SUMMARY_SYSTEM_PROMPT } from "../src/summary/summary-prompt";

describe("formatSummaryForDisplay", () => {
  it("instructs Qwen to return readable plain text notation", () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain("concise plain text only");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Do not add a title, heading, or label");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Do not use Markdown markers");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("dollar-sign math");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("y′ = −2y");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("y(t) = c · e^(−2t)");
  });

  it.each([
    [
      String.raw`The solution is expressed as $ y(t) = c \\cdot e^{-2t}} $, where $ c $ is the initial constant.`,
      "The solution is expressed as y(t) = c · e^(−2t), where c is the initial constant.",
    ],
    [
      String.raw`It describes a first-order equation: $ y' = -2y $. The solution to this equation is $ y(t) = c \\cdot e^{-2t}} $, where $ c $ is the constant determined by the initial condition.`,
      "It describes a first-order equation: y′ = −2y. The solution to this equation is y(t) = c · e^(−2t), where c is the constant determined by the initial condition.",
    ],
  ])("formats Wayne's observed malformed summary %#", (raw, expected) => {
    expect(formatSummaryForDisplay(raw)).toEqual({
      text: expected,
      formattingApplied: true,
    });
  });

  it("leaves correct plain text unchanged", () => {
    const text = "The class reviewed a first-order equation and its initial condition.";
    expect(formatSummaryForDisplay(text)).toEqual({
      text,
      formattingApplied: false,
    });
  });

  it("leaves readable Unicode math unchanged", () => {
    const text = "The solution is y′ = −2y and y(t) = c · e^(−2t).";
    expect(formatSummaryForDisplay(text)).toEqual({
      text,
      formattingApplied: false,
    });
  });

  it("formats multiple equations and common safe math tokens", () => {
    const raw = String.raw`Solve $ x^2 = 4 $, then use $ y^\prime = -2y $ and $$ a \times b $$.`;
    expect(formatSummaryForDisplay(raw).text).toBe("Solve x² = 4, then use y′ = −2y and a × b.");
  });

  it("formats only explicit math spans when ordinary text contains LaTeX-like commands", () => {
    const raw = String.raw`Keep \times, \\times, \cdot, and \\cdot literal, but render $ a \times b $ and $ c \cdot d $.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`Keep \times, \\times, \cdot, and \\cdot literal, but render a × b and c · d.`,
    );
  });

  it.each([
    String.raw`C:\times\reports`,
    String.raw`C:\work\cdot\summary.txt`,
    String.raw`\\server\share\times\reports`,
    String.raw`\\server\cdot\summary.txt`,
    String.raw`/var/tmp/\times/reports`,
    String.raw`/opt/\cdot/summary.txt`,
  ])("preserves path-like text byte-for-byte: %s", (text) => {
    expect(formatSummaryForDisplay(text)).toEqual({
      text,
      formattingApplied: false,
    });
  });

  it("preserves quoted commands while formatting adjacent explicit math", () => {
    const raw = String.raw`The literal commands "\\times" and '\\cdot' stay quoted; $ a \times b $ does not.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`The literal commands "\\times" and '\\cdot' stay quoted; a × b does not.`,
    );
  });

  it("preserves inline and fenced code while formatting adjacent math", () => {
    const raw = [
      "Inline: `x  =  a \\times b`. Outside: $ x^{2t} $.",
      "```text",
      String.raw`  y'   = c \cdot e^{-2t}}  `,
      "```",
      "After: $ y' = -2y $.",
    ].join("\n");
    const expected = [
      "Inline: `x  =  a \\times b`. Outside: x^(2t).",
      "```text",
      String.raw`  y'   = c \cdot e^{-2t}}  `,
      "```",
      "After: y′ = −2y.",
    ].join("\n");
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it("formats digit-leading equations without treating standalone currency as math", () => {
    const raw = "Solve $2x = 4$, simplify $2x$, and keep the $5 fee.";
    expect(formatSummaryForDisplay(raw).text).toBe("Solve 2x = 4, simplify 2x, and keep the $5 fee.");
  });

  it("does not pair a currency dollar with a later math span", () => {
    const raw = "The fee is $5 and the result is $x^2$.";
    expect(formatSummaryForDisplay(raw).text).toBe("The fee is $5 and the result is x².");
  });

  it("removes unmatched math braces without changing ordinary prose braces", () => {
    const raw = "Keep {ordinary prose} intact, but fix $ x^{2}} + e^{-2t}} $.";
    expect(formatSummaryForDisplay(raw).text).toBe("Keep {ordinary prose} intact, but fix x² + e^(−2t).");
  });

  it("removes an extra closing parenthesis from a simple exponent", () => {
    const raw = "The solution is y(t) = c · e^(−2t)), where c is constant.";
    expect(formatSummaryForDisplay(raw).text).toBe(
      "The solution is y(t) = c · e^(−2t), where c is constant.",
    );
  });

  it.each([
    ["Use f(e^{-2t}).", "Use f(e^(−2t))."],
    ["The ambiguous prose form x^2t stays literal.", "The ambiguous prose form x^2t stays literal."],
    ["The set is {x^2}.", "The set is {x^2}."],
    ["The set is $ {x^2} $.", "The set is {x²}."],
  ])("preserves balanced outer math delimiters in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it.each([
    ["$ x^{2t} $", "x^(2t)"],
    ["$ x^2t $", "x^2t"],
    ["$ x^2 $", "x²"],
    ["$ x^t $", "x^t"],
    ["$ e^{-2t}} $", "e^(−2t)"],
  ])("preserves explicit exponent semantics in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it("does not invent grouping for an unbraced exponent inside an equation", () => {
    const raw = "Compare x^2t = 8 with $ x^{2t} = 8 $.";
    expect(formatSummaryForDisplay(raw).text).toBe("Compare x^2t = 8 with x^(2t) = 8.");
  });

  it("repairs only a simple extra exponent closer and preserves nested or unmatched braces", () => {
    const raw = "Fix $ e^{-2t}} $, preserve $ x^{2{t}} $, and preserve $ z^{2t $.";
    expect(formatSummaryForDisplay(raw).text).toBe("Fix e^(−2t), preserve x^{2{t}}, and preserve z^{2t.");
  });

  it("preserves empty exponent groups rather than inventing content", () => {
    expect(formatSummaryForDisplay("Keep $ x^{} $ and $ y^( ) $.").text).toBe("Keep x^{} and y^( ).");
  });

  it("formats bounded implicit equations without touching nearby literal commands", () => {
    const raw = String.raw`Keep \times literal. The solution y' = c \cdot e^{-2t}} is bounded.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`Keep \times literal. The solution y′ = c · e^(−2t) is bounded.`,
    );
  });

  it("does not treat paths next to an equation as part of the equation", () => {
    const raw = String.raw`Read C:\times\reports, then solve y' = -2y. Save to \\server\cdot\done.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`Read C:\times\reports, then solve y′ = −2y. Save to \\server\cdot\done.`,
    );
  });

  it("keeps literal commands and path operands outside the bounded equation span", () => {
    const raw = String.raw`Use \times literally before x = 2, and keep y = C:\cdot\reports unchanged.`;
    expect(formatSummaryForDisplay(raw).text).toBe(raw);
  });

  it("preserves currency dollar signs and non-math text", () => {
    const text = "The book costs $5, not $10, and the classroom budget is USD $20.";
    expect(formatSummaryForDisplay(text)).toEqual({
      text,
      formattingApplied: false,
    });
  });

  it("keeps script-like content as literal text while formatting adjacent math", () => {
    const raw = String.raw`<script>const  x = "a \times b";  const y = "e^{-2t}}";</script> $ y' = -2y $`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`<script>const  x = "a \times b";  const y = "e^{-2t}}";</script> y′ = −2y`,
    );
  });

  it("preserves HTML attribute literals while formatting math outside the tag", () => {
    const raw = String.raw`<span data-equation="x = a \times b">\cdot</span> $ a \times b $`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`<span data-equation="x = a \times b">\cdot</span> a × b`,
    );
  });

  it("normalizes pathological whitespace while preserving bullets and paragraphs", () => {
    const raw =
      "  Overview. \r\n\r\n\r\n  -   First   point \r\n - Second\tpoint \n\n\n Final   paragraph.  ";
    expect(formatSummaryForDisplay(raw).text).toBe(
      "Overview.\n\n- First point\n- Second point\n\nFinal paragraph.",
    );
  });

  it("preserves Unicode and bullet content while formatting only the math expression", () => {
    const raw = String.raw`• 已有 α = β
• Keep C:\times\报告
• Solve $ y' = -2y $`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`• 已有 α = β
• Keep C:\times\报告
• Solve y′ = −2y`,
    );
  });

  it("is idempotent across explicit, implicit, protected, and literal content", () => {
    const cases = [
      String.raw`The solution is $ y(t) = c \cdot e^{-2t}} $.`,
      String.raw`Read C:\times\reports, then solve y' = -2y.`,
      'Use "\\times", `x = a \\cdot b`, and $x^2t$.',
      '<script>const x = "e^{-2t}}";</script> $x^{2t}$',
      "• Unicode y′ = −2y\n\n• Plain prose",
    ];

    for (const raw of cases) {
      const once = formatSummaryForDisplay(raw).text;
      expect(formatSummaryForDisplay(once).text).toBe(once);
    }
  });
});
