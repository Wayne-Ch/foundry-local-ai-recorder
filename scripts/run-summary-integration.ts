import assert from "node:assert/strict";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";

const transcripts = [
  "An ordinary differential equation relates a function to its derivative. For y prime equals negative two y, the solution is c times e to the negative two t, and the initial value determines c.",
  "The class compared Euler's method with the exact exponential solution. A smaller time step reduced numerical error but required more computations.",
  "Students should separate variables, integrate both sides, include the constant of integration, and then apply the initial condition.",
];
const runtime = new FoundryRecorderRuntime();
try {
  const prepared = await runtime.prepare(false, (event) => process.stdout.write(`${event.detail}\n`));
  assert.equal(prepared.readiness.summary.model?.id, SUMMARY_MODEL_ID);
  assert.equal(prepared.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  const results = [];
  for (const transcript of transcripts) {
    const result = await runtime.summarize(transcript);
    assert.ok(result.text.length > 20, "Summary must be nonempty and substantive.");
    assert.ok(result.text.length <= 2_500, "Summary must remain bounded.");
    assert.equal(result.response.finishReason, "stop");
    results.push({
      durationMs: result.durationMs,
      promptTokens: result.response.usage.promptTokens,
      completionTokens: result.response.usage.completionTokens,
      text: result.text,
    });
  }
  console.log(
    `SUMMARY_INTEGRATION_OK ${JSON.stringify({
      model: prepared.readiness.summary.model,
      runs: results,
      embeddedWebServiceRunning: prepared.readiness.embeddedWebServiceRunning,
    })}`,
  );
} finally {
  await runtime.shutdown();
}
