import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AudioClient,
  ChatClient,
  EmbeddingClient,
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
import { SUMMARY_EXECUTION_PROVIDER, SUMMARY_MODEL_ID } from "../src/foundry/runtime-config";
import { RecorderController } from "../src/main/recorder-controller";
import { summaryUserPrompt } from "../src/summary/summary-prompt";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FoundryRecorderRuntime", () => {
  it("preserves exact Whisper text through the controller and exact Qwen prompt input", async () => {
    const root = await createTempRoot();
    const exact = "  First line.\r\nSecond  line — café 東京!\n\nSymbols: ∑, →, “quoted”.  ";
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
            return textResponse("Summary.");
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

    await expect(runtime.prepare(false)).rejects.toThrow("endpoint guard");
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

    await expect(runtime.prepare(false)).rejects.toThrow("endpoint guard");

    expect(rejected.shutdown).toHaveBeenCalledOnce();
    expect(rejected.dispose).toHaveBeenCalledOnce();
    expect(runtime.readiness.inProcessModeValidated).toBe(false);
    expect(runtime.readiness.embeddedWebServiceRunning).toBe(true);
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

  it("detaches stale models and reports every endpoint-guard cleanup failure before retrying", async () => {
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
        "manager dispose failed",
      ]),
    );
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
    expect(runtime.readiness.whisper).toMatchObject({
      model: null,
      status: "error",
      loaded: false,
    });
    expect(accepted.catalog.getModelVariant).toHaveBeenCalledWith(WHISPER_AUDIO_MODEL_ID);

    const prepared = await runtime.prepare(false);
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

  discoverEps() {
    return [{ name: SUMMARY_EXECUTION_PROVIDER, isRegistered: true }];
  }

  async downloadAndRegisterEps() {
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
  ) {
    this.#order = order;
    const deviceType = executionProvider === SUMMARY_EXECUTION_PROVIDER ? DeviceType.GPU : DeviceType.CPU;
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
    return null;
  }

  get outputModalities(): string | null {
    return null;
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

  async download(): Promise<void> {
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
      SUMMARY_MODEL_ID,
      new FakeModel(SUMMARY_MODEL_ID, "qwen", "chat-completion", SUMMARY_EXECUTION_PROVIDER, order),
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
