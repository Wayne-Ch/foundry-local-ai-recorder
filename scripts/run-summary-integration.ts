import assert from "node:assert/strict";
import {
  SUMMARY_DEVICE_TYPE,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSummaryForDisplay } from "../src/summary/summary-format";
import { assertSummaryDisplayText } from "./integration-utils";
import {
  GENERIC_SUMMARY_FACT_CONTRACT,
  SUMMARY_FACT_CONTRACTS,
  summaryFactViolations,
} from "./summary-fact-contract";

const controller = new RecorderController();
try {
  const prepared = await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(prepared.snapshot.readiness.summary.model?.id, SUMMARY_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.deviceType, SUMMARY_DEVICE_TYPE);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  const results = [];
  for (const fixture of [...SUMMARY_FACT_CONTRACTS, GENERIC_SUMMARY_FACT_CONTRACT]) {
    controller.editTranscript(fixture.text);
    const result = await controller.generateSummary().catch((error: unknown) => {
      const snapshot = controller.bootstrap();
      console.error(
        `SUMMARY_FACT_GATE_FAILED ${JSON.stringify({
          fixture: fixture.id,
          error: error instanceof Error ? error.message : String(error),
          rawText: snapshot.trace.findLast((entry) => entry.phase === "summary-raw")?.detail ?? null,
        })}`,
      );
      throw error;
    });
    const summary = result.snapshot.transcript.summary;
    assert.ok(summary !== null, "Controller must store the generated summary.");
    assert.equal(result.summaryInput, fixture.text);
    assertSummaryDisplayText(summary.text);
    assert.equal(formatSummaryForDisplay(summary.text).text, summary.text);
    process.stdout.write(
      `SUMMARY_FACT_OBSERVATION ${JSON.stringify({ fixture: fixture.id, text: summary.text })}\n`,
    );
    assert.deepEqual(
      summaryFactViolations(fixture, summary.text),
      [],
      `${fixture.id} summary violated the omission-tolerant fact contract`,
    );
    const rawTrace = result.snapshot.trace.findLast((entry) => entry.phase === "summary-raw");
    assert.ok(rawTrace !== undefined, "Developer Trace must retain the raw Qwen response.");
    results.push({
      fixture: fixture.id,
      durationMs: summary.durationMs,
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      finishReason: "stop",
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
