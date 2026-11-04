import assert from "node:assert/strict";
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSummaryPresentation } from "../src/summary/summary-format";
import { assertSummaryDisplayText } from "./integration-utils";

const MAX_SUMMARY_LATENCY_MS = 10_000;
const FORBIDDEN_INSTRUCTION_ECHOES = [
  "repeat or refer to these instructions",
  "restate the transcript",
  "prefer the transcript's own wording",
  "transcript start",
  "transcript end",
] as const;

interface ConditionalFact {
  readonly label: string;
  readonly trigger: RegExp;
  readonly valid: RegExp;
}

interface SummaryFixture {
  readonly id: string;
  readonly text: string;
  readonly anchors: readonly RegExp[];
  readonly facts: readonly ConditionalFact[];
  readonly forbidden: readonly RegExp[];
  readonly allowedExtraNumbers: readonly string[];
  readonly maxWords?: number;
}

const transcripts: readonly SummaryFixture[] = [
  {
    id: "ode",
    text: "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.",
    anchors: [
      /\bordinary differential equation\b|\bODE\b/iu,
      /y[′']\s*=\s*[−-]2y|y prime equals negative two y/iu,
      /y\(t\)|y of t|decay/iu,
      /y\(0\)|y of 0|initial condition/iu,
    ],
    facts: [
      {
        label: "ODE definition",
        trigger: /\bordinary differential equation\b|\bODE\b/iu,
        valid: /(?:ordinary differential equation|ODE)[\s\S]{0,100}function[\s\S]{0,60}derivatives?/iu,
      },
      {
        label: "first-order equation",
        trigger: /first order|y[′']|y prime/iu,
        valid: /y[′']\s*=\s*[−-]2y|y prime equals negative two y/iu,
      },
      {
        label: "general solution",
        trigger: /\bsolution\b|y\(t\)|y of t|e\^/iu,
        valid: /y\(t\)\s*=\s*c\s*[·*]?\s*e\^\([−-]2t\)|y of t equals c times e to the negative two t/iu,
      },
      {
        label: "decay relationship",
        trigger: /\bdecay\b/iu,
        valid: /decay[\s\S]{0,30}(?:over time|with time)|(?:over time|with time)[\s\S]{0,30}decay/iu,
      },
      {
        label: "initial condition",
        trigger: /y\(0\)|y of 0|initial condition/iu,
        valid:
          /y\(0\)\s*=\s*3|y of 0 equals 3|initial condition[\s\S]{0,80}(?:determines?|sets?)[\s\S]{0,40}\bc\b/iu,
      },
      {
        label: "resolved constant",
        trigger: /\bc\b|\bconstant\b/iu,
        valid:
          /c\s*=\s*3|c equals 3|y\(t\)\s*=\s*c\s*[·*]?\s*e\^\([−-]2t\)|y of t equals c times e to the negative two t|c[\s\S]{0,50}(?:integration )?constant[\s\S]{0,80}(?:determined|set)[\s\S]{0,50}initial condition/iu,
      },
    ],
    forbidden: [
      /\bc\b[\s\S]{0,20}(?:is|was|represents?)\s+(?:the\s+)?initial condition/iu,
      /initial condition[\s\S]{0,20}(?:is|was)\s+\bc\b/iu,
      /\bc\s*=\s*y\(0\)/iu,
      /\bEuler\b|\bhomework\b|\bcitation\b|\bProject Atlas\b|\bTeam Aurora\b/iu,
    ],
    allowedExtraNumbers: ["2"],
  },
  {
    id: "atlas",
    text: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. Maya Chen owns the follow-up, and the next review is November 12.",
    anchors: [/\bProject Atlas\b|cold start latency|420|280|250|Maya Chen|November 12/iu],
    facts: [
      {
        label: "latency reduction",
        trigger: /cold start latency|420|280/iu,
        valid:
          /(?:reduc|fell|decreas)[\s\S]{0,80}420\s*(?:milliseconds|ms)[\s\S]{0,80}280\s*(?:milliseconds|ms)|420\s*(?:milliseconds|ms)[\s\S]{0,80}(?:to|down to)[\s\S]{0,30}280\s*(?:milliseconds|ms)/iu,
      },
      {
        label: "cache cause",
        trigger: /local model cache|enabled the cache|cache caused/iu,
        valid:
          /(?:after|because)[\s\S]{0,80}(?:enabled|using)[\s\S]{0,50}local model cache|local model cache[\s\S]{0,100}(?:reduc|caus|enabled)/iu,
      },
      {
        label: "latency target",
        trigger: /\btarget\b|250/iu,
        valid: /target[\s\S]{0,40}250\s*(?:milliseconds|ms)|250\s*(?:milliseconds|ms)[\s\S]{0,40}target/iu,
      },
      {
        label: "follow-up owner",
        trigger: /Maya Chen|follow-up|\bowner\b/iu,
        valid: /Maya Chen[\s\S]{0,60}(?:owns?|owner|follow-up)/iu,
      },
      {
        label: "review date",
        trigger: /November|\breview\b/iu,
        valid: /(?:next )?review[\s\S]{0,50}November\s+12|November\s+12[\s\S]{0,50}(?:next )?review/iu,
      },
    ],
    forbidden: [
      /Maya Chen[\s\S]{0,50}(?:enabled|caused)[\s\S]{0,50}(?:cache|latency)/iu,
      /\bPriya\b|\bBattery Pack B\b|\bTeam Aurora\b|\bthermal runaway\b|\bequation\b/iu,
    ],
    allowedExtraNumbers: [],
  },
  {
    id: "aurora",
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5.",
    anchors: [/\bTeam Aurora\b|\bBattery Pack B\b|82|76|100 cycles|Priya|December 5/iu],
    facts: [
      {
        label: "initial measurement",
        trigger: /Battery Pack B|82|25 degrees|25 °C/iu,
        valid:
          /Battery Pack B[\s\S]{0,80}82\s*(?:watt-hours|Wh)[\s\S]{0,80}25\s*(?:degrees Celsius|°C|C)\b/iu,
      },
      {
        label: "cycle result",
        trigger: /100 cycles|76\s*(?:watt-hours|Wh)|capacity fell/iu,
        valid: /100\s*cycles[\s\S]{0,100}76\s*(?:watt-hours|Wh)/iu,
      },
      {
        label: "decline amount",
        trigger: /6\s*(?:watt-hours|Wh)|\bdecline\b/iu,
        valid: /6\s*(?:watt-hours|Wh)[\s\S]{0,60}declin|declin[\s\S]{0,60}6\s*(?:watt-hours|Wh)/iu,
      },
      {
        label: "charging cause",
        trigger: /high-rate charging|\bcaused\b|\bcause\b/iu,
        valid:
          /(?:caus|due to|because of)[\s\S]{0,80}high-rate charging|high-rate charging[\s\S]{0,80}(?:caus|led to|resulted)/iu,
      },
      {
        label: "rerun owner and rate",
        trigger: /Priya|\brerun\b|0\.5\s*C/iu,
        valid: /Priya[\s\S]{0,100}(?:rerun|repeat)[\s\S]{0,100}0\.5\s*C\b/iu,
      },
      {
        label: "rerun date",
        trigger: /December|\brerun\b/iu,
        valid: /(?:rerun|repeat)[\s\S]{0,100}December\s+5|December\s+5[\s\S]{0,100}(?:rerun|repeat)/iu,
      },
    ],
    forbidden: [
      /Priya[\s\S]{0,60}(?:caused|measured)[\s\S]{0,60}(?:decline|capacity|Battery Pack B)/iu,
      /\bMaya Chen\b|\bProject Atlas\b|\bthermal runaway\b/iu,
    ],
    allowedExtraNumbers: [],
  },
  {
    id: "concise",
    text: "Project Cedar selected 12 samples on March 4. Lina owns calibration. The room was quiet.",
    anchors: [/\bProject Cedar\b|12 samples|March 4|\bLina\b|calibration|room was quiet/iu],
    facts: [
      {
        label: "sample selection",
        trigger: /Project Cedar|samples/iu,
        valid: /Project Cedar[\s\S]{0,60}selected[\s\S]{0,30}12\s+samples/iu,
      },
      {
        label: "selection date",
        trigger: /March|\b4\b/iu,
        valid: /March\s+4/iu,
      },
      {
        label: "calibration owner",
        trigger: /Lina|calibration|\bowns?\b/iu,
        valid: /Lina[\s\S]{0,40}owns?[\s\S]{0,30}calibration/iu,
      },
      {
        label: "room observation",
        trigger: /\broom\b|\bquiet\b/iu,
        valid: /room[\s\S]{0,30}(?:was|is)[\s\S]{0,20}quiet/iu,
      },
    ],
    forbidden: [
      /Lina[\s\S]{0,40}(?:selected|scheduled)[\s\S]{0,30}(?:samples|calibration)/iu,
      /\bProject Atlas\b|\bTeam Aurora\b|\bPriya\b|\bMaya Chen\b/iu,
    ],
    allowedExtraNumbers: [],
    maxWords: 35,
  },
];

const conciseFixture = transcripts.find(({ id }) => id === "concise");
assert.ok(conciseFixture !== undefined);
assert.doesNotThrow(() => validateSummaryText(conciseFixture, "Project Cedar selected 12 samples."));
assert.throws(
  () => validateSummaryText(conciseFixture, "Project Cedar selected 14 samples."),
  /invented numbers/,
);
assert.throws(
  () => validateSummaryText(conciseFixture, "Lina scheduled calibration."),
  /false or unrelated claim|calibration owner/,
);
console.log("SUMMARY_ACCEPTANCE_POLICY_OK omissions_allowed inaccuracies_rejected");

const controller = new RecorderController();
try {
  const prepared = await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(prepared.snapshot.readiness.summary.model?.id, SUMMARY_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  const results = [];
  const failures: Array<{ readonly fixture: string; readonly message: string }> = [];
  for (const fixture of transcripts) {
    try {
      controller.editTranscript(fixture.text);
      const result = await controller.generateSummary();
      const summary = result.snapshot.transcript.summary;
      assert.ok(summary !== null, "Controller must store the generated summary.");
      assert.equal(result.summaryInput, fixture.text);
      const rawTrace = result.snapshot.trace.findLast((entry) => entry.phase === "summary-raw");
      assert.ok(rawTrace !== undefined, "Developer Trace must retain the raw Qwen response.");
      const runEvidence = {
        fixture: fixture.id,
        durationMs: summary.durationMs,
        promptTokens: summary.promptTokens,
        completionTokens: summary.completionTokens,
        rawText: rawTrace.detail,
        displayText: summary.text,
        formattingApplied: rawTrace.summaryDisplayFormattingApplied,
      };
      console.log(`SUMMARY_FIXTURE_RESULT ${JSON.stringify(runEvidence)}`);
      assert.ok(
        summary.durationMs <= MAX_SUMMARY_LATENCY_MS,
        `${fixture.id} summary exceeded ${MAX_SUMMARY_LATENCY_MS} ms: ${summary.durationMs} ms`,
      );
      validateSummaryText(fixture, summary.text);
      results.push(runEvidence);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ fixture: fixture.id, message });
      console.error(`SUMMARY_FIXTURE_FAILED ${JSON.stringify({ fixture: fixture.id, message })}`);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ fixture, message }) => new Error(`${fixture}: ${message}`)),
      `Summary fact gate failed for ${failures.length} fixture(s).`,
    );
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

function validateSummaryText(fixture: SummaryFixture, text: string): void {
  assertSummaryDisplayText(text);
  assert.equal(formatSummaryPresentation(text).text, text);
  assert.ok(
    fixture.anchors.some((anchor) => anchor.test(text)),
    `${fixture.id} summary contained no recognizable source fact`,
  );
  for (const echo of FORBIDDEN_INSTRUCTION_ECHOES) {
    assert.equal(
      text.toLowerCase().includes(echo),
      false,
      `${fixture.id} summary echoed instruction text: ${echo}`,
    );
  }
  for (const pattern of fixture.forbidden) {
    assert.doesNotMatch(text, pattern, `${fixture.id} summary contained a false or unrelated claim`);
  }
  const allowedNumbers = new Set([...numericTokens(fixture.text), ...fixture.allowedExtraNumbers]);
  const unexpectedNumbers = [...new Set(numericTokens(text).filter((number) => !allowedNumbers.has(number)))];
  assert.deepEqual(unexpectedNumbers, [], `${fixture.id} summary invented numbers`);
  for (const fact of fixture.facts) {
    if (fact.trigger.test(text)) {
      assert.match(text, fact.valid, `${fixture.id} summary misstated ${fact.label}`);
    }
  }
  if (fixture.maxWords !== undefined) {
    const wordCount = text.trim().split(/\s+/u).filter(Boolean).length;
    assert.ok(
      wordCount <= fixture.maxWords,
      `${fixture.id} summary exceeded ${fixture.maxWords} words: ${wordCount}`,
    );
  }
}

function numericTokens(value: string): string[] {
  return [...value.matchAll(/\d+(?:\.\d+)?/gu)].map(([token]) => token);
}
