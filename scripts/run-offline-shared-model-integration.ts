import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type FoundryLocalConfig, FoundryLocalManager, type IModel } from "foundry-local-sdk";
import { buildAssistantContext, buildImageAnalysisContext } from "../src/assistant/assistant-context";
import {
  assistantSystemPrompt,
  chatUserPrompt,
  imageAnalysisPrompt,
} from "../src/assistant/assistant-prompts";
import { validateImage } from "../src/assistant/image-security";
import { formatAssistantPlainText } from "../src/assistant/plain-text";
import { FoundryRecorderRuntime } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";
import { SUMMARY_DEVICE_TYPE, SUMMARY_EXECUTION_PROVIDER } from "../src/foundry/runtime-config";
import { parseImageAnalysisNote } from "../src/main/assistant-controller";
import { RecorderController } from "../src/main/recorder-controller";
import { prepareFixtureInferenceImage } from "./integration-image";
import { assertSummaryDisplayText } from "./integration-utils";
import { SUMMARY_FACT_CONTRACTS, summaryFactViolations } from "./summary-fact-contract";

assert.equal(
  process.platform,
  "win32",
  "The prepared offline shared-model gate must run on the target Windows machine.",
);

let offline = false;
let nativeManager: FoundryLocalManager | null = null;
const blockedAcquisitionAttempts: string[] = [];
let peakRssBytes = process.memoryUsage().rss;
const rssTimer = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 25);
rssTimer.unref?.();
const runtime = new FoundryRecorderRuntime({
  createManager: (config: FoundryLocalConfig) => {
    const manager = FoundryLocalManager.create(config);
    nativeManager = manager;
    return {
      catalog: {
        getCachedModels: async (): Promise<IModel[]> => {
          blockWhenOffline("catalog.getCachedModels");
          return manager.catalog.getCachedModels();
        },
        getModelVariant: async (modelId: string): Promise<IModel> => {
          blockWhenOffline(`catalog.getModelVariant:${modelId}`);
          return manager.catalog.getModelVariant(modelId);
        },
      },
      get urls() {
        return manager.urls;
      },
      get isWebServiceRunning() {
        return manager.isWebServiceRunning;
      },
      discoverEps: () => manager.discoverEps(),
      downloadAndRegisterEps: async (names: string[], progress: (name: string, percent: number) => void) => {
        blockWhenOffline(`manager.downloadAndRegisterEps:${names.join(",")}`);
        return manager.downloadAndRegisterEps(names, progress);
      },
      shutdown: () => manager.shutdown(),
      dispose: () => manager.dispose(),
    };
  },
});
const controller = new RecorderController(runtime);
const transcript =
  "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
const odeFactContract = SUMMARY_FACT_CONTRACTS.find(({ id }) => id === "ode");
if (odeFactContract === undefined) {
  throw new Error("The ODE summary fact contract is unavailable.");
}
let sourceBytes: Uint8Array | null = null;
let imageBytes: Uint8Array | null = null;
let inferenceImageBytes: Uint8Array | null = null;

