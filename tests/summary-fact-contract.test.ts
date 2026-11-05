import { describe, expect, it } from "vitest";
import { SUMMARY_FACT_CONTRACTS, summaryFactViolations } from "../scripts/summary-fact-contract";
import { formatSummaryPresentation } from "../src/summary/summary-format";

describe("summary fact contracts", () => {
  it.each(SUMMARY_FACT_CONTRACTS)("accepts the factual $id formatter fixture", (contract) => {
    const summary = formatSummaryPresentation(contract.text).text;

    expect(summary.split("\n")).toHaveLength(5);
    expect(summaryFactViolations(contract, summary)).toEqual([]);
  });

  it("allows Atlas omissions when every displayed claim remains traceable and distinct", () => {
    const atlas = SUMMARY_FACT_CONTRACTS.find(({ id }) => id === "atlas");
    if (atlas === undefined) {
      throw new Error("Atlas contract missing.");
    }
    const summary = [
      "Project Atlas is the explicit project.",
      "• Cold start latency changed from 420 milliseconds to 280 milliseconds.",
      "• The team enabled the local model cache.",
      "• Maya Chen owns the follow-up.",
      "• Project Atlas remains the named project.",
    ].join("\n");

    expect(summaryFactViolations(atlas, summary)).toEqual([]);
  });

  it("rejects the captured GPU ODE substitution and repeated initial-condition bullets", () => {
    const ode = SUMMARY_FACT_CONTRACTS.find(({ id }) => id === "ode");
    if (ode === undefined) {
      throw new Error("ODE contract missing.");
    }
    const raw = [
      "The equation y′ = −2y is solved by separation of variables to yield y(t) = Ce^(−2t).",
      "• The constant C is determined by the initial condition y(0) = 3, which results in C = 3.",
      "• The solution represents exponential decay over time.",
      "• The initial value y(0) = 3 implies C = 3.",
      "• The final solution is y(t) = 3e^(−2t).",
    ].join("\n");

    expect(summaryFactViolations(ode, raw)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("forbidden claim"),
        expect.stringContaining("repeats only previously used claims"),
        expect.stringContaining("not traceable"),
      ]),
    );
  });

  it("accepts deterministic deduplication of the corrected captured GPU output", () => {
    const ode = SUMMARY_FACT_CONTRACTS.find(({ id }) => id === "ode");
    if (ode === undefined) {
      throw new Error("ODE contract missing.");
    }
    const raw = [
      "The first order equation y′ = −2y is solved by separation of variables to yield y(t) = c·e^(−2t).",
      "• The constant c is determined by the initial condition y(0) = 3, which results in c = 3.",
      "• The solution represents exponential decay over time with the specific value c = 3.",
      "• The initial condition y(0) = 3 is explicitly stated as the condition for determining c.",
      "• The equation y′ = −2y is the governing differential relation for the system.",
    ].join("\n");
    const formatted = formatSummaryPresentation(raw).text;

    expect(formatted.split("\n")).toHaveLength(5);
    expect(summaryFactViolations(ode, formatted)).toEqual([]);
  });

  it("accepts deterministic deduplication of the captured Atlas target", () => {
    const atlas = SUMMARY_FACT_CONTRACTS.find(({ id }) => id === "atlas");
    if (atlas === undefined) {
      throw new Error("Atlas contract missing.");
    }
    const raw = [
      "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache.",
      "• The target latency remains at 250 milliseconds.",
      "• Maya Chen owns the follow-up and the next review is scheduled for November 12.",
      "• The team enabled the local model cache to achieve the new latency reduction.",
      "• The project continues with the updated target of 250 milliseconds.",
    ].join("\n");

    expect(summaryFactViolations(atlas, formatSummaryPresentation(raw).text)).toEqual([]);
  });

  it.each([
    [
      "atlas",
      [
        "Project Atlas changed cold start latency.",
        "• Latency moved from 280 milliseconds to 420 milliseconds.",
        "• The local model cache slowed the system.",
        "• The target remains 250 milliseconds.",
        "• Maya Chen owns the follow-up.",
      ].join("\n"),
    ],
    [
      "aurora",
      [
        "Team Aurora measured Battery Pack B.",
        "• Battery Pack B measured 82 watt-hours.",
        "• The temperature was 25 degrees Celsius.",
        "• Capacity fell after 100 cycles.",
        "• The decline was caused by temperature.",
      ].join("\n"),
    ],
  ])("rejects false direction or cause claims for %s", (id, summary) => {
    const contract = SUMMARY_FACT_CONTRACTS.find((candidate) => candidate.id === id);
    if (contract === undefined) {
      throw new Error(`${id} contract missing.`);
    }

    expect(summaryFactViolations(contract, summary)).not.toEqual([]);
  });
});
