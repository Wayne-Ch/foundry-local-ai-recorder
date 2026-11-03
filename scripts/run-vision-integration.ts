import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildAssistantContext, buildImageAnalysisContext } from "../src/assistant/assistant-context";
import {
  assistantSystemPrompt,
  chatUserPrompt,
  imageAnalysisPrompt,
} from "../src/assistant/assistant-prompts";
import { validateImage } from "../src/assistant/image-security";
import { audioDurationMsFromPcmBytes } from "../src/audio/audio-contract";
import { AUDIO_CHANNELS, AUDIO_FORMAT, AUDIO_SAMPLE_RATE } from "../src/audio/audio-types";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";
import { parseImageAnalysisNote } from "../src/main/assistant-controller";
import { RecorderController } from "../src/main/recorder-controller";
import { loadFixturePcm } from "./integration-utils";

assert.equal(
  process.platform,
  "win32",
  "The exact Foundry Local VLM gate must run on the target Windows machine.",
);
const PROBLEMATIC_TRANSCRIPT =
  "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
const exactCpuShape = parseImageAnalysisNote(`Visible text/objects:
- Equation: dy/dt = -2y
- Solution: y(t) = y0 * e^(-2t)
- Graph: y vs t curve showing exponential decay
Relation to lesson:
- Demonstrates the solution to the first order decay model
Uncertainty:
- No uncertainty`);
assert.match(exactCpuShape.visibleTextAndObjects, /dy\/dt = -2y/);
assert.match(exactCpuShape.relationToLesson.toLowerCase(), /first order decay model/);

const filePath = path.resolve("fixtures", "ode-slide.png");
const sourceBytes = await readFile(filePath);
const image = validateImage({
  basename: path.basename(filePath),
  declaredMimeType: "image/png",
  bytes: sourceBytes,
});
const runtime = new FoundryRecorderRuntime();
const controller = new RecorderController(runtime);
let pcm: Uint8Array | null = null;
try {
  await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  const initialTranscript = controller.bootstrap().transcript;
  const chat = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: chatUserPrompt(
        "What is an ordinary differential equation? Answer in one sentence.",
        buildAssistantContext(initialTranscript, null),
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

  pcm = await loadFixturePcm();
  const whisper = await controller.transcribeCapture({
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs: audioDurationMsFromPcmBytes(pcm.byteLength),
    data: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  });
  assert.ok(whisper.result.transcript.trim(), "Whisper must return a final transcript.");

  controller.editTranscript(PROBLEMATIC_TRANSCRIPT);
  const summary = await controller.generateSummary();
  assert.equal(summary.summaryInput, PROBLEMATIC_TRANSCRIPT);
  assert.ok(summary.snapshot.transcript.summary !== null, "Qwen must store the reviewed-final summary.");

  const context = buildImageAnalysisContext(summary.snapshot.transcript);
  const result = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: imageAnalysisPrompt(context),
      images: [{ kind: "data", format: "png", data: image.bytes }],
    },
    {
      requestOptions: {
        search: {
          doSample: false,
          temperature: 0,
          seed: 42,
          earlyStopping: true,
          maxOutputTokens: 180,
        },
        toolChoice: "none",
        additionalOptions: {
          chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
        },
      },
    },
  );
  const note = parseImageAnalysisNote(result.text);
  assert.match(
    `${note.visibleTextAndObjects} ${note.relationToLesson}`.toLowerCase(),
    /(ordinary differential|ode|dy\/dt|derivative)/,
  );
  assert.equal(result.model.modelId, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
  assert.equal(result.model.source, "vision_slot");
  assert.equal(result.response.finishReason, "stop");
  console.log(
    `VISION_REPETITION_REGRESSION_OK ${JSON.stringify({
      sequence: ["text_chat", "whisper_final", "qwen_summary", "image_analysis"],
      chatFinishReason: chat.response.finishReason,
      nativeWhisperFinal: whisper.result.transcript,
      reviewedWhisperFinal: PROBLEMATIC_TRANSCRIPT,
      summaryVersion: summary.snapshot.transcript.summary?.transcriptVersion,
      imageFinishReason: result.response.finishReason,
      note,
    })}`,
  );
  console.log(
    `VISION_INTEGRATION_OK ${JSON.stringify({
      model: result.model,
      note,
      exactCpuShape,
      usage: result.response.usage,
      fixture: {
        basename: image.basename,
        width: image.width,
        height: image.height,
        sizeBytes: image.sizeBytes,
      },
    })}`,
  );
} finally {
  pcm?.fill(0);
  sourceBytes.fill(0);
  image.bytes.fill(0);
  await controller.shutdown();
}
