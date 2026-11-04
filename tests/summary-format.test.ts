import { describe, expect, it } from "vitest";
import { formatSummaryForDisplay, formatSummaryPresentation } from "../src/summary/summary-format";
import { SUMMARY_SYSTEM_PROMPT } from "../src/summary/summary-prompt";

describe("formatSummaryForDisplay", () => {
  it("instructs Qwen to return readable plain text notation", () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Faithfulness is more important than style");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Copy every name, project, named concept");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Preserve every stated equation");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("resolved constant");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("explicit cause/result");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Do not write a title, heading, label");
    expect(SUMMARY_SYSTEM_PROMPT).toContain("Use readable Unicode/plain math");
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

  describe("formatSummaryPresentation", () => {
    const fixtures = [
      {
        name: "ODE",
        raw: "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.",
        expected: [
          "An ordinary differential equation relates a function to its derivatives.",
          "• For the first order equation y prime equals negative two y, separate the variables.",
          "• The solution is y of t equals c times e to the negative two t for decay over time.",
          "• If y of 0 equals 3, then c equals 3.",
        ].join("\n"),
      },
      {
        name: "Project Atlas",
        raw: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. Maya Chen owns the follow-up, and the next review is November 12.",
        expected: [
          "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache.",
          "• The target remains 250 milliseconds.",
          "• Maya Chen owns the follow-up, and the next review is November 12.",
        ].join("\n"),
      },
      {
        name: "Team Aurora",
        raw: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5.",
        expected: [
          "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius.",
          "• After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging.",
          "• Priya will rerun the test at 0.5 C on December 5.",
        ].join("\n"),
      },
    ] as const;

    it.each(fixtures)(
      "structures the $name fixture without losing or duplicating content",
      ({ raw, expected }) => {
        const formatted = formatSummaryPresentation(raw);

        expect(formatted).toEqual({ text: expected, formattingApplied: true });
        expect(contentWords(formatted.text)).toEqual(contentWords(raw));
        expect(formatSummaryPresentation(formatted.text).text).toBe(formatted.text);
      },
    );

    it("normalizes math once while preserving protected code and sentence content", () => {
      const raw =
        "Dr. Rivera kept `v1.2.3 stays literal`. The model uses $ y' = -2y $. Save C:\\work\\summary.txt.";
      const expected = [
        "Dr. Rivera kept `v1.2.3 stays literal`.",
        "• The model uses y′ = −2y.",
        "• Save C:\\work\\summary.txt.",
      ].join("\n");

      expect(formatSummaryPresentation(raw).text).toBe(expected);
      expect(formatSummaryPresentation(expected).text).toBe(expected);
    });

    it("keeps a factual paragraph when it cannot identify multiple complete safe units", () => {
      const paragraph = "Project Atlas remains at 280 milliseconds without final punctuation";

      expect(formatSummaryPresentation(paragraph)).toEqual({
        text: paragraph,
        formattingApplied: false,
      });
    });

    it("splits complete semicolon clauses without changing their text", () => {
      const raw =
        "Project Atlas improved latency; Maya Chen owns the follow-up; The next review is November 12.";
      const expected = [
        "Project Atlas improved latency;",
        "• Maya Chen owns the follow-up;",
        "• The next review is November 12.",
      ].join("\n");

      expect(formatSummaryPresentation(raw).text).toBe(expected);
      expect(contentWords(expected)).toEqual(contentWords(raw));
    });

    it("converts existing list structure without changing its content", () => {
      const raw = ["- First exact fact.", "- Second exact fact.", "- Third exact fact."].join("\n");
      const expected = ["First exact fact.", "• Second exact fact.", "• Third exact fact."].join("\n");

      expect(formatSummaryPresentation(raw).text).toBe(expected);
      expect(contentWords(expected)).toEqual(contentWords(raw));
    });

    it("groups long outputs into at most six bullets without sentence loss or duplication", () => {
      const raw = Array.from({ length: 10 }, (_value, index) => `Sentence ${index + 1}.`).join(" ");
      const formatted = formatSummaryPresentation(raw).text;
      const lines = formatted.split("\n");

      expect(lines).toHaveLength(7);
      expect(lines.slice(1).every((line) => line.startsWith("• "))).toBe(true);
      expect(contentWords(formatted)).toEqual(contentWords(raw));
      expect(formatSummaryPresentation(formatted).text).toBe(formatted);
    });
  });

  function contentWords(value: string): readonly string[] {
    return value
      .replaceAll(/^(?:•|-)\s+/gmu, "")
      .split(/\s+/u)
      .filter(Boolean);
  }

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

  it.each(["Keep $ x + /a/b $ literal.", "Keep $ x + $5 fee $ literal."])(
    "does not scan explicit math delimiters across protected path or currency tokens in %s",
    (text) => {
      expect(formatSummaryForDisplay(text)).toEqual({
        text,
        formattingApplied: false,
      });
    },
  );

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

  it.each([
    ["The fee is $5 and the result is $ x^2 $.", "The fee is $5 and the result is x²."],
    ["Keep $5 + tax literal, then solve $ x^2 $ and $y^2$.", "Keep $5 + tax literal, then solve x² and y²."],
    [
      "Prices are $5, $10.50, and $1,200.00; solve $2x = 4$ and $ y' = -2y $.",
      "Prices are $5, $10.50, and $1,200.00; solve 2x = 4 and y′ = −2y.",
    ],
  ])("keeps currency tokens independent from later math delimiters in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it("supports tight, spaced, and display math without consuming escaped or unmatched dollars", () => {
    const raw = String.raw`Escaped \$x\$ and \$5 stay literal; solve $x^2$, $ y' = -2y $, and $$ a \times b $$. Unmatched $ stays.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`Escaped \$x\$ and \$5 stay literal; solve x², y′ = −2y, and a × b. Unmatched $ stays.`,
    );
  });

  it("treats a digit-leading delimited expression as math only when the full pair is valid", () => {
    expect(formatSummaryForDisplay("$5 + 2$ versus $5 + tax").text).toBe("5 + 2 versus $5 + tax");
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
    ["$ {e^{-2t}} $", "{e^(−2t)}"],
    ["$ ({e^{-2t}}) $", "({e^(−2t)})"],
    ["Use f(e^(−2t)).", "Use f(e^(−2t))."],
    ["Use f(e^{-2t}}).", "Use f(e^(−2t))."],
    ["$ e^{-2t}} $", "e^(−2t)"],
  ])("removes only closers proven unmatched inside a math token in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it.each([
    ['The pair ("rate", e^{-2t}) is used.', 'The pair ("rate", e^(−2t)) is used.'],
    ['The pair ("rate)", e^{-2t}) is used.', 'The pair ("rate)", e^(−2t)) is used.'],
    ["The pair (`rate)`, e^{-2t}) is used.", "The pair (`rate)`, e^(−2t)) is used."],
    [
      "<section><code>rate)</code></section>",
      "The pair (<section><code>rate)</code></section>, e^(−2t)) is used.",
    ],
    ['The pair (\n"rate)",\ne^{-2t}) is used.', 'The pair (\n"rate)",\ne^(−2t)) is used.'],
  ])("carries outer delimiter context across protected content in %s", (rawOrProtected, expected) => {
    const raw = rawOrProtected.startsWith("<")
      ? `The pair (${rawOrProtected}, e^{-2t}) is used.`
      : rawOrProtected;
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it.each([
    ["$ x^{2t} $}", "x^(2t)"],
    ["$ {e^{-2t}} $}", "{e^(−2t)}"],
    ["($ x^{2t} $)", "(x^(2t))"],
    ["[ $ e^{-2t} $ ]", "[ e^(−2t) ]"],
    ["({[ $ e^{-2t} $ ]})", "({[ e^(−2t) ]})"],
    ["[$ e^{-2t} $}]", "[e^(−2t)]"],
  ])("repairs explicit math trailing closers idempotently in %s", (raw, expected) => {
    const once = formatSummaryForDisplay(raw).text;
    expect(once).toBe(expected);
    expect(formatSummaryForDisplay(once).text).toBe(once);
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

  it.each([
    [
      String.raw`<span>x = a \times b</span> Outside: $ x^2 $.`,
      String.raw`<span>x = a \times b</span> Outside: x².`,
    ],
    ["<span>$ x^2 $</span>", "<span>$ x^2 $</span>"],
    [
      String.raw`<section><span>y' = a \times b</span><code>$ x^2 $</code></section> $ y' = -2y $`,
      String.raw`<section><span>y' = a \times b</span><code>$ x^2 $</code></section> y′ = −2y`,
    ],
    ["Use<br>then solve $ x^2 $.", "Use<br>then solve x²."],
    ["<span>$ x^2 $", "<span>$ x^2 $"],
  ])("protects generic well-formed and malformed HTML-like literals in %s", (raw, expected) => {
    expect(formatSummaryForDisplay(raw).text).toBe(expected);
  });

  it("preserves quoted literal math and command examples", () => {
    const raw = String.raw`Examples "$ x^2 $" and '\times' stay literal; solve $ x^2 $.`;
    expect(formatSummaryForDisplay(raw).text).toBe(
      String.raw`Examples "$ x^2 $" and '\times' stay literal; solve x².`,
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
      "<span>$ x^2 $</span> $ {e^{-2t}} $",
      "The fee is $5 + tax and the result is $ x^2 $.",
      "Use f(e^(−2t)).",
      "• Unicode y′ = −2y\n\n• Plain prose",
    ];

    for (const raw of cases) {
      const once = formatSummaryForDisplay(raw).text;
      expect(formatSummaryForDisplay(once).text).toBe(once);
    }
  });

  it("satisfies currency-prefix and delimiter-style pairs with stable second passes", () => {
    const prefixes = ["", "The fee is $5. ", "The fees are $5 and $10. "];
    const mathPairs = [
      ["$x^2$", "x²"],
      ["$ x^2 $", "x²"],
      ["$$ x^2 $$", "x²"],
      ["$ y' = -2y $", "y′ = −2y"],
    ] as const;

    for (const prefix of prefixes) {
      for (const [math, formatted] of mathPairs) {
        const once = formatSummaryForDisplay(`${prefix}Result: ${math}.`).text;
        expect(once).toBe(`${prefix}Result: ${formatted}.`);
        expect(formatSummaryForDisplay(once).text).toBe(once);
      }
    }
  });

  it("keeps a generated outer, protected, currency, path, and multi-math corpus stable", () => {
    const outerPairs = [
      ["", ""],
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
      ["([", "])"],
      ["{[(", ")]}"],
    ] as const;
    const protectedPrefixes = [
      "",
      '"literal )", ',
      '"literal )",\n',
      "`literal ]`, ",
      "<code>literal }</code>, ",
      String.raw`C:\times\reports, `,
      "$5, ",
    ];
    const mathPairs = [
      ["$ x^{2t} $", "x^(2t)"],
      ["$ {e^{-2t}} $", "{e^(−2t)}"],
      ["$ y' = -2y $", "y′ = −2y"],
    ] as const;

    for (const [opening, closing] of outerPairs) {
      for (const protectedPrefix of protectedPrefixes) {
        for (const [firstRaw, firstExpected] of mathPairs) {
          for (const [secondRaw, secondExpected] of mathPairs) {
            const raw = `${opening}${protectedPrefix}${firstRaw}; ${secondRaw}${closing}`;
            const expected = `${opening}${protectedPrefix}${firstExpected}; ${secondExpected}${closing}`;
            const once = formatSummaryForDisplay(raw).text;
            expect(once).toBe(expected);
            expect(formatSummaryForDisplay(once).text).toBe(once);
          }
        }
      }
    }
  });

  it("removes generated globally unmatched math-adjacent closers without consuming outer closers", () => {
    const cases = [
      ["", "", "}"],
      ["(", ")", "}"],
      ["(", ")", "]"],
      ["[", "]", "}"],
      ["[", "]", ")"],
      ["{", "}", ")"],
      ["{", "}", "]"],
    ] as const;

    for (const [opening, closing, unmatched] of cases) {
      const raw = `The fee is $5. ${opening}$ x^{2t} $${unmatched}${closing} Then $ e^{-2t} $}.`;
      const expected = `The fee is $5. ${opening}x^(2t)${closing} Then e^(−2t).`;
      const once = formatSummaryForDisplay(raw).text;
      expect(once).toBe(expected);
      expect(formatSummaryForDisplay(once).text).toBe(once);
    }
  });
});
