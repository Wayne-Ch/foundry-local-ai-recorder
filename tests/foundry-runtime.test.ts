import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AudioClient,
  ChatClient,
  EmbeddingClient,
  EpDownloadResult,
  EpInfo,
  IModel,
  ModelInfo,
  Request,
  RequestPreflightResult,
  Response,
  StreamingResponse,
} from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_FORMAT,
  AUDIO_SAMPLE_RATE,
  AUDIO_STREAM_CHUNK_BYTES,
  NEMOTRON_AUDIO_MODEL_ID,
  type ValidatedAudioCapture,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { TempAudioStore } from "../src/audio/temp-audio-store";
import { FoundryRecorderRuntime, type FoundryRecorderRuntimeOptions } from "../src/foundry/foundry-runtime";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { toSafeDiagnostic } from "../src/shared/safe-diagnostic";
import { summaryUserPrompt } from "../src/summary/summary-prompt";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FoundryRecorderRuntime", () => {
  it("reports runtime initialization before the first awaited setup step", async () => {
    const root = await createTempRoot();
    const paths = deferred<ReturnType<typeof pathsFor>>();
    const manager = new FakeManager(createModels());
    const progress: Array<{ readonly stage: string; readonly role?: string }> = [];
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: () => paths.promise,
      createManager: () => manager,
      assertNativeRuntime: () => {},
      createAudioSession: () => fakeAudioSession(),
      createChatSession: () => fakeChatSession(),
    });

    const preparing = runtime.prepare(false, (event) => {
      progress.push({
        stage: event.stage,
        ...(event.role === undefined ? {} : { role: event.role }),
      });
    });

    expect(progress).toEqual([{ stage: "initializing_runtime" }]);
    paths.resolve(pathsFor(root));
    await preparing;
    await runtime.shutdown();
  });

  it("reports catalog and cache waits before their promises settle", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const whisper = models.get(WHISPER_AUDIO_MODEL_ID);
    if (whisper === undefined) {
      throw new Error("Expected fake Whisper model.");
    }
    const catalog = deferred<IModel>();
    const cache = deferred<IModel[]>();
    vi.mocked(manager.catalog.getModelVariant).mockImplementation(async (modelId) => {
      if (modelId === WHISPER_AUDIO_MODEL_ID) {
        return catalog.promise;
      }
      const model = models.get(modelId);
      if (model === undefined) {
        throw new Error(`Unknown fake model ${modelId}`);
      }
      return model;
    });
    vi.mocked(manager.catalog.getCachedModels).mockReturnValue(cache.promise);
    const progress: Array<{
      readonly stage: string;
      readonly role?: string;
      readonly status?: string;
      readonly detail?: string;
    }> = [];
    const runtime = createRuntime(root, [manager]);
    const preparing = runtime.prepare(false, (event) => {
      progress.push({
        stage: event.stage,
        ...(event.role === undefined ? {} : { role: event.role }),
        ...(event.role === undefined
          ? {}
          : {
              status: event.readiness[event.role].status,
              detail: event.readiness[event.role].detail,
            }),
      });
    });

    await vi.waitFor(() =>
      expect(progress).toContainEqual(
        expect.objectContaining({ stage: "checking_catalog", role: "whisper" }),
      ),
    );
    catalog.reject(new Error("catalog unavailable"));
    await vi.waitFor(() =>
      expect(progress).toContainEqual(expect.objectContaining({ stage: "checking_cache", role: "whisper" })),
    );
    expect(
      progress.find(({ stage, role }) => stage === "checking_cache" && role === "whisper"),
    ).toMatchObject({
      status: "checking",
      detail: expect.stringContaining("checking the local cache"),
    });
    cache.resolve([...models.values()]);
    await preparing;

    expect(runtime.readiness.whisper.status).toBe("ready");
    await runtime.shutdown();
  });

  it("keeps the shared model card truthful through download, provider check, loading, and ready", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const summary = models.get(SUMMARY_MODEL_ID);
    if (summary === undefined) {
      throw new Error("Expected fake summary model.");
    }
    summary.cached = false;
    const manager = new FakeManager(models);
    const progress: Array<{
      readonly stage: string;
      readonly status: string;
      readonly detail: string;
      readonly cached: boolean;
      readonly loaded: boolean;
    }> = [];
    const runtime = createRuntime(root, [manager]);

    await runtime.prepare(false, (event) => {
      if (event.role !== "summary") {
        return;
      }
      const readiness = event.readiness.summary;
      progress.push({
        stage: event.stage,
        status: readiness.status,
        detail: readiness.detail,
        cached: readiness.cached,
        loaded: readiness.loaded,
      });
    });

    expect(progress.find(({ stage }) => stage === "checking_catalog")).toMatchObject({
      status: "checking",
      detail: expect.stringContaining("Resolving exact summary model"),
      loaded: false,
    });
    expect(progress.find(({ stage }) => stage === "downloading_model")).toMatchObject({
      status: "downloading",
      detail: expect.stringContaining("Downloading"),
      cached: false,
      loaded: false,
    });
    expect(progress.find(({ stage }) => stage === "checking_provider")).toMatchObject({
      status: "checking",
      detail: expect.stringContaining("Checking"),
      cached: true,
      loaded: false,
    });
    expect(progress.find(({ stage }) => stage === "registering_provider")).toBeUndefined();
    expect(progress.find(({ stage }) => stage === "loading_model")).toMatchObject({
      status: "loading",
      detail: expect.stringContaining("Loading"),
      cached: true,
      loaded: false,
    });
    expect(progress.find(({ stage }) => stage === "model_ready")).toMatchObject({
      status: "ready",
      detail: expect.stringContaining("ready"),
      cached: true,
      loaded: true,
    });
    await runtime.shutdown();
  });

  it("prepares Whisper, Nemotron, and shared Qwen even when live captions are toggled off", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const readyRoles: string[] = [];
    const runtime = createRuntime(root, [manager]);

    const prepared = await runtime.prepare(false, (event) => {
      if (event.stage === "model_ready" && event.role !== undefined) {
        readyRoles.push(event.role);
      }
    });

    expect(readyRoles).toEqual(["whisper", "nemotron", "summary"]);
    expect(prepared.readiness).toMatchObject({
      whisper: { status: "ready", loaded: true },
      nemotron: { status: "ready", loaded: true },
      summary: { status: "ready", loaded: true },
    });
    expect(prepared.liveCaptionsAvailable).toBe(true);
    await runtime.shutdown();
  });

  it("keeps recorder and shared Qwen ready when optional Nemotron preparation fails", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const nemotron = models.get(NEMOTRON_AUDIO_MODEL_ID);
    if (nemotron === undefined) {
      throw new Error("Expected fake Nemotron model.");
    }
    vi.spyOn(nemotron, "load").mockRejectedValue(new Error("Nemotron load failed"));
    const runtime = createRuntime(root, [new FakeManager(models)]);

    const prepared = await runtime.prepare(false);

    expect(prepared.liveCaptionsAvailable).toBe(false);
    expect(prepared.liveCaptionsFailure).not.toBeNull();
    expect(prepared.readiness).toMatchObject({
      whisper: { status: "ready", loaded: true },
      nemotron: { status: "error", loaded: false },
      summary: { status: "ready", loaded: true },
    });
    await runtime.shutdown();
  });

  it("performs no catalog lookup or model download after Prepare for summary or assistant work", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const downloads = [...models.values()].map((model) => vi.spyOn(model, "download"));
    const runtime = createRuntime(root, [manager], {
      createChatSession: () =>
        fakeChatSession({
          processRequest: async (request) => {
            const text = Array.from({ length: request.itemCount }, (_value, index) => {
              const item = request.getItem(index);
              return item.type === "message" && typeof item.content === "string" ? item.content : "";
            }).join("\n");
            return textResponse(
              text.includes("FINAL TRANSCRIPT:") ? "Exact factual summary." : "One sentence answer.",
            );
          },
        }),
    });
    await runtime.prepare(false);
    const catalogCalls = vi.mocked(manager.catalog.getModelVariant).mock.calls.length;
    const downloadCalls = downloads.map(({ mock }) => mock.calls.length);

    await expect(runtime.summarize("Exact transcript.")).resolves.toMatchObject({
      text: "Exact factual summary.",
    });
    await expect(runtime.runAssistantTurn({ prompt: "Question." })).resolves.toMatchObject({
      text: "One sentence answer.",
    });

    expect(vi.mocked(manager.catalog.getModelVariant)).toHaveBeenCalledTimes(catalogCalls);
    expect(downloads.map(({ mock }) => mock.calls.length)).toEqual(downloadCalls);
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.shutdown();
  });

  it.each([
    {
      name: "catalog and cache lookup",
      role: "whisper" as const,
      phase: "cache_lookup" as const,
      arrange(manager: FakeManager) {
        vi.mocked(manager.catalog.getModelVariant).mockRejectedValue(new Error("catalog failed"));
        vi.mocked(manager.catalog.getCachedModels).mockRejectedValue(new Error("cache failed"));
      },
    },
    {
      name: "model download",
      role: "whisper" as const,
      phase: "model_download" as const,
      arrange(_manager: FakeManager, models: ReadonlyMap<string, FakeModel>) {
        const model = models.get(WHISPER_AUDIO_MODEL_ID);
        if (model === undefined) {
          throw new Error("Expected fake Whisper model.");
        }
        model.cached = false;
        vi.spyOn(model, "download").mockRejectedValue(new Error("download failed"));
      },
    },
    {
      name: "model load",
      role: "whisper" as const,
      phase: "model_load" as const,
      arrange(_manager: FakeManager, models: ReadonlyMap<string, FakeModel>) {
        const model = models.get(WHISPER_AUDIO_MODEL_ID);
        if (model === undefined) {
          throw new Error("Expected fake Whisper model.");
        }
        vi.spyOn(model, "load").mockRejectedValue(new Error("load failed"));
      },
    },
  ])("returns safe role and phase metadata for $name failure", async ({ arrange, role, phase }) => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    arrange(manager, models);
    const runtime = createRuntime(root, [manager]);

    const failure = await captureFailure(runtime.prepare(false));
    const diagnostic = toSafeDiagnostic(failure, "LOCAL_OPERATION_FAILED");

    expect(diagnostic).toMatchObject({
      code: "MODEL_PREPARATION_FAILED",
      context: {
        operation: "prepare",
        modelRole: role,
        phase,
      },
    });
    expect(runtime.readiness[role]).toMatchObject({
      status: "error",
      loaded: false,
    });
    expect(runtime.readiness[role].detail).toContain(`model=${role}`);
    expect(runtime.readiness[role].detail).toContain(`phase=${phase}`);
    await runtime.shutdown().catch(() => undefined);
  });

  it("preserves exact Whisper text through the controller and exact Qwen prompt input", async () => {
    const root = await createTempRoot();
    const exact = "  First line.\r\nSecond  line — café 東京!\n\nSymbols: ∑, →, “quoted”.  ";
    const rawSummary = "\n  Summary with exact outer whitespace.  \n";
    let summaryPrompt = "";
    const manager = new FakeManager(createModels());
    const runtime = createRuntime(root, [manager], {
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async () => speechResponse(exact),
        }),
      createChatSession: () =>
        fakeChatSession({
          processRequest: async (request) => {
            const userMessage = request.getItem(1);
            if (userMessage.type !== "message" || typeof userMessage.content !== "string") {
              throw new Error("Expected a text user message.");
            }
            summaryPrompt = userMessage.content;
            return textResponse(rawSummary);
          },
        }),
    });
    const controller = new RecorderController(runtime);

    try {
      await controller.prepare({ enableLiveCaptions: false });
      const final = await controller.transcribeCapture(capturePayload());
      const summary = await controller.generateSummary();

      expect(final.result.transcript).toBe(exact);
      expect(final.snapshot.transcript.finalText).toBe(exact);
      expect(summary.summaryInput).toBe(exact);
      expect(summaryPrompt).toBe(summaryUserPrompt(exact));
      expect(summary.snapshot.transcript.summary?.text).toBe("Summary with exact outer whitespace.");
      expect(summary.snapshot.trace.find((entry) => entry.phase === "summary-raw")).toMatchObject({
        detail: rawSummary,
        summaryDisplayFormattingApplied: true,
      });
      expect(await ownedTempFiles(root)).toEqual([]);
    } finally {
      await controller.shutdown();
    }
  });

  it("disposes a guard-failed manager and reruns the endpoint guard on retry", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models, { urls: ["http://127.0.0.1:5272"] });
    const accepted = new FakeManager(models);
    const runtime = createRuntime(root, [rejected, accepted]);

    const firstFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(firstFailure)).toContainEqual(expect.stringContaining("endpoint guard"));
    expect(toSafeDiagnostic(firstFailure, "LOCAL_OPERATION_FAILED")).toMatchObject({
      code: "ENDPOINT_VALIDATION_FAILED",
      context: {
        operation: "prepare",
        phase: "endpoint_validation",
      },
    });
    expect(rejected.shutdown).toHaveBeenCalledOnce();
    expect(rejected.dispose).toHaveBeenCalledOnce();
    expect(rejected.catalog.getModelVariant).not.toHaveBeenCalled();

    const prepared = await runtime.prepare(false);

    expect(prepared.readiness.inProcessModeValidated).toBe(true);
    expect(prepared.readiness.embeddedWebServiceRunning).toBe(false);
    expect(prepared.readiness.embeddedWebServiceUrls).toEqual([]);
    expect(accepted.catalog.getModelVariant).toHaveBeenCalled();
    await runtime.shutdown();
  });

  it("disposes a manager whose embedded service is already running", async () => {
    const root = await createTempRoot();
    const rejected = new FakeManager(createModels(), { isWebServiceRunning: true });
    const runtime = createRuntime(root, [rejected]);

    const firstFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(firstFailure)).toContainEqual(expect.stringContaining("endpoint guard"));

    expect(rejected.shutdown).toHaveBeenCalledOnce();
    expect(rejected.dispose).toHaveBeenCalledOnce();
    expect(runtime.readiness.inProcessModeValidated).toBe(false);
    expect(runtime.readiness.embeddedWebServiceRunning).toBe(true);
  });

  it("quarantines a guard-rejected manager while shutdown and disposal keep failing", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models, { urls: ["http://127.0.0.1:5272"] });
    const accepted = new FakeManager(models);
    vi.mocked(rejected.shutdown).mockImplementation(() => {
      throw new Error("manager shutdown failed");
    });
    vi.mocked(rejected.dispose).mockImplementation(() => {
      throw new Error("manager dispose failed");
    });
    const runtime = createRuntime(root, [rejected, accepted]);

    const firstFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(firstFailure)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("endpoint guard"),
        "manager shutdown failed",
        "manager dispose failed",
      ]),
    );
    expect(runtime.readiness).toMatchObject({
      inProcessModeValidated: false,
      cleanup: {
        state: "manager_cleanup_required",
        required: true,
        completionPending: false,
      },
    });

    const retryFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(retryFailure)).toEqual(
      expect.arrayContaining(["manager shutdown failed", "manager dispose failed"]),
    );
    expect(rejected.shutdown).toHaveBeenCalledTimes(2);
    expect(rejected.dispose).toHaveBeenCalledTimes(2);
    expect(accepted.catalog.getModelVariant).not.toHaveBeenCalled();
    expect(runtime.readiness.inProcessModeValidated).toBe(false);
  });

  it("retries quarantined manager cleanup once for concurrent Prepare calls before creating a manager", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models, { urls: ["http://127.0.0.1:5272"] });
    const accepted = new FakeManager(models);
    vi.mocked(rejected.shutdown)
      .mockImplementationOnce(() => {
        throw new Error("manager shutdown failed once");
      })
      .mockImplementation(() => {});
    vi.mocked(rejected.dispose)
      .mockImplementationOnce(() => {
        throw new Error("manager dispose failed once");
      })
      .mockImplementation(() => {});
    const runtime = createRuntime(root, [rejected, accepted]);

    const firstFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(firstFailure)).toContainEqual(expect.stringContaining("endpoint guard"));
    const firstRetry = runtime.prepare(false);
    const concurrentRetry = runtime.prepare(false);

    expect(concurrentRetry).toBe(firstRetry);
    const [first, second] = await Promise.all([firstRetry, concurrentRetry]);
    expect(first).toBe(second);
    expect(first.readiness).toMatchObject({
      inProcessModeValidated: true,
      cleanup: { state: "none", required: false },
    });
    expect(rejected.shutdown).toHaveBeenCalledTimes(2);
    expect(rejected.dispose).toHaveBeenCalledTimes(2);
    expect(accepted.catalog.getModelVariant).toHaveBeenCalledWith(WHISPER_AUDIO_MODEL_ID);
    await runtime.shutdown();
  });

  it("retries and confirms quarantined manager cleanup during shutdown without creating a replacement", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models, { urls: ["http://127.0.0.1:5272"] });
    const accepted = new FakeManager(models);
    vi.mocked(rejected.shutdown).mockImplementationOnce(() => {
      throw new Error("manager shutdown failed once");
    });
    vi.mocked(rejected.dispose).mockImplementationOnce(() => {
      throw new Error("manager dispose failed once");
    });
    const runtime = createRuntime(root, [rejected, accepted]);

    const firstFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(firstFailure)).toContainEqual(expect.stringContaining("endpoint guard"));
    await runtime.shutdown();

    expect(rejected.shutdown).toHaveBeenCalledTimes(2);
    expect(rejected.dispose).toHaveBeenCalledTimes(2);
    expect(accepted.catalog.getModelVariant).not.toHaveBeenCalled();
    expect(runtime.readiness).toMatchObject({
      inProcessModeValidated: false,
      cleanup: { state: "none", required: false, completionPending: false },
    });
  });

  it("blocks new inference when an embedded service becomes active", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    const createAudioSession = vi.fn(() => fakeAudioSession());
    const runtime = createRuntime(root, [manager], { createAudioSession });
    await runtime.prepare(false);
    manager.isWebServiceRunning = true;

    await expect(runtime.transcribeCapture(validatedCapture())).rejects.toThrow("endpoint guard");
    expect(createAudioSession).not.toHaveBeenCalled();
    expect(runtime.readiness.inProcessModeValidated).toBe(false);
    expect(runtime.readiness.embeddedWebServiceRunning).toBe(true);
    await runtime.shutdown();
  });

  it("retains stale models until unload succeeds before disposing a quarantined manager", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models);
    const accepted = new FakeManager(models);
    const runtime = createRuntime(root, [rejected, accepted]);
    const whisper = models.get(WHISPER_AUDIO_MODEL_ID);
    const summary = models.get(SUMMARY_MODEL_ID);
    if (whisper === undefined || summary === undefined) {
      throw new Error("Expected fake models.");
    }
    const whisperLoad = vi.spyOn(whisper, "load");
    await runtime.prepare(false);

    rejected.urls = ["http://127.0.0.1:5272"];
    vi.spyOn(whisper, "isLoaded").mockRejectedValueOnce(new Error("isLoaded cleanup failed"));
    vi.spyOn(whisper, "unload").mockRejectedValueOnce(new Error("stale refresh unload failed"));
    vi.spyOn(summary, "unload").mockRejectedValueOnce(new Error("summary unload failed"));
    vi.mocked(rejected.dispose).mockImplementationOnce(() => {
      throw new Error("manager dispose failed");
    });

    const cleanupFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(cleanupFailure)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("endpoint guard"),
        "isLoaded cleanup failed",
        "summary unload failed",
      ]),
    );
    expect(rejected.shutdown).not.toHaveBeenCalled();
    expect(rejected.dispose).not.toHaveBeenCalled();
    expect(runtime.readiness.whisper).toMatchObject({
      model: null,
      status: "error",
      loaded: false,
    });
    expect(runtime.readiness.summary).toMatchObject({
      model: null,
      status: "error",
      loaded: false,
    });

    const staleRetryFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(staleRetryFailure)).toContain("stale refresh unload failed");
    expect(rejected.shutdown).not.toHaveBeenCalled();
    expect(rejected.dispose).not.toHaveBeenCalled();
    expect(runtime.readiness.whisper).toMatchObject({
      model: null,
      status: "error",
      loaded: false,
    });
    expect(accepted.catalog.getModelVariant).not.toHaveBeenCalled();

    const managerRetryFailure = await captureFailure(runtime.prepare(false));
    expect(errorMessages(managerRetryFailure)).toContain("manager dispose failed");
    expect(rejected.shutdown).toHaveBeenCalledOnce();
    expect(rejected.dispose).toHaveBeenCalledOnce();
    expect(accepted.catalog.getModelVariant).not.toHaveBeenCalled();

    const prepared = await runtime.prepare(false);
    expect(rejected.dispose).toHaveBeenCalledTimes(2);
    expect(accepted.catalog.getModelVariant).toHaveBeenCalledWith(WHISPER_AUDIO_MODEL_ID);
    expect(prepared.readiness.whisper.status).toBe("ready");
    expect(prepared.readiness.summary.status).toBe("ready");
    expect(whisperLoad).toHaveBeenCalledTimes(2);
    await runtime.shutdown();
  });

  it("reports fail-closed readiness while endpoint-guard cleanup is still settling", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const rejected = new FakeManager(models);
    const accepted = new FakeManager(models);
    const runtime = createRuntime(root, [rejected, accepted]);
    await runtime.prepare(false);

    const whisper = models.get(WHISPER_AUDIO_MODEL_ID);
    if (whisper === undefined) {
      throw new Error("Expected fake Whisper model.");
    }
    const loadedProbe = deferred<boolean>();
    const isLoaded = vi.spyOn(whisper, "isLoaded").mockImplementationOnce(() => loadedProbe.promise);
    rejected.urls = ["http://127.0.0.1:5272"];

    const guardFailure = runtime.prepare(false);
    await vi.waitFor(() => expect(isLoaded).toHaveBeenCalled());

    expect(runtime.readiness.whisper).toMatchObject({
      model: null,
      status: "error",
      loaded: false,
    });
    await expect(runtime.transcribeCapture(validatedCapture())).rejects.toThrow(
      "recovering from an endpoint guard failure",
    );

    loadedProbe.resolve(true);
    await expect(guardFailure).rejects.toThrow("endpoint guard");
    await expect(runtime.prepare(false)).resolves.toMatchObject({
      readiness: {
        whisper: { status: "ready" },
        summary: { status: "ready" },
      },
    });
    await runtime.shutdown();
  });

  it("surfaces locked startup audio retention without exposing the root path", async () => {
    const secretRoot = "C:\\Users\\someone\\private\\recorder-audio";
    let removeCalls = 0;
    const store = new TempAudioStore(secretRoot, {
      listFiles: async () => ["capture-locked.wav"],
      remove: async () => {
        removeCalls += 1;
        if (removeCalls === 1) {
          throw Object.assign(new Error("file is busy"), { code: "EBUSY" });
        }
      },
    });
    const manager = new FakeManager(createModels());
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(secretRoot),
      createManager: () => manager,
      createAudioSession: () => fakeAudioSession(),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
    });
    const controller = new RecorderController(runtime);

    const prepared = await controller.prepare({ enableLiveCaptions: false });
    const warning = prepared.snapshot.trace.find((entry) => entry.phase === "startup-audio-retained");

    expect(prepared.snapshot.readiness.audioRecovery).toMatchObject({
      discovered: 1,
      removed: 0,
      retained: 1,
    });
    expect(warning?.severity).toBe("warning");
    expect(warning?.detail).toContain("Delete / reset");
    expect(warning?.detail).not.toContain(secretRoot);

    await controller.reset();
    expect(removeCalls).toBe(2);
    expect(controller.bootstrap().readiness.audioRecovery).toMatchObject({
      removed: 1,
      retained: 0,
    });
    await controller.shutdown();
  });

  it("settles and disposes a failed Nemotron stream without an unhandled rejection", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    let releaseStreamFailure = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseStreamFailure = resolve;
    });
    const response = gate.then(() => {
      throw new Error("native response failed");
    });
    const stream: StreamingResponse = {
      response,
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            await gate;
            throw new Error("native pump failed");
          },
        };
      },
    };
    const dispose = vi.fn();
    const runtime = createRuntime(root, [manager], {
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({
              processStreamingRequest: () => stream,
              dispose,
            })
          : fakeAudioSession(),
    });
    await runtime.prepare(true);
    const started = await runtime.startLiveStream(() => {});
    for (let sequence = 0; sequence < 3; sequence += 1) {
      runtime.appendLiveChunk(started.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }
    releaseStreamFailure();

    await expect(
      runtime.finishLiveStream({
        streamId: started.streamId,
        lastSequence: 2,
        audioDurationMs: 300,
      }),
    ).rejects.toThrow("native");

    expect(dispose).toHaveBeenCalledOnce();
    await expect(runtime.cancelLiveStream(started.streamId)).resolves.toBeUndefined();
    expect(() =>
      runtime.appendLiveChunk(started.streamId, 3, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)),
    ).toThrow("no longer active");
    await runtime.shutdown();
  });

  it("disposes a partially created Nemotron session when request cancellation throws", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    const dispose = vi.fn();
    const runtime = createRuntime(root, [manager], {
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({
              processStreamingRequest: (request) => {
                vi.spyOn(request, "cancel").mockImplementation(() => {
                  throw new Error("Nemotron start cancel failed");
                });
                throw new Error("Nemotron stream creation failed");
              },
              dispose,
            })
          : fakeAudioSession(),
    });
    await runtime.prepare(true);

    const failure = await captureFailure(runtime.startLiveStream(() => {}));

    expect(errorMessages(failure)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Nemotron stream creation failed"),
        "Nemotron start cancel failed",
      ]),
    );
    expect(dispose).toHaveBeenCalledOnce();
    await runtime.shutdown();
  });

  it("disposes the Nemotron session when terminal request cancellation throws", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    const dispose = vi.fn();
    const runtime = createRuntime(root, [manager], {
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({
              processStreamingRequest: (request) => {
                vi.spyOn(request, "cancel").mockImplementation(() => {
                  throw new Error("Nemotron terminal cancel failed");
                });
                return completedAudioStream("Nemotron terminal");
              },
              dispose,
            })
          : fakeAudioSession(),
    });
    await runtime.prepare(true);
    const started = await runtime.startLiveStream(() => {});
    for (let sequence = 0; sequence < 3; sequence += 1) {
      runtime.appendLiveChunk(started.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }

    await expect(
      runtime.finishLiveStream({
        streamId: started.streamId,
        lastSequence: 2,
        audioDurationMs: 300,
      }),
    ).rejects.toThrow("Nemotron terminal cancel failed");

    expect(dispose).toHaveBeenCalledOnce();
    await expect(runtime.cancelLiveStream(started.streamId)).resolves.toBeUndefined();
    await runtime.shutdown();
  });

  it("preserves Whisper process and cleanup failures while still deleting temporary audio", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    const dispose = vi.fn(() => {
      throw new Error("Whisper session dispose failed");
    });
    const runtime = createRuntime(root, [manager], {
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async (request) => {
            vi.spyOn(request, "cancel").mockImplementation(() => {
              throw new Error("Whisper request cancel failed");
            });
            throw new Error("Whisper native process failed");
          },
          dispose,
        }),
    });
    await runtime.prepare(false);

    const failure = await captureFailure(runtime.transcribeCapture(validatedCapture()));

    expect(errorMessages(failure)).toEqual(
      expect.arrayContaining([
        "Whisper native process failed",
        "Whisper request cancel failed",
        "Whisper session dispose failed",
      ]),
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(await ownedTempFiles(root)).toEqual([]);
    await runtime.shutdown();
  });

  it("preserves Qwen process and cleanup failures while settling the tracked operation", async () => {
    const root = await createTempRoot();
    const manager = new FakeManager(createModels());
    const dispose = vi.fn(() => {
      throw new Error("Qwen session dispose failed");
    });
    const runtime = createRuntime(root, [manager], {
      createChatSession: () =>
        fakeChatSession({
          processRequest: async (request) => {
            vi.spyOn(request, "cancel").mockImplementation(() => {
              throw new Error("Qwen request cancel failed");
            });
            throw new Error("Qwen native process failed");
          },
          dispose,
        }),
    });
    await runtime.prepare(false);

    const failure = await captureFailure(runtime.summarize("Exact transcript"));

    expect(errorMessages(failure)).toEqual(
      expect.arrayContaining([
        "Qwen native process failed",
        "Qwen request cancel failed",
        "Qwen session dispose failed",
      ]),
    );
    expect(dispose).toHaveBeenCalledOnce();
    await runtime.shutdown();
  });

  it("continues Whisper reset teardown when request cancellation throws", async () => {
    const root = await createTempRoot();
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn();
    const manager = new FakeManager(createModels());
    const runtime = createRuntime(root, [manager], {
      settlementTimeoutMs: 1_000,
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async (request) => {
            vi.spyOn(request, "cancel").mockImplementation(() => {
              throw new Error("Whisper reset cancel failed");
            });
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
    });
    await runtime.prepare(false);

    const transcription = runtime.transcribeCapture(validatedCapture());
    await requestReady.promise;
    const reset = runtime.reset();
    responseDeferred.resolve(speechResponse("stale result"));

    await expect(transcription).rejects.toThrow("cancelled");
    await expect(reset).rejects.toThrow("Whisper reset cancel failed");
    expect(dispose).toHaveBeenCalledOnce();
    expect(await ownedTempFiles(root)).toEqual([]);
    await runtime.shutdown();
  });

  it("continues Qwen shutdown teardown when request cancellation throws", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("summary-session-dispose");
    });
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 1_000,
      createChatSession: () =>
        fakeChatSession({
          processRequest: async (request) => {
            vi.spyOn(request, "cancel").mockImplementation(() => {
              throw new Error("Qwen shutdown cancel failed");
            });
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
    });
    await runtime.prepare(false);

    const summary = runtime.summarize("Exact transcript");
    await requestReady.promise;
    const shutdown = runtime.shutdown();
    responseDeferred.resolve(textResponse("stale summary"));

    await expect(summary).rejects.toThrow("cancelled");
    await expect(shutdown).rejects.toThrow("Qwen shutdown cancel failed");
    expect(dispose).toHaveBeenCalledOnce();
    expect(order.indexOf("summary-session-dispose")).toBeLessThan(
      order.findIndex((entry) => entry.startsWith("model-unload:")),
    );
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("cancels and settles in-flight Whisper work before session disposal and temp deletion", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const store = new TempAudioStore(root, {
      remove: async (filePath) => {
        order.push("temp-remove");
        await unlink(filePath);
      },
    });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<Request>();
    let cancelSpy: ReturnType<typeof vi.spyOn> | null = null;
    const manager = new FakeManager(createModels());
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async (request) => {
            order.push("process-start");
            cancelSpy = vi.spyOn(request, "cancel");
            requestReady.resolve(request);
            return responseDeferred.promise;
          },
          dispose: () => {
            order.push("session-dispose");
          },
        }),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
      settlementTimeoutMs: 1_000,
    });
    await runtime.prepare(false);

    const transcription = runtime.transcribeCapture(validatedCapture());
    await requestReady.promise;
    const reset = runtime.reset();
    await vi.waitFor(() => expect(cancelSpy).not.toBeNull());
    await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalled());
    order.push("process-resolve");
    responseDeferred.resolve(speechResponse("stale result"));

    await expect(transcription).rejects.toThrow("cancelled");
    await reset;

    expect(order.indexOf("session-dispose")).toBeGreaterThan(order.indexOf("process-resolve"));
    expect(order.indexOf("temp-remove")).toBeGreaterThan(order.indexOf("session-dispose"));
    expect(store.activeCount).toBe(0);
    expect(await ownedTempFiles(root)).toEqual([]);
    await runtime.shutdown();
  });

  it("settles in-flight Qwen work before model and manager disposal on shutdown", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<Request>();
    let cancelSpy: ReturnType<typeof vi.spyOn> | null = null;
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 1_000,
      createChatSession: () =>
        fakeChatSession({
          processRequest: async (request) => {
            order.push("summary-start");
            cancelSpy = vi.spyOn(request, "cancel");
            requestReady.resolve(request);
            return responseDeferred.promise;
          },
          dispose: () => {
            order.push("summary-session-dispose");
          },
        }),
    });
    await runtime.prepare(false);

    const summary = runtime.summarize("Exact transcript");
    await requestReady.promise;
    const shutdown = runtime.shutdown();
    await vi.waitFor(() => expect(cancelSpy).not.toBeNull());
    await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalled());
    order.push("summary-resolve");
    responseDeferred.resolve(textResponse("stale summary"));

    await expect(summary).rejects.toThrow("cancelled");
    await shutdown;

    expect(order.indexOf("summary-session-dispose")).toBeGreaterThan(order.indexOf("summary-resolve"));
    expect(order.findIndex((entry) => entry.startsWith("model-unload:"))).toBeGreaterThan(
      order.indexOf("summary-session-dispose"),
    );
    expect(order.indexOf("manager-shutdown")).toBeGreaterThan(
      order.findIndex((entry) => entry.startsWith("model-unload:")),
    );
    expect(order.indexOf("manager-dispose")).toBeGreaterThan(order.indexOf("manager-shutdown"));
  });

  it("keeps Whisper temp, model, and manager resources until a timed-out native request settles", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const store = new TempAudioStore(root, {
      remove: async (filePath) => {
        order.push("temp-remove");
        await unlink(filePath);
      },
    });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("whisper-session-dispose");
    });
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async () => {
            order.push("whisper-request-start");
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
      settlementTimeoutMs: 10,
    });
    await runtime.prepare(false);
    order.length = 0;

    const transcription = runtime.transcribeCapture(validatedCapture());
    await requestReady.promise;
    const shutdownFailure = await captureFailure(runtime.shutdown());
    const cleanupCompletion = runtime.cleanupCompletion;

    expect(errorMessages(shutdownFailure)).toContain(
      "Foundry Local shutdown cleanup did not settle within 10 ms.",
    );
    expect(cleanupCompletion).not.toBeNull();
    expect(runtime.readiness).toMatchObject({
      inProcessModeValidated: false,
      cleanup: { state: "draining", required: true, completionPending: true },
    });
    expect(dispose).not.toHaveBeenCalled();
    expect(order).not.toContain("temp-remove");
    expect(order.some((entry) => entry.startsWith("model-unload:"))).toBe(false);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();
    expect(store.activeCount).toBe(1);

    order.push("whisper-request-settled");
    responseDeferred.resolve(speechResponse("stale transcript"));
    await expect(transcription).rejects.toThrow("cancelled");
    await cleanupCompletion;

    expect(dispose).toHaveBeenCalledOnce();
    expect(order.indexOf("whisper-session-dispose")).toBeGreaterThan(
      order.indexOf("whisper-request-settled"),
    );
    expect(order.indexOf("temp-remove")).toBeGreaterThan(order.indexOf("whisper-session-dispose"));
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(store.activeCount).toBe(0);
    expect(runtime.readiness.cleanup).toMatchObject({ state: "none", required: false });
  });

  it("keeps reset fail-closed while delayed Whisper cleanup drains in the background", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const store = new TempAudioStore(root, {
      remove: async (filePath) => {
        order.push("temp-remove");
        await unlink(filePath);
      },
    });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("whisper-session-dispose");
    });
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async () => {
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
      settlementTimeoutMs: 10,
    });
    await runtime.prepare(false);
    order.length = 0;

    const transcription = runtime.transcribeCapture(validatedCapture());
    await requestReady.promise;
    const resetFailure = await captureFailure(runtime.reset());
    const cleanupCompletion = runtime.cleanupCompletion;

    expect(errorMessages(resetFailure)).toContain("Recorder reset cleanup did not settle within 10 ms.");
    expect(runtime.readiness.cleanup).toMatchObject({
      state: "draining",
      required: true,
      completionPending: true,
    });
    await expect(runtime.summarize("blocked")).rejects.toThrow("blocked for cleanup");
    expect(dispose).not.toHaveBeenCalled();
    expect(order).not.toContain("temp-remove");
    expect(store.activeCount).toBe(1);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    responseDeferred.resolve(speechResponse("stale transcript"));
    await expect(transcription).rejects.toThrow("cancelled");
    await cleanupCompletion;

    expect(dispose).toHaveBeenCalledOnce();
    expect(order.indexOf("temp-remove")).toBeGreaterThan(order.indexOf("whisper-session-dispose"));
    expect(store.activeCount).toBe(0);
    expect(order.some((entry) => entry.startsWith("model-unload:"))).toBe(false);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();
    expect(runtime.readiness).toMatchObject({
      inProcessModeValidated: true,
      cleanup: { state: "none", required: false, completionPending: false },
    });
    await runtime.shutdown();
  });

  it("keeps Qwen models and manager resources until a timed-out native request settles", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("qwen-session-dispose");
    });
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 10,
      createChatSession: () =>
        fakeChatSession({
          processRequest: async () => {
            order.push("qwen-request-start");
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
    });
    await runtime.prepare(false);
    order.length = 0;

    const summary = runtime.summarize("Exact transcript");
    await requestReady.promise;
    const shutdownFailure = await captureFailure(runtime.shutdown());
    const cleanupCompletion = runtime.cleanupCompletion;

    expect(errorMessages(shutdownFailure)).toContain(
      "Foundry Local shutdown cleanup did not settle within 10 ms.",
    );
    expect(cleanupCompletion).not.toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    expect(order.some((entry) => entry.startsWith("model-unload:"))).toBe(false);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    order.push("qwen-request-settled");
    responseDeferred.resolve(textResponse("stale summary"));
    await expect(summary).rejects.toThrow("cancelled");
    await cleanupCompletion;

    expect(dispose).toHaveBeenCalledOnce();
    expect(order.indexOf("qwen-session-dispose")).toBeGreaterThan(order.indexOf("qwen-request-settled"));
    expect(order.findIndex((entry) => entry.startsWith("model-unload:"))).toBeGreaterThan(
      order.indexOf("qwen-session-dispose"),
    );
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("isolates a timed-out Nemotron drain while Whisper and Qwen complete on the shared manager", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const streamSettled = deferred<void>();
    const nemotronDispose = vi.fn(() => {
      order.push("nemotron-session-dispose");
    });
    const whisperProcess = vi.fn(async () => speechResponse("Exact Whisper final."));
    const qwenProcess = vi.fn(async () => textResponse("Exact Qwen summary."));
    const stream: StreamingResponse = {
      response: streamSettled.promise.then(() => speechResponse("stale live transcript")),
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            await streamSettled.promise;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 10,
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({
              processStreamingRequest: () => stream,
              dispose: nemotronDispose,
            })
          : fakeAudioSession({ processRequest: whisperProcess }),
      createChatSession: () => fakeChatSession({ processRequest: qwenProcess }),
    });
    const controller = new RecorderController(runtime);
    await controller.prepare({ enableLiveCaptions: true });
    const started = await controller.startLiveStream(
      {
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        maxDurationMs: 30_000,
      },
      () => {},
    );

    const firstCancel = runtime.cancelLiveStream(started.streamId);
    const repeatedCancel = runtime.cancelLiveStream(started.streamId);
    expect(repeatedCancel).toBe(firstCancel);
    const cancelFailure = await captureFailure(firstCancel);

    expect(errorMessages(cancelFailure)).toContain("Nemotron live stream did not settle within 10 ms.");
    expect(runtime.cancelLiveStream(started.streamId)).toBe(firstCancel);
    expect(runtime.cleanupCompletion).toBeNull();
    expect(runtime.readiness).toMatchObject({
      inProcessModeValidated: true,
      cleanup: { state: "none", required: false, completionPending: false },
      nemotron: {
        detail: "Optional live-caption cleanup is draining; Whisper and Qwen remain available.",
      },
    });

    const final = await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
      liveCaptionFailure: toSafeDiagnostic(cancelFailure, "OPTIONAL_LIVE_CLEANUP_PENDING"),
    });
    const summary = await controller.generateSummary();

    expect(final.result.transcript).toBe("Exact Whisper final.");
    expect(summary.summaryInput).toBe("Exact Whisper final.");
    expect(summary.snapshot.transcript.summary?.text).toBe("Exact Qwen summary.");
    expect(whisperProcess).toHaveBeenCalledOnce();
    expect(qwenProcess).toHaveBeenCalledOnce();
    expect(summary.snapshot.trace.find((entry) => entry.phase === "live-caption-warning")).toMatchObject({
      severity: "warning",
      detail:
        "Whisper final succeeded; The local operation did not finish within its bounded wait. [TIMEOUT/TimeoutError; details omitted]",
    });
    await expect(
      controller.startLiveStream(
        {
          format: AUDIO_FORMAT,
          sampleRate: AUDIO_SAMPLE_RATE,
          channels: AUDIO_CHANNELS,
          maxDurationMs: 30_000,
        },
        () => {},
      ),
    ).rejects.toThrow("still active or draining");

    const firstShutdown = controller.shutdown();
    const repeatedShutdown = controller.shutdown();
    expect(repeatedShutdown).toBe(firstShutdown);
    const shutdownFailure = await captureFailure(firstShutdown);
    const cleanupCompletion = controller.cleanupCompletion;

    expect(errorMessages(shutdownFailure)).toContain(
      "Foundry Local shutdown cleanup did not settle within 10 ms.",
    );
    expect(cleanupCompletion).not.toBeNull();
    expect(nemotronDispose).not.toHaveBeenCalled();
    expect(order.some((entry) => entry.startsWith("model-unload:"))).toBe(false);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    streamSettled.resolve();
    await cleanupCompletion;

    expect(nemotronDispose).toHaveBeenCalledOnce();
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(runtime.readiness.cleanup).toMatchObject({ state: "none", required: false });
  });

  it("joins reset and shutdown retries into one durable cleanup generation", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const store = new TempAudioStore(root);
    const cleanupAll = vi.spyOn(store, "cleanupAll");
    const responseDeferred = deferred<Response>();
    const requestReady = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("whisper-session-dispose");
    });
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () =>
        fakeAudioSession({
          processRequest: async () => {
            requestReady.resolve();
            return responseDeferred.promise;
          },
          dispose,
        }),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
      settlementTimeoutMs: 10,
    });
    await runtime.prepare(false);
    order.length = 0;

    const transcription = runtime.transcribeCapture(validatedCapture());
    await requestReady.promise;
    const firstReset = runtime.reset();
    const repeatedReset = runtime.reset();
    const upgradedShutdown = runtime.shutdown();
    const repeatedShutdown = runtime.shutdown();

    expect(repeatedReset).toBe(firstReset);
    expect(upgradedShutdown).toBe(firstReset);
    expect(repeatedShutdown).toBe(firstReset);
    const firstFailure = await captureFailure(firstReset);
    const cleanupCompletion = runtime.cleanupCompletion;
    expect(errorMessages(firstFailure)).toContain("Recorder reset cleanup did not settle within 10 ms.");
    expect(runtime.reset()).toBe(firstReset);
    expect(runtime.shutdown()).toBe(firstReset);
    expect(cleanupCompletion).not.toBeNull();
    expect(cleanupAll).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    responseDeferred.resolve(speechResponse("stale transcript"));
    await expect(transcription).rejects.toThrow("cancelled");
    await cleanupCompletion;

    expect(dispose).toHaveBeenCalledOnce();
    expect(cleanupAll).toHaveBeenCalledOnce();
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("starts a new cleanup generation after an error without duplicating completed teardown", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const store = new TempAudioStore(root);
    const cleanupAll = vi
      .spyOn(store, "cleanupAll")
      .mockRejectedValueOnce(new Error("temporary audio cleanup failed"))
      .mockResolvedValue(undefined);
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () => fakeAudioSession(),
      createChatSession: () => fakeChatSession(),
      tempAudioStore: store,
      settlementTimeoutMs: 1_000,
    });
    await runtime.prepare(false);
    order.length = 0;

    const firstReset = runtime.reset();
    const repeatedReset = runtime.reset();
    const upgradedShutdown = runtime.shutdown();

    expect(repeatedReset).toBe(firstReset);
    expect(upgradedShutdown).toBe(firstReset);
    await expect(firstReset).rejects.toThrow("temporary audio cleanup failed");
    expect(cleanupAll).toHaveBeenCalledOnce();
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(runtime.readiness.cleanup).toMatchObject({
      state: "audio_cleanup_required",
      required: true,
      completionPending: false,
    });

    const retry = runtime.shutdown();
    expect(retry).not.toBe(firstReset);
    await retry;

    expect(cleanupAll).toHaveBeenCalledTimes(2);
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(runtime.readiness.cleanup).toMatchObject({ state: "none", required: false });
  });

  it("keeps Nemotron session, models, and manager until a timed-out stream settles", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const streamSettled = deferred<void>();
    const dispose = vi.fn(() => {
      order.push("nemotron-session-dispose");
    });
    const stream: StreamingResponse = {
      response: streamSettled.promise.then(() => speechResponse("stale live transcript")),
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            await streamSettled.promise;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 10,
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({
              processStreamingRequest: () => stream,
              dispose,
            })
          : fakeAudioSession(),
    });
    await runtime.prepare(true);
    await runtime.startLiveStream(() => {});
    order.length = 0;

    const shutdownFailure = await captureFailure(runtime.shutdown());
    const cleanupCompletion = runtime.cleanupCompletion;

    expect(errorMessages(shutdownFailure)).toContain(
      "Foundry Local shutdown cleanup did not settle within 10 ms.",
    );
    expect(cleanupCompletion).not.toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    expect(order.some((entry) => entry.startsWith("model-unload:"))).toBe(false);
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    order.push("nemotron-stream-settled");
    streamSettled.resolve();
    await cleanupCompletion;

    expect(dispose).toHaveBeenCalledOnce();
    expect(order.indexOf("nemotron-session-dispose")).toBeGreaterThan(
      order.indexOf("nemotron-stream-settled"),
    );
    expect(order.findIndex((entry) => entry.startsWith("model-unload:"))).toBeGreaterThan(
      order.indexOf("nemotron-session-dispose"),
    );
    expect(order.filter((entry) => entry.startsWith("model-unload:"))).toHaveLength(3);
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });

  it("uses one manager and the exact CPU vision slot for text assistant turns", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const createManager = vi.fn(() => manager);
    const sessionModels: string[] = [];
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager,
      createAudioSession: () => fakeAudioSession(),
      createChatSession: (model) => {
        sessionModels.push(model.id);
        return fakeChatSession({ processRequest: async () => textResponse("One sentence ODE answer.") });
      },
    });

    await runtime.prepare(false);
    const result = await runtime.runAssistantTurn({
      systemPrompt: "Classroom safety.",
      prompt: "What is ODE? Answer in one sentence.",
    });

    expect(createManager).toHaveBeenCalledOnce();
    expect(sessionModels).toEqual([QWEN_VISION_CHAT_CANDIDATE_MODEL_ID]);
    expect(result.model).toMatchObject({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      source: "shared_summary_assistant_slot",
      task: "vision-language-chat",
      runtime: {
        deviceType: DeviceType.CPU,
        executionProvider: AUDIO_EXECUTION_PROVIDER,
      },
    });
    expect(manager.catalog.getModelVariant).toHaveBeenCalledWith(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.shutdown();
  });

  it("reuses the prepared shared Qwen slot for image work and preserves it across reset", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const createManager = vi.fn(() => manager);
    const sessionModels: string[] = [];
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager,
      createAudioSession: () => fakeAudioSession(),
      createChatSession: (model) => {
        sessionModels.push(model.id);
        return fakeChatSession({ processRequest: async () => textResponse("Structured image note.") });
      },
    });

    await runtime.prepare(false);
    const catalogLookupsAfterPrepare = vi.mocked(manager.catalog.getModelVariant).mock.calls.length;
    const result = await runtime.runAssistantTurn({
      systemPrompt: "Classroom safety.",
      prompt: "Analyze this image.",
      images: [{ kind: "data", format: "png", data: new Uint8Array([1, 2, 3]) }],
    });

    expect(createManager).toHaveBeenCalledOnce();
    expect(sessionModels).toEqual([QWEN_VISION_CHAT_CANDIDATE_MODEL_ID]);
    expect(result.model).toMatchObject({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      source: "shared_summary_assistant_slot",
      runtime: {
        deviceType: DeviceType.CPU,
        executionProvider: AUDIO_EXECUTION_PROVIDER,
      },
    });
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    expect(models.get(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID)?.loaded).toBe(true);
    expect(vi.mocked(manager.catalog.getModelVariant)).toHaveBeenCalledTimes(catalogLookupsAfterPrepare);
    await runtime.resetAssistant();
    expect(models.get(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID)?.loaded).toBe(true);
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.reset();
    expect(runtime.readiness.summary).toMatchObject({ status: "ready", loaded: true });
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.shutdown();
  });

  it("keeps all core slots loaded when optional CPU vision inference fails", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () => fakeAudioSession(),
      createChatSession: (model) =>
        fakeChatSession({
          processRequest: async () => {
            if (model.id === QWEN_VISION_CHAT_CANDIDATE_MODEL_ID) {
              throw new Error("optional vision failed");
            }
            return textResponse("core text");
          },
        }),
    });

    await runtime.prepare(true);
    await expect(
      runtime.runAssistantTurn({
        prompt: "Analyze.",
        images: [{ kind: "data", format: "png", data: new Uint8Array([1]) }],
      }),
    ).rejects.toThrow("optional vision failed");

    expect(models.get(WHISPER_AUDIO_MODEL_ID)?.loaded).toBe(true);
    expect(models.get(NEMOTRON_AUDIO_MODEL_ID)?.loaded).toBe(true);
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.shutdown();
  });

  it("keeps Nemotron capture accepting chunks while shared-manager text chat runs", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const chatResponse = deferred<Response>();
    const chatStarted = deferred<void>();
    const stream: StreamingResponse = {
      response: Promise.resolve(speechResponse("Nemotron terminal.")),
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true, value: undefined }),
        };
      },
    };
    const createManager = vi.fn(() => manager);
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager,
      createAudioSession: (model) =>
        model.id === NEMOTRON_AUDIO_MODEL_ID
          ? fakeAudioSession({ processStreamingRequest: () => stream })
          : fakeAudioSession(),
      createChatSession: () =>
        fakeChatSession({
          processRequest: async () => {
            chatStarted.resolve();
            return chatResponse.promise;
          },
        }),
    });
    await runtime.prepare(true);
    const live = await runtime.startLiveStream(() => {});
    const chat = runtime.runAssistantTurn({ prompt: "What is ODE?" });
    await chatStarted.promise;

    for (let sequence = 0; sequence < 3; sequence += 1) {
      expect(
        runtime.appendLiveChunk(live.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES))
          .acceptedSequence,
      ).toBe(sequence);
    }

    chatResponse.resolve(textResponse("An ODE relates a function to ordinary derivatives."));
    await expect(chat).resolves.toMatchObject({
      model: {
        modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
        source: "shared_summary_assistant_slot",
      },
    });
    await expect(
      runtime.finishLiveStream({
        streamId: live.streamId,
        lastSequence: 2,
        audioDurationMs: 300,
      }),
    ).resolves.toMatchObject({ transcript: "Nemotron terminal." });
    expect(createManager).toHaveBeenCalledOnce();
    await runtime.shutdown();
  });

  it("hides cancelled assistant work from new requests while its native drain settles once", async () => {
    const root = await createTempRoot();
    const models = createModels();
    const manager = new FakeManager(models);
    const chatResponse = deferred<Response>();
    const chatStarted = deferred<void>();
    const dispose = vi.fn();
    const runtime = new FoundryRecorderRuntime({
      resolvePaths: async () => pathsFor(root),
      createManager: () => manager,
      createAudioSession: () =>
        fakeAudioSession({ processRequest: async () => speechResponse("Core Whisper final.") }),
      createChatSession: () =>
        fakeChatSession({
          processRequest: async () => {
            chatStarted.resolve();
            return chatResponse.promise;
          },
          dispose,
        }),
    });
    await runtime.prepare(false);
    const chat = runtime.runAssistantTurn({ prompt: "Wait for reset." });
    await chatStarted.promise;

    const firstDrain = runtime.resetAssistant();
    const repeatedDrain = runtime.resetAssistant();
    expect(repeatedDrain).toBe(firstDrain);
    expect(runtime.assistantStatus).toMatchObject({ active: false, draining: true });
    await expect(runtime.runAssistantTurn({ prompt: "Too early." })).rejects.toThrow(
      "cleanup is still draining",
    );
    await expect(runtime.transcribeCapture(validatedCapture())).resolves.toMatchObject({
      transcript: "Core Whisper final.",
    });

    chatResponse.resolve(textResponse("stale answer"));
    await expect(chat).rejects.toMatchObject({ name: "AbortError" });
    await firstDrain;
    expect(dispose).toHaveBeenCalledOnce();
    expect(runtime.assistantStatus).toMatchObject({ active: false, draining: false });
    expect(models.get(SUMMARY_MODEL_ID)?.loaded).toBe(true);
    await runtime.shutdown();
  });

  it("runs core summary while a cancelled assistant request never settles and defers shutdown once", async () => {
    const root = await createTempRoot();
    const order: string[] = [];
    const models = createModels(order);
    const manager = new FakeManager(models, { order });
    const assistantResponse = deferred<Response>();
    const assistantStarted = deferred<void>();
    const assistantDispose = vi.fn(() => {
      order.push("assistant-session-dispose");
    });
    const visionModel = models.get(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
    if (visionModel === undefined) {
      throw new Error("Expected the optional CPU VLM.");
    }
    const visionUnload = vi.spyOn(visionModel, "unload");
    const runtime = createRuntime(root, [manager], {
      models,
      settlementTimeoutMs: 10,
      createChatSession: () => {
        let assistantSession = false;
        return fakeChatSession({
          processRequest: async (request) => {
            const requestText = Array.from({ length: request.itemCount }, (_value, index) => {
              const item = request.getItem(index);
              return item.type === "message" && typeof item.content === "string" ? item.content : "";
            }).join("\n");
            if (requestText.includes("FINAL TRANSCRIPT:")) {
              return textResponse("Core summary completed.");
            }
            assistantSession = true;
            assistantStarted.resolve();
            return assistantResponse.promise;
          },
          dispose: () => {
            if (assistantSession) {
              assistantDispose();
            }
          },
        });
      },
    });
    await runtime.prepare(false);

    const assistant = runtime.runAssistantTurn({ prompt: "Wait forever." });
    await assistantStarted.promise;
    await expect(runtime.reset()).resolves.toBeUndefined();
    const assistantDrain = runtime.resetAssistant();
    expect(runtime.assistantStatus).toMatchObject({ active: false, draining: true });

    await expect(runtime.summarize("Exact core transcript.")).resolves.toMatchObject({
      text: "Core summary completed.",
      model: { id: SUMMARY_MODEL_ID },
    });
    await expect(runtime.runAssistantTurn({ prompt: "Replacement." })).rejects.toThrow(
      "cleanup is still draining",
    );

    const shutdownFailure = await captureFailure(runtime.shutdown());
    const cleanupCompletion = runtime.cleanupCompletion;
    expect(errorMessages(shutdownFailure)).toContain(
      "Foundry Local shutdown cleanup did not settle within 10 ms.",
    );
    expect(cleanupCompletion).not.toBeNull();
    expect(manager.shutdown).not.toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    assistantResponse.resolve(textResponse("stale optional answer"));
    await expect(assistant).rejects.toMatchObject({ name: "AbortError" });
    await assistantDrain;
    await cleanupCompletion;

    expect(assistantDispose).toHaveBeenCalledOnce();
    expect(visionUnload).toHaveBeenCalledOnce();
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(manager.dispose).toHaveBeenCalledOnce();
  });
});

