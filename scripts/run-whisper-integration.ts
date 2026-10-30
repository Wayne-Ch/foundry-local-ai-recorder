import assert from "node:assert/strict";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_FORMAT,
  AUDIO_SAMPLE_RATE,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { keywordRecall, listOwnedTempFiles, loadFixturePcm } from "./integration-utils";

const runtime = new FoundryRecorderRuntime();
const before = await listOwnedTempFiles();
try {
  const prepared = await runtime.prepare(false, (event) => process.stdout.write(`${event.detail}\n`));
  assert.equal(prepared.readiness.whisper.model?.id, WHISPER_AUDIO_MODEL_ID);
  assert.equal(prepared.readiness.whisper.model?.executionProvider, AUDIO_EXECUTION_PROVIDER);
  assert.equal(prepared.readiness.externalEndpointUsed, false);
  assert.equal(prepared.readiness.embeddedWebServiceRunning, false);
  assert.deepEqual(prepared.readiness.embeddedWebServiceUrls, []);

  const pcm = await loadFixturePcm();
  const result = await runtime.transcribeCapture({
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs: audioDurationMsFromPcmBytes(pcm.byteLength),
    pcmBytes: pcm,
    liveCaptionFailure: null,
  });
  const recall = keywordRecall(result.transcript);
  assert.ok(recall.recall >= 0.66, `Whisper keyword recall ${recall.recall}: ${result.transcript}`);
  assert.equal(result.model.id, WHISPER_AUDIO_MODEL_ID);
  assert.equal(result.transcriptSource, "whisper_file_final");
  assert.deepEqual(await listOwnedTempFiles(), before, "Whisper must leave no owned temporary WAV.");
  console.log(
    `WHISPER_INTEGRATION_OK ${JSON.stringify({
      transcript: result.transcript,
      transcriptionMs: result.transcriptionMs,
      audioDurationMs: result.audioDurationMs,
      matchedWords: recall.matched,
      model: result.model,
      externalEndpointUsed: result.externalEndpointUsed,
    })}`,
  );
} finally {
  await runtime.shutdown();
}
