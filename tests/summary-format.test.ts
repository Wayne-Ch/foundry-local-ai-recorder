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

  it("formats digit-leading equations without treating standalone currency as math", () => {
    const raw = "Solve $2x = 4$, simplify $2x$, and keep the $5 fee.";
    expect(formatSummaryForDisplay(raw).text).toBe("Solve 2x = 4, simplify 2x, and keep the $5 fee.");
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
    ["The set is {x^2}.", "The set is {x²}."],
    ["The set is $ {x^2} $.", "The set is {x²}."],
  ])("preserves balanced outer math delimiters in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it("preserves currency dollar signs and non-math text", () => {
    const text = "The book costs $5, not $10, and the classroom budget is USD $20.";
    expect(formatSummaryForDisplay(text)).toEqual({
      text,
      formattingApplied: false,
    });
  });

  it("keeps script-like content as literal text while formatting adjacent math", () => {
    const raw = `<script>alert("summary")</script> $ y' = -2y $`;
    expect(formatSummaryForDisplay(raw).text).toBe('<script>alert("summary")</script> y′ = −2y');
  });

  it("normalizes pathological whitespace while preserving bullets and paragraphs", () => {
    const raw =
      "  Overview. \r\n\r\n\r\n  -   First   point \r\n - Second\tpoint \n\n\n Final   paragraph.  ";
    expect(formatSummaryForDisplay(raw).text).toBe(
      "Overview.\n\n- First point\n- Second point\n\nFinal paragraph.",
    );
  });
});
