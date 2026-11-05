import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildAssistantContext } from "../src/assistant/assistant-context";
import { assistantSystemPrompt, chatUserPrompt } from "../src/assistant/assistant-prompts";
import {
  CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
  CLINICIAN_HANDOFF_SENTENCE,
} from "../src/assistant/clinic-safety";
import { validateImage } from "../src/assistant/image-security";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
} from "../src/audio/audio-types";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";
import { SUMMARY_DEVICE_TYPE, SUMMARY_EXECUTION_PROVIDER } from "../src/foundry/runtime-config";
import { AssistantController, parseImageAnalysisNote } from "../src/main/assistant-controller";
import { RecorderController } from "../src/main/recorder-controller";
import { prepareFixtureInferenceImage } from "./integration-image";
import {
  appendLiveChunkWithBackpressure,
  assertSummaryDisplayText,
  chunks,
  keywordRecall,
  loadFixturePcm,
  sleep,
} from "./integration-utils";

assert.equal(
  process.platform,
  "win32",
  "The exact Foundry Local VLM gate must run on the target Windows machine.",
);
const PROBLEMATIC_TRANSCRIPT =
  "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
const expectedImageShape = parseImageAnalysisNote(`Visible text/objects:
- Equation: dy/dt = -2y
- Solution: y(t) = y0 * e^(-2t)
- Graph: y vs t curve showing exponential decay
Relation to lesson:
- Demonstrates the solution to the first order decay model
Uncertainty:
- No uncertainty`);
assert.match(expectedImageShape.visibleTextAndObjects, /dy\/dt = -2y/);
assert.match(expectedImageShape.relationToLesson.toLowerCase(), /first order decay model/);

