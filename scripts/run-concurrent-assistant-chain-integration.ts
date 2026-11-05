import assert from "node:assert/strict";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
} from "../src/audio/audio-types";
import { FoundryRecorderRuntime, type SharedQwenLifecycleEvent } from "../src/foundry/foundry-runtime";
import { AssistantController } from "../src/main/assistant-controller";
import { RecorderController } from "../src/main/recorder-controller";
import { formatSafeDiagnostic } from "../src/shared/safe-diagnostic";
import {
  appendLiveChunkWithBackpressure,
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

const sharedQwenLifecycle: SharedQwenLifecycleEvent[] = [];
const runtime = new FoundryRecorderRuntime({
  onSharedQwenLifecycle: (event) => sharedQwenLifecycle.push(event),
});
const controller = new RecorderController(runtime);
const assistant = new AssistantController({
  runtime,
  getTranscript: () => controller.bootstrap().transcript,
});
const before = await listOwnedTempFiles();
let chatRequestedAt: number | null = null;
let chatAnsweredAt: number | null = null;
let chatRequestId: string | null = null;
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
  const pcmChunks = chunks(pcm);
  assert.ok(pcmChunks.length > 1, "The pressure fixture must contain more than one live chunk.");
  let sequence = 0;
  for (const chunk of pcmChunks.slice(0, -1)) {
    await appendLiveChunkWithBackpressure(() =>
      controller.appendLiveChunk({
        streamId: started.streamId,
        sequence,
        data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
      }),
    );
    sequence += 1;
    await sleep(100);
  }
  chatRequestedAt = Date.now();
  const startedChat = assistant.startChat(
    "windows-integration-session",
    "What is ODE? Explain it in four complete sentences for a student.",
    (snapshot) => {
      if (
        chatAnsweredAt === null &&
        chatRequestId !== null &&
        snapshot.chatMessages.some(
          (message) => message.requestId === chatRequestId && message.role === "assistant",
        )
      ) {
        chatAnsweredAt = Date.now();
      }
    },
  );
  chatRequestId = startedChat.requestId;
  await waitFor(
    () =>
      sharedQwenLifecycle.some(
        (event) => event.ticketId === chatRequestId && event.phase === "native_request_started",
      ),
    120_000,
  );
  const lastChunk = pcmChunks.at(-1);
  assert.ok(lastChunk !== undefined, "The pressure fixture must retain a final live chunk.");
  await appendLiveChunkWithBackpressure(() =>
    controller.appendLiveChunk({
      streamId: started.streamId,
      sequence,
      data: lastChunk.buffer.slice(
        lastChunk.byteOffset,
        lastChunk.byteOffset + lastChunk.byteLength,
      ) as ArrayBuffer,
    }),
  );
  sequence += 1;
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
  const summaryRequestedAt = Date.now();
  const summaryPromise = controller.generateSummary();
  await waitFor(
    () => sharedQwenLifecycle.some((event) => event.kind === "summary" && event.phase === "submitted"),
    10_000,
  );
  const askNativeStart = sharedQwenLifecycle.find(
    (event) => event.ticketId === chatRequestId && event.phase === "native_request_started",
  );
  const summarySubmitted = sharedQwenLifecycle.find(
    (event) => event.kind === "summary" && event.phase === "submitted",
  );
  assert.ok(askNativeStart !== undefined, "Ask native request start must be instrumented.");
  assert.ok(summarySubmitted !== undefined, "Summary runtime submission must be instrumented.");
  assert.ok(
    askNativeStart.sequence < summarySubmitted.sequence,
    "Summary was submitted before the Ask native request started.",
  );
  assert.equal(
    sharedQwenLifecycle.some(
      (event) =>
        event.ticketId === chatRequestId &&
        event.phase === "native_request_settled" &&
        event.sequence < summarySubmitted.sequence,
    ),
    false,
    "Ask native processRequest settled before Summary submission; native overlap was not proven.",
  );
  await waitFor(
    () =>
      assistant
        .snapshot()
        .chatMessages.some((message) => message.requestId === chatRequestId && message.role === "assistant"),
    120_000,
  );
  const summary = await summaryPromise;
  const summaryCompletedAt = Date.now();
  const chatMessages = assistant
    .snapshot()
    .chatMessages.filter((message) => message.requestId === chatRequestId);
  const userMessage = chatMessages.find((message) => message.role === "user");
  const assistantMessage = chatMessages.find((message) => message.role === "assistant");
  assert.ok(userMessage, "Concurrent chat must retain its user message.");
  assert.ok(assistantMessage, "Concurrent local chat must retain its answer after final transcription.");
  assert.ok(chatRequestedAt !== null, "Concurrent chat request timing must be captured.");
  assert.ok(chatAnsweredAt !== null, "Concurrent chat completion timing must be captured.");
  const askReleased = sharedQwenLifecycle.find(
    (event) => event.ticketId === chatRequestId && event.phase === "released",
  );
  const summaryNativeStart = sharedQwenLifecycle.find(
    (event) => event.kind === "summary" && event.phase === "native_request_started",
  );
  assert.ok(askReleased !== undefined, "Ask shared-Qwen release must be instrumented.");
  assert.ok(summaryNativeStart !== undefined, "Summary native request start must be instrumented.");
  assert.ok(summarySubmitted.sequence < askReleased.sequence, "Ask released before Summary was submitted.");
  assert.ok(
    askReleased.sequence < summaryNativeStart.sequence,
    "Summary native processRequest started before Ask cleanup released the shared FIFO.",
  );
  const expectedContextLabel = "live draft snapshot (may change)";
  assert.deepEqual(
    userMessage.contextLabels.map((label) => label.label),
    [expectedContextLabel],
  );
  assert.deepEqual(
    assistantMessage.contextLabels.map((label) => label.label),
    [expectedContextLabel],
  );
  const requestToAnswerMs = chatAnsweredAt - chatRequestedAt;
  assert.ok(requestToAnswerMs >= 0, "Concurrent chat timing must be non-negative.");
  assert.ok(chatAnsweredAt >= summaryRequestedAt, "Ask completed before the summary was requested.");
  assert.ok(summaryCompletedAt >= chatAnsweredAt, "Summary completed before the active Ask released Qwen.");
  assert.ok(chatRequestedAt < recordingFinishedAt, "Ask must be submitted while recording remains active.");
  assert.ok(partials.length > 0);
  assert.ok(keywordRecall(final.result.transcript).recall >= 0.66);
  assert.equal(summary.summaryInput, final.result.transcript);
  assert.notEqual(summary.summaryInput, live.result.transcript);
  assertSummaryDisplayText(summary.snapshot.transcript.summary?.text ?? "");
  assert.deepEqual(await listOwnedTempFiles(), before);
  console.log(
    `CONCURRENT_ASSISTANT_CHAIN_OK ${JSON.stringify({
      partialCount: partials.length,
      nativeOverlapProven:
        askNativeStart.sequence < summarySubmitted.sequence &&
        summarySubmitted.sequence < askReleased.sequence,
      chatRequestToAnswerMs: requestToAnswerMs,
      summaryWaitedForAskRelease: askReleased.sequence < summaryNativeStart.sequence,
      sharedQwenLifecycle,
      chatContextLabel: expectedContextLabel,
      chatAnswer: assistantMessage.text,
      whisperFinal: final.result.transcript,
      summary: summary.snapshot.transcript.summary,
      summaryFinishReason: "stop",
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