interface RuntimeFactoryOptions {
  readonly models?: ReadonlyMap<string, FakeModel>;
  readonly settlementTimeoutMs?: number;
  readonly createAudioSession?: NonNullable<FoundryRecorderRuntimeOptions["createAudioSession"]>;
  readonly createChatSession?: NonNullable<FoundryRecorderRuntimeOptions["createChatSession"]>;
}

function createRuntime(
  root: string,
  managers: readonly FakeManager[],
  options: RuntimeFactoryOptions = {},
): FoundryRecorderRuntime {
  let managerIndex = 0;
  return new FoundryRecorderRuntime({
    resolvePaths: async () => pathsFor(root),
    createManager: () => {
      const manager = managers[managerIndex];
      managerIndex += 1;
      if (manager === undefined) {
        throw new Error("No fake manager remains for this retry.");
      }
      return manager;
    },
    createAudioSession: options.createAudioSession ?? (() => fakeAudioSession()),
    createChatSession: options.createChatSession ?? (() => fakeChatSession()),
    ...(options.settlementTimeoutMs === undefined
      ? {}
      : { settlementTimeoutMs: options.settlementTimeoutMs }),
  });
}

class FakeManager {
  readonly catalog: {
    readonly getCachedModels: () => Promise<IModel[]>;
    readonly getModelVariant: (modelId: string) => Promise<IModel>;
  };
  urls: string[];
  isWebServiceRunning: boolean;
  readonly shutdown: () => void;
  readonly dispose: () => void;
  readonly #models: ReadonlyMap<string, FakeModel>;

