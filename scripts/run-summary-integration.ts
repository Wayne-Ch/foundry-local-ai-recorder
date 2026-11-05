import assert from "node:assert/strict";
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSummaryPresentation } from "../src/summary/summary-format";
import { assertSummaryDisplayText } from "./integration-utils";

const transcripts = [
  {
    id: "ode",
    text: "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.",
    required: [
      /\b(?:ordinary differential equation|ODE)\b/iu,
      /(?:y[′']\s*=\s*[−-]2y|y prime equals negative two y)/iu,
      /(?:y\(t\)\s*=\s*c\s*[·*]?\s*e\^\([−-]2t\)|y of t equals c times e to the negative two t)/iu,
      /(?:y\(0\)\s*=\s*3|y of 0 equals 3)/iu,
      /(?:c\s*=\s*3|c equals 3)/iu,
      /\bdecay\b/iu,
    ],
    forbidden: ["Euler", "homework", "citation"],
    allowedExtraNumbers: ["2"],
  },
  {
    id: "atlas",
    text: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. Maya Chen owns the follow-up, and the next review is November 12.",
    required: [
      /\bProject Atlas\b/u,
      /420\s*(?:milliseconds|ms)[\s\S]{0,80}280\s*(?:milliseconds|ms)/iu,
      /(?:local model cache[\s\S]{0,100}(?:reduc|caus)|(?:reduc|caus)[\s\S]{0,100}local model cache)/iu,
      /250\s*(?:milliseconds|ms)/iu,
      /Maya Chen[\s\S]{0,80}(?:owns?|owner|follow-up)/iu,
      /November\s+12/iu,
    ],
    forbidden: ["Priya", "battery", "equation"],
    allowedExtraNumbers: [],
  },
  {
    id: "aurora",
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5.",
    required: [
      /\bTeam Aurora\b/u,
      /\bBattery Pack B\b/u,
      /82\s*(?:watt-hours|Wh)[\s\S]{0,80}25\s*(?:degrees Celsius|°C|C)\b/iu,
      /100\s*cycles[\s\S]{0,100}76\s*(?:watt-hours|Wh)/iu,
      /(?:6\s*(?:watt-hours|Wh)[\s\S]{0,60}declin|declin[\s\S]{0,60}6\s*(?:watt-hours|Wh))/iu,
      /(?:caus[\s\S]{0,80}high-rate charging|high-rate charging[\s\S]{0,80}caus)/iu,
      /Priya[\s\S]{0,100}(?:rerun|repeat)/iu,
      /0\.5\s*C\b/iu,
      /December\s+5/iu,
    ],
    forbidden: ["Maya Chen", "Project Atlas", "thermal runaway"],
    allowedExtraNumbers: [],
  },
] as const;
const controller = new RecorderController();
try {
  const prepared = await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(prepared.snapshot.readiness.summary.model?.id, SUMMARY_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  const results = [];
  for (const fixture of transcripts) {
    controller.editTranscript(fixture.text);
    const result = await controller.generateSummary();
    const summary = result.snapshot.transcript.summary;
    assert.ok(summary !== null, "Controller must store the generated summary.");
    assert.equal(result.summaryInput, fixture.text);
    assertSummaryDisplayText(summary.text);
    assert.equal(formatSummaryPresentation(summary.text).text, summary.text);
    const summaryLines = summary.text.split("\n");
    assert.ok(summaryLines.length >= 2, `${fixture.id} summary must have an overview and bullets`);
    assert.equal(
      summaryLines.slice(1).every((line) => line.startsWith("• ")),
      true,
    );
    for (const pattern of fixture.required) {
      assert.match(summary.text, pattern, `${fixture.id} summary missed ${pattern.source}`);
    }
    for (const forbidden of fixture.forbidden) {
      assert.equal(
        summary.text.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `${fixture.id} summary invented ${forbidden}`,
      );
    }
    const allowedNumbers = new Set([...numericTokens(fixture.text), ...fixture.allowedExtraNumbers]);
    const unexpectedNumbers = [
      ...new Set(numericTokens(summary.text).filter((number) => !allowedNumbers.has(number))),
    ];
    assert.deepEqual(unexpectedNumbers, [], `${fixture.id} summary invented numbers`);
    const rawTrace = result.snapshot.trace.findLast((entry) => entry.phase === "summary-raw");
    assert.ok(rawTrace !== undefined, "Developer Trace must retain the raw Qwen response.");
    results.push({
      fixture: fixture.id,
      durationMs: summary.durationMs,
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      rawText: rawTrace.detail,
      displayText: summary.text,
      formattingApplied: rawTrace.summaryDisplayFormattingApplied,
    });
  }
  console.log(
    `SUMMARY_FACT_GATE_OK ${JSON.stringify({
      model: prepared.snapshot.readiness.summary.model,
      runs: results,
      embeddedWebServiceRunning: prepared.snapshot.readiness.embeddedWebServiceRunning,
    })}`,
  );
} finally {
  await controller.shutdown();
}

function numericTokens(value: string): string[] {
  return [...value.matchAll(/\d+(?:\.\d+)?/gu)].map(([token]) => token);
}