try {
  const prepareStartedAt = performance.now();
  const prepared = await controller.prepare({ enableLiveCaptions: false }, (event) =>
    process.stdout.write(`${event.detail}\n`),
  );
  const prepareMs = Math.round(performance.now() - prepareStartedAt);
  const rssAfterPrepareBytes = process.memoryUsage().rss;
  expectThreeReady(prepared.snapshot);
  assert.equal(prepared.snapshot.readiness.summary.model?.id, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
  assert.equal(prepared.snapshot.readiness.summary.model?.deviceType, SUMMARY_DEVICE_TYPE);
  assert.equal(prepared.snapshot.readiness.summary.model?.executionProvider, SUMMARY_EXECUTION_PROVIDER);
  offline = true;

  controller.editTranscript(transcript);
  const summaryStartedAt = performance.now();
  const summary = await controller.generateSummary();
  const summaryWallMs = Math.round(performance.now() - summaryStartedAt);
  const visibleSummary = summary.snapshot.transcript.summary?.text ?? "";
  assertSummaryDisplayText(visibleSummary);
  assert.ok(
    visibleSummary
      .split("\n")
      .slice(1)
      .every((line) => line.startsWith("• ")),
  );
  assert.deepEqual(summaryFactViolations(odeFactContract, visibleSummary), []);

  const askStartedAt = performance.now();
  const ask = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: chatUserPrompt(
        "What is ODE? Answer in one sentence.",
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
  const askMs = Math.round(performance.now() - askStartedAt);
  assert.equal(ask.response.finishReason, "stop");
  assert.match(formatAssistantPlainText(ask.text), /(ordinary differential equation|ODE)/iu);

  sourceBytes = await readFile(path.resolve("fixtures", "ode-slide.png"));
  const image = validateImage({
    basename: "ode-slide.png",
    declaredMimeType: "image/png",
    bytes: sourceBytes,
  });
  imageBytes = image.bytes;
  const inferenceImage = await prepareFixtureInferenceImage(path.resolve("fixtures", "ode-slide.png"), image);
  inferenceImageBytes = inferenceImage.bytes;
  const imageContext = buildImageAnalysisContext(summary.snapshot.transcript);
  const imageStartedAt = performance.now();
  const analysis = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: imageAnalysisPrompt(imageContext),
      images: [{ kind: "data", format: inferenceImage.format, data: inferenceImage.bytes }],
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
  const imageMs = Math.round(performance.now() - imageStartedAt);
  const note = parseImageAnalysisNote(analysis.text);
  assert.match(
    `${note.visibleTextAndObjects} ${note.relationToLesson}`,
    /(ordinary differential|dy\/dt|derivative|decay)/iu,
  );

  const sequentialReuseStartedAt = performance.now();
  const repeatedSummary = await runtime.summarize(transcript);
  const repeatedAsk = await runtime.runAssistantTurn(
    {
      systemPrompt: assistantSystemPrompt("classroom"),
      prompt: chatUserPrompt(
        "What is ODE? Answer in one sentence.",
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
  assert.equal(repeatedSummary.response.finishReason, "stop");
  assert.equal(repeatedAsk.response.finishReason, "stop");
  assert.deepEqual(blockedAcquisitionAttempts, []);
  expectThreeReady(controller.bootstrap());
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

  console.log(
    `OFFLINE_SHARED_MODEL_OK ${JSON.stringify({
      modelId: prepared.snapshot.readiness.summary.model?.id,
      summary: visibleSummary,
      ask: formatAssistantPlainText(ask.text),
      imageNote: note,
      inferenceImage: {
        width: inferenceImage.width,
        height: inferenceImage.height,
        sizeBytes: inferenceImage.sizeBytes,
      },
      prepareMs,
      rssAfterPrepareBytes,
      peakRssBytes,
      summaryWallMs,
      summaryGenerationMs: summary.snapshot.transcript.summary?.durationMs ?? null,
      askMs,
      imageMs,
      sequentialReuseWallMs: Math.round(performance.now() - sequentialReuseStartedAt),
      catalogOrProviderAttemptsAfterPrepare: blockedAcquisitionAttempts.length,
      managerDisposedBeforeShutdown: disposedState(nativeManager),
    })}`,
  );
} finally {
  clearInterval(rssTimer);
  sourceBytes?.fill(0);
  imageBytes?.fill(0);
  inferenceImageBytes?.fill(0);
  await controller.shutdown();
}

function blockWhenOffline(operation: string): void {
  if (!offline) {
    return;
  }
  blockedAcquisitionAttempts.push(operation);
  throw new Error(`Offline guard blocked post-Prepare acquisition: ${operation}`);
}

function expectThreeReady(snapshot: ReturnType<RecorderController["bootstrap"]>): void {
  expectReady(snapshot.readiness.whisper.status, "Whisper");
  expectReady(snapshot.readiness.nemotron.status, "Nemotron");
  expectReady(snapshot.readiness.summary.status, "Shared Qwen");
}

function expectReady(status: string, role: string): void {
  assert.equal(status, "ready", `${role} must remain ready.`);
}

function disposedState(manager: FoundryLocalManager | null): boolean | null {
  return manager?.disposed ?? null;
}