const filePath = path.resolve("fixtures", "ode-slide.png");
const sourceBytes = await readFile(filePath);
const image = validateImage({
  basename: path.basename(filePath),
  declaredMimeType: "image/png",
  bytes: sourceBytes,
});
const inferenceImage = await prepareFixtureInferenceImage(filePath, image);
const runtime = new FoundryRecorderRuntime();
const controller = new RecorderController(runtime);
const assistant = new AssistantController({
  runtime,
  getTranscript: () => controller.bootstrap().transcript,
});
let pcm: Uint8Array | null = null;
try {
  const prepared = await controller.prepare({ enableLiveCaptions: true }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  assert.equal(prepared.liveCaptionsAvailable, true, "Nemotron live captions must be available.");
  assert.equal(prepared.snapshot.readiness.summary.model?.id, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.deviceType, SUMMARY_DEVICE_TYPE);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);

  const partials: string[] = [];
  const liveStream = await controller.startLiveStream(
    {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      maxDurationMs: AUDIO_MAX_DURATION_MS,
    },
    (event) => partials.push(event.text),
  );
  pcm = await loadFixturePcm();
  let sequence = 0;
  for (const chunk of chunks(pcm)) {
    await appendLiveChunkWithBackpressure(() =>
      controller.appendLiveChunk({
        streamId: liveStream.streamId,
        sequence,
        data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
      }),
    );
    sequence += 1;
    await sleep(100);
  }
  const durationMs = audioDurationMsFromPcmBytes(pcm.byteLength);
  const live = await controller.finishLiveStream({
    streamId: liveStream.streamId,
    lastSequence: sequence - 1,
    audioDurationMs: durationMs,
  });
  const whisper = await controller.transcribeCapture({
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs,
    data: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  });
  assert.ok(partials.length > 0, "Nemotron must emit at least one live caption.");
  assert.ok(live.result.transcript.trim(), "Nemotron must return a terminal live transcript.");
  assert.ok(whisper.result.transcript.trim(), "Whisper must return a final transcript.");
  assert.ok(
    keywordRecall(whisper.result.transcript).recall >= 0.66,
    `Whisper final missed expected fixture terms: ${whisper.result.transcript}`,
  );

  controller.editTranscript(PROBLEMATIC_TRANSCRIPT);
  const summary = await controller.generateSummary();
  assert.equal(summary.summaryInput, PROBLEMATIC_TRANSCRIPT);
  assert.ok(summary.snapshot.transcript.summary !== null, "Qwen must store the reviewed-final summary.");
  assertSummaryDisplayText(summary.snapshot.transcript.summary.text);

  const chat = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: chatUserPrompt(
        "What is an ordinary differential equation? Answer in one sentence.",
        buildAssistantContext(summary.snapshot.transcript, null),
      ),
    },
    {
      requestOptions: {
        search: { doSample: false, temperature: 0, seed: 42, maxOutputTokens: 100 },
        toolChoice: "none",
        additionalOptions: {
          chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
        },
      },
    },
  );
  assert.equal(chat.response.finishReason, "stop");
  assert.match(chat.text.toLowerCase(), /(ordinary differential equation|ode)/);

  const selected = assistant.selectImage(image, "data:image/png;base64,validation-preview", inferenceImage);
  assert.equal(selected.image?.width, image.width);
  assert.equal(selected.image?.height, image.height);
  assert.equal(selected.image?.thumbnailDataUrl, "data:image/png;base64,validation-preview");
  image.bytes.fill(0);
  inferenceImage.bytes.fill(0);

  assistant.startImageAnalysis("vision-integration", () => {});
  await waitFor(() => assistant.snapshot().imageAnalysis !== null, 120_000);
  const note = assistant.snapshot().imageAnalysis;
  assert.ok(note !== null, "Image analysis must complete.");
  assert.match(
    `${note.visibleTextAndObjects} ${note.relationToLesson}`.toLowerCase(),
    /(ordinary differential|ode|dy\/dt|derivative)/,
  );
  assert.equal(note.modelId, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);

  const explained = assistant.startChat(
    "vision-integration",
    "Explain the selected image in one sentence.",
    () => {},
  );
  await waitFor(
    () =>
      assistant
        .snapshot()
        .chatMessages.some(
          (message) => message.requestId === explained.requestId && message.role === "assistant",
        ),
    120_000,
  );
  const explanation = assistant
    .snapshot()
    .chatMessages.find(
      (message) => message.requestId === explained.requestId && message.role === "assistant",
    )?.text;
  assert.ok(explanation !== undefined, "Explain image must return an assistant answer.");
  assert.match(explanation, /(ordinary differential|ODE|equation|decay|derivative)/iu);

  assistant.setMode("clinic");
  const clinic = assistant.startChat(
    "vision-integration",
    "What treatment should a patient start?",
    () => {},
  );
  await waitFor(
    () =>
      assistant
        .snapshot()
        .chatMessages.some(
          (message) => message.requestId === clinic.requestId && message.role === "assistant",
        ),
    120_000,
  );
  const clinicAnswer = assistant
    .snapshot()
    .chatMessages.find(
      (message) => message.requestId === clinic.requestId && message.role === "assistant",
    )?.text;
  assert.ok(clinicAnswer !== undefined, "Clinic mode must return an assistant answer.");
  assert.equal(clinicAnswer, `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`);
  assert.equal(clinicAnswer.endsWith(CLINICIAN_HANDOFF_SENTENCE), true);
  assert.equal(clinicAnswer.split(CLINICIAN_HANDOFF_SENTENCE).length, 2);

  const assistantReset = assistant.reset();
  const recorderReset = await controller.reset();
  assert.equal(assistantReset.image, null);
  assert.deepEqual(assistantReset.chatMessages, []);
  assert.equal(recorderReset.readiness.whisper.status, "ready");
  assert.equal(recorderReset.readiness.nemotron.status, "ready");
  assert.equal(recorderReset.readiness.summary.status, "ready");
  console.log(
    `VISION_REPETITION_REGRESSION_OK ${JSON.stringify({
      sequence: [
        "nemotron_live",
        "whisper_final",
        "qwen_summary",
        "text_chat",
        "image_analysis",
        "explain_image",
        "clinic_handoff",
        "reset_preserves_models",
      ],
      partialCount: partials.length,
      nemotronTerminal: live.result.transcript,
      chatFinishReason: chat.response.finishReason,
      nativeWhisperFinal: whisper.result.transcript,
      reviewedWhisperFinal: PROBLEMATIC_TRANSCRIPT,
      summaryVersion: summary.snapshot.transcript.summary?.transcriptVersion,
      note,
      explanation,
      clinicAnswer,
      resetModelStates: [
        recorderReset.readiness.whisper.status,
        recorderReset.readiness.nemotron.status,
        recorderReset.readiness.summary.status,
      ],
    })}`,
  );
  console.log(
    `VISION_INTEGRATION_OK ${JSON.stringify({
      model: controller.bootstrap().readiness.summary.model,
      note,
      explanation,
      clinicAnswer,
      expectedImageShape,
      fixture: {
        basename: image.basename,
        width: image.width,
        height: image.height,
        sizeBytes: image.sizeBytes,
        inferenceWidth: inferenceImage.width,
        inferenceHeight: inferenceImage.height,
        inferenceSizeBytes: inferenceImage.sizeBytes,
      },
    })}`,
  );
} finally {
  pcm?.fill(0);
  sourceBytes.fill(0);
  image.bytes.fill(0);
  inferenceImage.bytes.fill(0);
  assistant.shutdown();
  await controller.shutdown();
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for vision integration output.`);
    }
    await sleep(100);
  }
}
