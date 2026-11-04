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
        trigger: /y\(t\)|y of t|e\^/iu,
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
        trigger: /\bc\s*=|\bc\s+equals\b|(?:integration )?constant/iu,
        valid:
          /c\s*=\s*3|c equals 3|(?:integration )?constant[\s\S]{0,80}(?:determined|set)[\s\S]{0,50}(?:by|from)[\s\S]{0,30}(?:the )?initial condition|initial condition[\s\S]{0,80}(?:determines?|sets?)[\s\S]{0,40}\bc\s*(?:=\s*|to\s+)3\b/iu,
      },
    ],
    forbidden: [
      /(?:\bc\b|(?:integration )?constant)[\s\S]{0,20}(?:is|was|represents?)\s+(?:the\s+)?initial condition/iu,
      /initial condition[\s\S]{0,20}(?:is|was)\s+(?:\bc\b|(?:the )?(?:integration )?constant)/iu,
      /\bc\s*=\s*y\(0\)/iu,
      /(?:initial condition|y\(0\)|y of 0)[\s\S]{0,80}(?:caus(?:e|ed|es|ing)?|led to|results? in)[\s\S]{0,80}(?:decay|equation|solution)/iu,
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
        trigger: /cold start latency|420\s*(?:milliseconds|ms)|(?:reduc|fell|decreas)/iu,
        valid:
          /(?:reduc|fell|decreas)[\s\S]{0,80}420\s*(?:milliseconds|ms)[\s\S]{0,80}280\s*(?:milliseconds|ms)|420\s*(?:milliseconds|ms)[\s\S]{0,80}(?:to|down to)[\s\S]{0,30}280\s*(?:milliseconds|ms)/iu,
      },
      {
        label: "cache cause",
        trigger: /local model cache|enabled the cache|cache caused/iu,
        valid:
          /(?:(?:local model cache|model cache|the cache|cache)[\s\S]{0,100}(?:reduc|fell|decreas|improv|caus|led to|resulted in)[\s\S]{0,100}(?:cold start )?latency[\s\S]{0,80}420\s*(?:milliseconds|ms)[\s\S]{0,50}(?:to|down to)[\s\S]{0,30}280\s*(?:milliseconds|ms)|(?:reduc|fell|decreas|improv)[\s\S]{0,100}(?:cold start )?latency[\s\S]{0,80}420\s*(?:milliseconds|ms)[\s\S]{0,50}(?:to|down to)[\s\S]{0,30}280\s*(?:milliseconds|ms)[\s\S]{0,100}(?:after|because|due to|caused by|resulted from|following)[\s\S]{0,60}(?:local model cache|model cache|the cache|cache))/iu,
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
      /(?:\btarget\b|250\s*(?:milliseconds|ms))[\s\S]{0,60}(?:caus(?:e|ed|es|ing)?|led to|resulted in)[\s\S]{0,80}(?:reduc|latency|280\s*(?:milliseconds|ms))/iu,
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
        trigger:
          /Battery Pack B|(?:measured|initial)[\s\S]{0,40}82\s*(?:watt-hours|Wh)|25\s*(?:degrees Celsius|°C|C)\b/iu,
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
        trigger: /6\s*(?:watt-hours|Wh)|\bdecline\s+(?:of|was|is|amount)/iu,
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
      /(?:quiet room|room[\s\S]{0,20}quiet)[\s\S]{0,60}(?:caus(?:e|ed|es|ing)?|led to|resulted in)[\s\S]{0,80}(?:Project Cedar|select|samples)/iu,
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
const odeFixture = requiredFixture("ode");
const atlasFixture = requiredFixture("atlas");
const auroraFixture = requiredFixture("aurora");
assert.doesNotThrow(() => validateSummaryText(odeFixture, "The initial condition is y(0) = 3."));
assert.doesNotThrow(() => validateSummaryText(atlasFixture, "The target remains 250 milliseconds."));
assert.doesNotThrow(() =>
  validateSummaryText(atlasFixture, "Cold start latency fell from 420 milliseconds to 280 milliseconds."),
);
assert.doesNotThrow(() =>
  validateSummaryText(
    atlasFixture,
    "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds.",
  ),
);
const factualGateRegressions = [
  {
    fixture: odeFixture,
    text: "An ordinary differential equation relates a function to its derivatives. The first order equation y' = -2y has solution y(t) = c * e^(-2t), which decays over time. The initial condition y(0) = 3 sets c = 2.",
    expected: /resolved constant/,
  },
  {
    fixture: odeFixture,
    text: "An ordinary differential equation relates a function to its derivatives. The source equation is y' = -2y. The equation used for the solution is y' = -3y. The solution y(t) = c * e^(-2t) decays over time. The initial condition y(0) = 3 sets c = 3.",
    expected: /first-order equation/,
  },
  {
    fixture: odeFixture,
    text: "An ordinary differential equation relates a function to its derivatives. For y' = -2y, the solution y(t) = c * e^(-2t) decays over time. The initial condition y(0) = 3 causes the exponential decay, and c = 3.",
    expected: /false or unrelated claim/,
  },
  {
    fixture: odeFixture,
    text: "An ordinary differential equation relates a function to its derivatives. For y' = -2y, y(t) = c * e^(-2t) decays over time. The integration constant is the initial condition, while y(0) = 3 sets c = 3.",
    expected: /false or unrelated claim/,
  },
  {
    fixture: atlasFixture,
    text: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. Maya Chen owns the follow-up, and the next review is November 12. The 250 millisecond target caused the latency reduction.",
    expected: /false or unrelated claim/,
  },
  {
    fixture: atlasFixture,
    text: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. The target is also 280 milliseconds. Maya Chen owns the follow-up, and the next review is November 12.",
    expected: /latency target/,
  },
  {
    fixture: atlasFixture,
    text: "The local model cache caused the target to remain 250 milliseconds.",
    expected: /cache cause/,
  },
  {
    fixture: atlasFixture,
    text: "The local model cache enabled the target to remain 250 milliseconds.",
    expected: /cache cause/,
  },
  {
    fixture: atlasFixture,
    text: "The local model cache caused the next review to be November 12.",
    expected: /cache cause/,
  },
  {
    fixture: auroraFixture,
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5. The planned 0.5 C rerun caused the decline.",
    expected: /charging cause/,
  },
  {
    fixture: auroraFixture,
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. The decline was 82 watt-hours. Priya will rerun the test at 0.5 C on December 5.",
    expected: /decline amount/,
  },
  {
    fixture: conciseFixture,
    text: "Project Cedar selected 12 samples on March 4. Lina owns calibration. The room was quiet. The quiet room caused Project Cedar to select 12 samples.",
    expected: /false or unrelated claim/,
  },
  {
    fixture: conciseFixture,
    text: "Project Cedar selected 12 samples on March 4. Project Cedar also selected 4 samples. Lina owns calibration. The room was quiet.",
    expected: /sample selection/,
  },
] as const;
for (const candidate of factualGateRegressions) {
  const displayText = formatSummaryPresentation(candidate.text).text;
  assert.throws(
    () => validateSummaryText(candidate.fixture, displayText),
    candidate.expected,
    `${candidate.fixture.id} factual regression candidate must fail: ${candidate.text}`,
  );
}
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
  const claims = factualClaims(text);
  assert.ok(
    fixture.anchors.some((anchor) => matches(anchor, text)),
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
    for (const claim of claims) {
      if (matches(fact.trigger, claim)) {
        assert.match(claim, fact.valid, `${fixture.id} summary misstated ${fact.label}`);
      }
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

function factualClaims(value: string): string[] {
  return value
    .split(/\r?\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+(?=(?:[-*]\s*)?[\p{L}\d])/u))
    .map((claim) => claim.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "").trim())
    .filter(Boolean);
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function requiredFixture(id: string): SummaryFixture {
  const fixture = transcripts.find((candidate) => candidate.id === id);
  assert.ok(fixture !== undefined, `Missing summary fixture ${id}.`);
  return fixture;
}