  constructor(
    models: ReadonlyMap<string, FakeModel>,
    options: {
      readonly urls?: readonly string[];
      readonly isWebServiceRunning?: boolean;
      readonly order?: string[];
    } = {},
  ) {
    this.#models = models;
    this.urls = [...(options.urls ?? [])];
    this.isWebServiceRunning = options.isWebServiceRunning ?? false;
    this.catalog = {
      getCachedModels: vi.fn(async (): Promise<IModel[]> => [...this.#models.values()]),
      getModelVariant: vi.fn(async (modelId: string): Promise<IModel> => {
        const model = this.#models.get(modelId);
        if (model === undefined) {
          throw new Error(`Unknown fake model ${modelId}`);
        }
        return model;
      }),
    };
    this.shutdown = vi.fn(() => {
      options.order?.push("manager-shutdown");
    });
    this.dispose = vi.fn(() => {
      options.order?.push("manager-dispose");
    });
  }

  discoverEps(): EpInfo[] {
    return [{ name: SUMMARY_EXECUTION_PROVIDER, isRegistered: true }];
  }

  async downloadAndRegisterEps(
    _names: string[],
    _onProgress: (name: string, percent: number) => void,
  ): Promise<EpDownloadResult> {
    return {
      success: true,
      status: "registered",
      registeredEps: [SUMMARY_EXECUTION_PROVIDER],
      failedEps: [],
    };
  }
}

class FakeModel implements IModel {
  loaded = false;
  cached = true;
  readonly info: ModelInfo;
  readonly #order: string[] | undefined;

  constructor(
    readonly id: string,
    readonly alias: string,
    task: string,
    executionProvider: string,
    order?: string[],
    metadata: {
      readonly deviceType?: DeviceType;
      readonly inputModalities?: string;
      readonly outputModalities?: string;
    } = {},
  ) {
    this.#order = order;
    const deviceType = metadata.deviceType ?? DeviceType.CPU;
    this.info = {
      id,
      name: alias,
      version: 1,
      alias,
      uri: `fake://${id}`,
      deviceType,
      executionProvider,
      providerType: "fake",
      cached: true,
      task,
      runtime: { deviceType, executionProvider },
      ...(metadata.inputModalities === undefined ? {} : { inputModalities: metadata.inputModalities }),
      ...(metadata.outputModalities === undefined ? {} : { outputModalities: metadata.outputModalities }),
      fileSizeMb: 1,
      createdAtUnix: 0,
      isTestModel: true,
      getStringProperty: () => undefined,
      getIntProperty: (_key, defaultValue = 0) => defaultValue,
    };
  }

  get isCached(): boolean {
    return this.cached;
  }

  async isLoaded(): Promise<boolean> {
    return this.loaded;
  }

  get contextLength(): number | null {
    return 4_096;
  }

  get inputModalities(): string | null {
    return this.info.inputModalities ?? null;
  }

  get outputModalities(): string | null {
    return this.info.outputModalities ?? null;
  }

  get capabilities(): string | null {
    return null;
  }

  get supportsToolCalling(): boolean | null {
    return false;
  }

  getStringProperty(): string | undefined {
    return undefined;
  }

  getIntProperty(_key: string, defaultValue = 0): number {
    return defaultValue;
  }

  async download(signal?: AbortSignal): Promise<void>;
  async download(progressCallback?: (progress: number) => void, signal?: AbortSignal): Promise<void>;
  async download(
    progressOrSignal?: AbortSignal | ((progress: number) => void),
    _signal?: AbortSignal,
  ): Promise<void> {
    if (typeof progressOrSignal === "function") {
      progressOrSignal(50);
    }
    this.cached = true;
  }

  get path(): string {
    return `C:\\models\\${this.alias}`;
  }

  async load(): Promise<void> {
    this.loaded = true;
    this.#order?.push(`model-load:${this.id}`);
  }

  removeFromCache(): void {
    this.cached = false;
  }

  async unload(): Promise<void> {
    this.loaded = false;
    this.#order?.push(`model-unload:${this.id}`);
  }

  createChatClient(): ChatClient {
    throw new Error("Not used by the recorder runtime.");
  }

  createAudioClient(): AudioClient {
    throw new Error("Not used by the recorder runtime.");
  }

  createEmbeddingClient(): EmbeddingClient {
    throw new Error("Not used by the recorder runtime.");
  }

  get variants(): IModel[] {
    return [this];
  }

  selectVariant(): void {}
}

function createModels(order?: string[]): ReadonlyMap<string, FakeModel> {
  return new Map([
    [
      WHISPER_AUDIO_MODEL_ID,
      new FakeModel(
        WHISPER_AUDIO_MODEL_ID,
        "whisper",
        "automatic-speech-recognition",
        AUDIO_EXECUTION_PROVIDER,
        order,
      ),
    ],
    [
      NEMOTRON_AUDIO_MODEL_ID,
      new FakeModel(
        NEMOTRON_AUDIO_MODEL_ID,
        "nemotron",
        "automatic-speech-recognition",
        AUDIO_EXECUTION_PROVIDER,
        order,
      ),
    ],
    [
      QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      new FakeModel(
        QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
        "qwen-vision",
        "vision-language-chat",
        AUDIO_EXECUTION_PROVIDER,
        order,
        {
          deviceType: DeviceType.CPU,
          inputModalities: '["text", "image"]',
          outputModalities: "text",
        },
      ),
    ],
  ]);
}

function fakeAudioSession(
  options: {
    readonly processRequest?: (request: Request) => Promise<Response>;
    readonly processStreamingRequest?: (request: Request) => StreamingResponse;
    readonly dispose?: () => void;
  } = {},
) {
  return {
    processRequest:
      options.processRequest ??
      (async () => {
        throw new Error("Unexpected audio request.");
      }),
    processStreamingRequest:
      options.processStreamingRequest ??
      (() => {
        throw new Error("Unexpected streaming request.");
      }),
    dispose: options.dispose ?? (() => {}),
  };
}

function fakeChatSession(
  options: {
    readonly processRequest?: (request: Request) => Promise<Response>;
    readonly dispose?: () => void;
  } = {},
) {
  return {
    turnCount: 0,
    preflightRequest: async (): Promise<RequestPreflightResult> => ({
      promptTokens: 10,
      outputReserveTokens: 260,
      requiredTokens: 270,
      contextLimitTokens: 4_096,
      fits: true,
      deficitTokens: 0,
    }),
    processRequest:
      options.processRequest ??
      (async () => {
        throw new Error("Unexpected chat request.");
      }),
    dispose: options.dispose ?? (() => {}),
  };
}

function speechResponse(text: string): Response {
  return {
    output: [{ type: "speechResult", text, segments: [] }],
    finishReason: "stop",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function textResponse(text: string): Response {
  return {
    output: [{ type: "text", text }],
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

function completedAudioStream(text: string): StreamingResponse {
  return {
    response: Promise.resolve(speechResponse(text)),
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true, value: undefined }),
      };
    },
  };
}

function capturePayload() {
  return {
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs: 1_000,
    data: new ArrayBuffer(32_000),
  } as const;
}

function validatedCapture(): ValidatedAudioCapture {
  return {
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs: 1_000,
    pcmBytes: new Uint8Array(32_000),
    liveCaptionFailure: null,
  };
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "foundry-runtime-test-"));
  tempRoots.push(root);
  return root;
}

function pathsFor(root: string) {
  return {
    appDataDir: root,
    logsDir: path.join(root, "logs"),
    modelCacheDir: path.join(root, "models"),
    audioTempDir: root,
  };
}

async function ownedTempFiles(root: string): Promise<readonly string[]> {
  try {
    return (await readdir(root)).filter((file) => /^capture-.+\.wav$/.test(file));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail.");
}

function errorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }
  const messages = [error.message];
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      messages.push(...errorMessages(nested));
    }
  }
  if (error.cause !== undefined) {
    messages.push(...errorMessages(error.cause));
  }
  return messages;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve = (_value: T) => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
