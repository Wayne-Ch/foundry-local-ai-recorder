import assert from "node:assert/strict";
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { assertSummaryDisplayText } from "./integration-utils";

const transcripts = [
  "An ordinary differential equation relates a function to its derivative. For y prime equals negative two y, the solution is c times e to the negative two t, and the initial value determines c.",
  "The class compared Euler's method with the exact exponential solution. A smaller time step reduced numerical error but required more computations.",
  "Students should separate variables, integrate both sides, include the constant of integration, and then apply the initial condition.",
];
const controller = new RecorderController();
try {
  const prepared = await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(prepared.snapshot.readiness.summary.model?.id, SUMMARY_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  const results = [];
  for (const transcript of transcripts) {
    controller.editTranscript(transcript);
    const result = await controller.generateSummary();
    const summary = result.snapshot.transcript.summary;
    assert.ok(summary !== null, "Controller must store the generated summary.");
    assert.equal(result.summaryInput, transcript);
    assertSummaryDisplayText(summary.text);
    const rawTrace = result.snapshot.trace.findLast((entry) => entry.phase === "summary-raw");
    assert.ok(rawTrace !== undefined, "Developer Trace must retain the raw Qwen response.");
    results.push({
      durationMs: summary.durationMs,
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      rawText: rawTrace.detail,
      displayText: summary.text,
      formattingApplied: rawTrace.summaryDisplayFormattingApplied,
    });
  }
  console.log(
    `SUMMARY_INTEGRATION_OK ${JSON.stringify({
      model: prepared.snapshot.readiness.summary.model,
      runs: results,
      embeddedWebServiceRunning: prepared.snapshot.readiness.embeddedWebServiceRunning,
    })}`,
  );
} finally {
  await controller.shutdown();
}
