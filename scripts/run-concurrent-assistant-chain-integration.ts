import assert from "node:assert/strict";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
} from "../src/audio/audio-types";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { AssistantController } from "../src/main/assistant-controller";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSafeDiagnostic } from "../src/shared/safe-diagnostic";
import {
  assertSummaryDisplayText,
  chunks,
  keywordRecall,
  listOwnedTempFiles,
  loadFixturePcm,
  sleep,
} from "./integration-utils";

assert.equal(
  process.platform,
  "win32",
  "The concurrent Foundry Local chain gate must run on the target Windows machine.",
);

const runtime = new FoundryRecorderRuntime();
const controller = new RecorderController(runtime);
const assistant = new AssistantController({
  runtime,
  getTranscript: () => controller.bootstrap().transcript,
});
const before = await listOwnedTempFiles();
let chatRequestedAt: number | null = null;
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
    if (chatRequestedAt === null && partials.length > 0) {
      chatRequestedAt = Date.now();
      assistant.startChat("windows-integration-session", "What is ODE? Answer in one sentence.", () => {});
    }
  }
  assert.ok(chatRequestedAt !== null, "Chat must be submitted while Nemotron recording is active.");
  const durationMs = audioDurationMsFromPcmBytes(pcm.byteLength);
  const live = await controller.finishLiveStream({
    streamId: started.streamId,
    lastSequence: sequence - 1,
    audioDurationMs: durationMs,
  });
  const recordingFinishedAt = Date.now();
  const final = await controller.transcribeCapture({
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs,
    data: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  });
  const summary = await controller.generateSummary();
  await waitFor(
    () => assistant.snapshot().chatMessages.some((message) => message.role === "assistant"),
    120_000,
  );
  const answer = assistant.snapshot().chatMessages.findLast((message) => message.role === "assistant")?.text;
  assert.ok(answer, "Concurrent local chat must return an answer.");
  assert.ok(chatRequestedAt <= recordingFinishedAt, "Chat was not initiated during recording.");
  assert.ok(partials.length > 0);
  assert.ok(keywordRecall(final.result.transcript).recall >= 0.66);
  assert.equal(summary.summaryInput, final.result.transcript);
  assert.notEqual(summary.summaryInput, live.result.transcript);
  assertSummaryDisplayText(summary.snapshot.transcript.summary?.text ?? "");
  assert.deepEqual(await listOwnedTempFiles(), before);
  console.log(
    `CONCURRENT_ASSISTANT_CHAIN_OK ${JSON.stringify({
      partialCount: partials.length,
      chatRequestedDuringRecording: chatRequestedAt <= recordingFinishedAt,
      chatAnswer: answer,
      whisperFinal: final.result.transcript,
      summary: summary.snapshot.transcript.summary,
      coreInProcessValidated: summary.snapshot.readiness.inProcessModeValidated,
      tempResidue: await listOwnedTempFiles(),
    })}`,
  );
} finally {
  assistant.shutdown();
  await controller.shutdown();
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for concurrent assistant output.`);
    }
    await sleep(100);
  }
}
