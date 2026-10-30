import assert from "node:assert/strict";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  NEMOTRON_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { formatSafeDiagnostic } from "../src/shared/safe-diagnostic";
import { chunks, keywordRecall, loadFixturePcm, sleep } from "./integration-utils";

const runtime = new FoundryRecorderRuntime();
try {
  const prepared = await runtime.prepare(true, (event) => process.stdout.write(`${event.detail}\n`));
  assert.equal(
    prepared.liveCaptionsAvailable,
    true,
    prepared.liveCaptionsFailure === null
      ? "Nemotron unavailable"
      : formatSafeDiagnostic(prepared.liveCaptionsFailure),
  );
  assert.equal(prepared.readiness.nemotron.model?.id, NEMOTRON_AUDIO_MODEL_ID);
  assert.equal(prepared.readiness.nemotron.model?.executionProvider, AUDIO_EXECUTION_PROVIDER);
  const partials: string[] = [];
  const started = await runtime.startLiveStream((event) => partials.push(event.text));
  const pcm = await loadFixturePcm();
  let sequence = 0;
  for (const chunk of chunks(pcm)) {
    const acknowledgement = runtime.appendLiveChunk(started.streamId, sequence, chunk);
    assert.equal(acknowledgement.acceptedSequence, sequence);
    sequence += 1;
    await sleep(100);
  }
  const result = await runtime.finishLiveStream({
    streamId: started.streamId,
    lastSequence: sequence - 1,
    audioDurationMs: audioDurationMsFromPcmBytes(pcm.byteLength),
  });
  const recall = keywordRecall(result.transcript);
  assert.ok(partials.length > 0, "Nemotron must emit at least one live partial.");
  assert.ok(result.firstPartialMs !== null, "Nemotron must record first-partial latency.");
  assert.ok(recall.recall >= 0.5, `Nemotron keyword recall ${recall.recall}: ${result.transcript}`);
  assert.equal(result.model.id, NEMOTRON_AUDIO_MODEL_ID);
  assert.equal(result.transcriptSource, "live_stream_final");
  assert.ok(result.audioDurationMs <= AUDIO_MAX_DURATION_MS);
  console.log(
    `NEMOTRON_INTEGRATION_OK ${JSON.stringify({
      partialCount: partials.length,
      firstPartialMs: result.firstPartialMs,
      finalizationMs: result.finalizationMs,
      terminalTranscript: result.transcript,
      matchedWords: recall.matched,
      model: result.model,
    })}`,
  );
} finally {
  await runtime.shutdown();
}
