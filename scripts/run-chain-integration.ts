import assert from "node:assert/strict";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
} from "../src/audio/audio-types";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSafeDiagnostic } from "../src/shared/safe-diagnostic";
import { chunks, keywordRecall, listOwnedTempFiles, loadFixturePcm, sleep } from "./integration-utils";

const controller = new RecorderController();
const before = await listOwnedTempFiles();
try {
  const prepared = await controller.prepare({ enableLiveCaptions: true }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(
    prepared.liveCaptionsAvailable,
    true,
    prepared.liveCaptionsFailure === null
      ? "Nemotron unavailable"
      : formatSafeDiagnostic(prepared.liveCaptionsFailure),
  );
  assert.equal(prepared.snapshot.readiness.inProcessModeValidated, true);
  assert.equal(prepared.snapshot.readiness.externalEndpointUsed, false);
  assert.equal(prepared.snapshot.readiness.embeddedWebServiceRunning, false);
  assert.deepEqual(prepared.snapshot.readiness.embeddedWebServiceUrls, []);
  const partials: string[] = [];
  const started = await controller.startLiveStream(
    {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      maxDurationMs: AUDIO_MAX_DURATION_MS,
    },
    (event) => partials.push(event.text),
  );
  const pcm = await loadFixturePcm();
  let sequence = 0;
  for (const chunk of chunks(pcm)) {
    controller.appendLiveChunk({
      streamId: started.streamId,
      sequence,
      data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
    });
    sequence += 1;
    await sleep(100);
  }
  const durationMs = audioDurationMsFromPcmBytes(pcm.byteLength);
  const live = await controller.finishLiveStream({
    streamId: started.streamId,
    lastSequence: sequence - 1,
    audioDurationMs: durationMs,
  });
  const final = await controller.transcribeCapture({
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs,
    data: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  });
  const summary = await controller.generateSummary();
  const recall = keywordRecall(final.result.transcript);
  assert.ok(partials.length > 0);
  assert.ok(recall.recall >= 0.66, `Whisper keyword recall ${recall.recall}: ${final.result.transcript}`);
  assert.equal(summary.summaryInput, final.result.transcript);
  assert.notEqual(summary.summaryInput, live.result.transcript);
  assert.notEqual(summary.summaryInput, partials.at(-1));
  assert.equal(live.result.externalEndpointUsed, false);
  assert.equal(final.result.externalEndpointUsed, false);
  assert.equal(summary.snapshot.transcript.summary?.transcriptVersion, final.snapshot.transcript.version);
  assert.deepEqual(await listOwnedTempFiles(), before);
  console.log(
    `CHAIN_INTEGRATION_OK ${JSON.stringify({
      partialCount: partials.length,
      firstCaptionMs: summary.snapshot.timing.firstCaptionMs,
      stopToWhisperFinalMs: summary.snapshot.timing.stopToWhisperFinalMs,
      transcriptFinalToSummaryMs: summary.snapshot.timing.transcriptFinalToSummaryMs,
      nemotronTerminal: live.result.transcript,
      whisperFinal: final.result.transcript,
      summary: summary.snapshot.transcript.summary,
      summaryInputEqualsWhisperFinal: summary.summaryInput === final.result.transcript,
      summaryInputLength: summary.summaryInput.length,
      inProcessModeValidated: summary.snapshot.readiness.inProcessModeValidated,
      externalEndpointUsed:
        summary.snapshot.readiness.externalEndpointUsed ||
        live.result.externalEndpointUsed ||
        final.result.externalEndpointUsed,
      embeddedWebServiceRunning: summary.snapshot.readiness.embeddedWebServiceRunning,
      embeddedWebServiceUrls: summary.snapshot.readiness.embeddedWebServiceUrls,
      tempResidue: await listOwnedTempFiles(),
    })}`,
  );
} finally {
  await controller.shutdown();
}
