import type {
  AudioClient,
  ChatClient,
  EmbeddingClient,
  IModel,
  ModelInfo,
  Request,
  RequestOptions,
  RequestPreflightResult,
  Response,
  StreamingResponse,
  StreamOptions,
} from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  OptionalVisionChatRuntime,
  type OptionalVisionChatRuntimeConfig,
  QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
  type VisionCatalogHandle,
  type VisionChatSessionHandle,
  VisionModelResolutionError,
} from "../src/foundry/optional-vision-chat-runtime";

const EXECUTION_PROVIDER = "WebGPUExecutionProvider";
const PRIMARY_MODEL_ID = "configured-vision-model-generic-gpu:7";

describe("OptionalVisionChatRuntime", () => {
  it("creates and disposes a fresh session with a mode-specific system prompt for every turn", async () => {
    const model = new FakeModel(PRIMARY_MODEL_ID);
    const catalog = fakeCatalog(new Map([[PRIMARY_MODEL_ID, model]]));
    const sessions: FakeSession[] = [];
    const createChatSession = vi.fn(() => {
      const session = fakeSession();
      sessions.push(session);
      return session;
    });
    const runtime = createRuntime(catalog, createChatSession);

    await runtime.runTurn({
      systemPrompt: "Clinic-safe image analysis.",
      prompt: "Describe the first frame.",
    });
    await runtime.runTurn({
      systemPrompt: "General side-chat guidance.",
      prompt: "Answer the follow-up.",
    });

    expect(createChatSession).toHaveBeenCalledTimes(2);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).not.toBe(sessions[1]);
    expectRequestMessages(sessions[0], "Clinic-safe image analysis.", "Describe the first frame.");
    expectRequestMessages(sessions[1], "General side-chat guidance.", "Answer the follow-up.");
    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    expect(sessions[1]?.dispose).toHaveBeenCalledOnce();

    await runtime.dispose();
    expect(model.load).toHaveBeenCalledOnce();
    expect(model.unload).toHaveBeenCalledOnce();
  });

  it("retains copied image bytes through settlement and zeroes them afterward", async () => {
    const model = new FakeModel(PRIMARY_MODEL_ID);
    const catalog = fakeCatalog(new Map([[PRIMARY_MODEL_ID, model]]));
    const response = deferred<Response>();
    const started = deferred<void>();
    let copiedImageBytes: Uint8Array | undefined;
    const session = fakeSession({
      processStreamingRequest: (request) => {
        const message = request.getItem(1);
        if (message.type !== "message") {
          throw new Error("Expected a user message.");
        }
        const image = message.parts?.find((part) => part.type === "image");
        if (image?.type !== "image" || image.data === undefined) {
          throw new Error("Expected copied image data.");
        }
        copiedImageBytes = image.data;
        started.resolve(undefined);
        return completedStream(response.promise);
      },
    });
    const runtime = createRuntime(catalog, () => session);
    const sourceBytes = new Uint8Array([1, 2, 3]);

    const turn = runtime.runTurn(
      {
        systemPrompt: "Inspect the supplied image.",
        prompt: "Describe this frame exactly.",
        images: [{ kind: "data", format: "png", data: sourceBytes }],
      },
      {
        requestOptions: {
          search: { doSample: false, maxOutputTokens: 64 },
          toolChoice: "none",
        },
      },
    );
    await started.promise;
    sourceBytes.fill(9);

    expect(copiedImageBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(copiedImageBytes).not.toBe(sourceBytes);
    expect(session.dispose).not.toHaveBeenCalled();
    const request = session.processStreamingRequest.mock.calls[0]?.[0];
    expect((request as Request & { options?: RequestOptions }).options).toEqual({
      search: { doSample: false, maxOutputTokens: 64 },
      toolChoice: "none",
    });

    response.resolve(textResponse("A local image description."));
    await expect(turn).resolves.toMatchObject({ text: "A local image description." });
    expect(copiedImageBytes).toEqual(new Uint8Array([0, 0, 0]));
    expect(session.dispose).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("uses the Qwen candidate only after exact catalog, task, modality, and runtime validation", async () => {
    const candidate = new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
    const catalog = fakeCatalog(new Map([[QWEN_VISION_CHAT_CANDIDATE_MODEL_ID, candidate]]));
    const runtime = createRuntime(catalog, () => fakeSession());

    const prepared = await runtime.prepare();

    expect(prepared).toMatchObject({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      source: "candidate",
    });
    expect(catalog.getModelVariant).toHaveBeenNthCalledWith(1, PRIMARY_MODEL_ID);
    expect(catalog.getModelVariant).toHaveBeenNthCalledWith(2, QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);
    expect(candidate.load).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(candidate.unload).toHaveBeenCalledOnce();
  });

  it("rejects an incompatible Qwen candidate instead of assuming its id implies compatibility", async () => {
    const primary = new FakeModel(PRIMARY_MODEL_ID, { task: "chat-completion" });
    const candidate = new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID, {
      deviceType: DeviceType.CPU,
    });
    const catalog = fakeCatalog(
      new Map([
        [PRIMARY_MODEL_ID, primary],
        [QWEN_VISION_CHAT_CANDIDATE_MODEL_ID, candidate],
      ]),
    );
    const createChatSession = vi.fn(() => fakeSession());
    const runtime = createRuntime(catalog, createChatSession);

    const failure = await captureFailure(runtime.prepare());

    expect(failure).toBeInstanceOf(VisionModelResolutionError);
    if (!(failure instanceof VisionModelResolutionError)) {
      throw new Error("Expected a typed model resolution error.");
    }
    expect(failure.attempts).toEqual([
      expect.objectContaining({
        modelId: PRIMARY_MODEL_ID,
        source: "primary",
        outcome: "incompatible",
        issues: expect.arrayContaining([
          expect.objectContaining({ field: "task", actual: "chat-completion" }),
        ]),
      }),
      expect.objectContaining({
        modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
        source: "candidate",
        outcome: "incompatible",
        issues: expect.arrayContaining([
          expect.objectContaining({
            field: "runtime.deviceType",
            expected: DeviceType.GPU,
            actual: DeviceType.CPU,
          }),
        ]),
      }),
    ]);
    expect(primary.load).not.toHaveBeenCalled();
    expect(candidate.load).not.toHaveBeenCalled();
    expect(createChatSession).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("never unloads a compatible model that was already loaded or an unrelated core model", async () => {
    const optional = new FakeModel(PRIMARY_MODEL_ID, { initiallyLoaded: true });
    const core = new FakeModel("core-summary-model-generic-gpu:1", {
      initiallyLoaded: true,
      task: "chat-completion",
      inputModalities: "text",
    });
    const catalog = fakeCatalog(
      new Map([
        [PRIMARY_MODEL_ID, optional],
        [core.id, core],
      ]),
    );
    const session = fakeSession({
      processStreamingRequest: () =>
        completedStream(Promise.reject(new Error("optional vision inference failed"))),
    });
    const runtime = createRuntime(catalog, () => session);

    await expect(
      runtime.runTurn({
        systemPrompt: "Apply clinic-safe guidance.",
        prompt: "Inspect this optional lane.",
      }),
    ).rejects.toThrow("optional vision inference failed");

    expect(session.dispose).toHaveBeenCalledOnce();
    expect(optional.load).not.toHaveBeenCalled();
    expect(optional.unload).not.toHaveBeenCalled();
    expect(core.load).not.toHaveBeenCalled();
    expect(core.unload).not.toHaveBeenCalled();
    await runtime.dispose();
    expect(optional.unload).not.toHaveBeenCalled();
  });

  it("unloads an owned optional model when preparation fails after loading it", async () => {
    const model = new FakeModel(PRIMARY_MODEL_ID, {
      taskAfterLoad: "chat-completion",
    });
    const catalog = fakeCatalog(new Map([[PRIMARY_MODEL_ID, model]]));
    const createChatSession = vi.fn(() => fakeSession());
    const runtime = createRuntime(catalog, createChatSession, { candidateModelIds: [] });

    await expect(runtime.prepare()).rejects.toBeInstanceOf(VisionModelResolutionError);

    expect(model.load).toHaveBeenCalledOnce();
    expect(model.unload).toHaveBeenCalledOnce();
    expect(createChatSession).not.toHaveBeenCalled();
    expect(runtime.status).toMatchObject({ state: "idle", model: null });
    await runtime.dispose();
    expect(model.unload).toHaveBeenCalledOnce();
  });

  it("cancels an active SDK streaming request and disposes only its optional session", async () => {
    const model = new FakeModel(PRIMARY_MODEL_ID);
    const catalog = fakeCatalog(new Map([[PRIMARY_MODEL_ID, model]]));
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const session = fakeSession({
      processStreamingRequest: (_request, options) => {
        markStarted();
        return completedStream(
          new Promise<Response>((_resolve, reject) => {
            const signal = options?.signal;
            if (signal === undefined) {
              reject(new Error("Expected the SDK streaming AbortSignal."));
              return;
            }
            const rejectAbort = () => {
              const error = new Error("cancelled");
              error.name = "AbortError";
              reject(error);
            };
            if (signal.aborted) {
              rejectAbort();
            } else {
              signal.addEventListener("abort", rejectAbort, { once: true });
            }
          }),
        );
      },
    });
    const runtime = createRuntime(catalog, () => session);

    const turn = runtime.runTurn({
      systemPrompt: "Cancellation-safe mode.",
      prompt: "Wait for cancellation.",
    });
    await started;
    expect(runtime.cancelActiveTurn()).toBe(true);
    await expect(turn).rejects.toMatchObject({ name: "AbortError" });

    expect(session.dispose).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(model.unload).toHaveBeenCalledOnce();
  });

  it("rejects a truncated generation instead of returning success-shaped text", async () => {
    const model = new FakeModel(PRIMARY_MODEL_ID);
    const catalog = fakeCatalog(new Map([[PRIMARY_MODEL_ID, model]]));
    const session = fakeSession({
      processStreamingRequest: () => completedStream(Promise.resolve(textResponse("partial", "length"))),
    });
    const runtime = createRuntime(catalog, () => session);

    await expect(runtime.runTurn({ prompt: "Answer briefly." })).rejects.toThrow(
      "generation ended with length",
    );
    await runtime.dispose();
  });
});

interface FakeModelOptions {
  readonly task?: string;
  readonly taskAfterLoad?: string;
  readonly initiallyLoaded?: boolean;
  readonly deviceType?: DeviceType;
  readonly executionProvider?: string;
  readonly inputModalities?: string;
  readonly outputModalities?: string;
}

class FakeModel implements IModel {
  loaded: boolean;
  cached = true;
  readonly #deviceType: DeviceType;
  readonly #executionProvider: string;
  readonly #inputModalities: string;
  readonly #outputModalities: string;
  readonly #taskAfterLoad: string | undefined;
  #task: string;
  readonly load = vi.fn(async (): Promise<void> => {
    this.loaded = true;
    if (this.#taskAfterLoad !== undefined) {
      this.#task = this.#taskAfterLoad;
    }
  });
  readonly unload = vi.fn(async (): Promise<void> => {
    this.loaded = false;
  });

  constructor(
    readonly id: string,
    options: FakeModelOptions = {},
  ) {
    this.loaded = options.initiallyLoaded ?? false;
    this.#deviceType = options.deviceType ?? DeviceType.GPU;
    this.#executionProvider = options.executionProvider ?? EXECUTION_PROVIDER;
    this.#inputModalities = options.inputModalities ?? '["text", "image"]';
    this.#outputModalities = options.outputModalities ?? "text";
    this.#task = options.task ?? "vision-language-chat";
    this.#taskAfterLoad = options.taskAfterLoad;
  }

  get info(): ModelInfo {
    return {
      id: this.id,
      name: this.id.split(":")[0] ?? this.id,
      version: Number(this.id.split(":")[1] ?? 1),
      alias: this.id.split(":")[0] ?? this.id,
      uri: `fake://${this.id}`,
      deviceType: this.#deviceType,
      executionProvider: this.#executionProvider,
      providerType: "fake",
      cached: true,
      task: this.#task,
      runtime: {
        deviceType: this.#deviceType,
        executionProvider: this.#executionProvider,
      },
      inputModalities: this.#inputModalities,
      outputModalities: this.#outputModalities,
      createdAtUnix: 0,
      isTestModel: true,
      getStringProperty: () => undefined,
      getIntProperty: (_key, defaultValue = 0) => defaultValue,
    };
  }

  get alias(): string {
    return this.info.alias;
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

  async download(): Promise<void> {
    this.cached = true;
  }

  get path(): string {
    return `/models/${this.alias}`;
  }

  removeFromCache(): void {
    this.cached = false;
  }

  createChatClient(): ChatClient {
    throw new Error("Deprecated client is not used by the adapter.");
  }

  createAudioClient(): AudioClient {
    throw new Error("Deprecated client is not used by the adapter.");
  }

  createEmbeddingClient(): EmbeddingClient {
    throw new Error("Deprecated client is not used by the adapter.");
  }

  get variants(): IModel[] {
    return [this];
  }

  selectVariant(): void {}
}

interface FakeSession extends VisionChatSessionHandle {
  readonly preflightRequest: ReturnType<typeof vi.fn<(request: Request) => Promise<RequestPreflightResult>>>;
  readonly processStreamingRequest: ReturnType<
    typeof vi.fn<(request: Request, options?: StreamOptions) => StreamingResponse>
  >;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

function fakeSession(
  options: {
    readonly processStreamingRequest?: (request: Request, options?: StreamOptions) => StreamingResponse;
  } = {},
): FakeSession {
  const processStreamingRequest = vi.fn(
    options.processStreamingRequest ??
      (() => completedStream(Promise.resolve(textResponse("A local image description.")))),
  );
  return {
    preflightRequest: vi.fn(
      async (): Promise<RequestPreflightResult> => ({
        promptTokens: 20,
        outputReserveTokens: 64,
        requiredTokens: 84,
        contextLimitTokens: 4_096,
        fits: true,
        deficitTokens: 0,
      }),
    ),
    processStreamingRequest: vi.fn((request: Request, streamOptions?: StreamOptions) => {
      return processStreamingRequest(request, streamOptions);
    }),
    dispose: vi.fn(),
  };
}

function fakeCatalog(models: ReadonlyMap<string, IModel>): VisionCatalogHandle & {
  readonly getModelVariant: ReturnType<typeof vi.fn<(modelId: string) => Promise<IModel>>>;
} {
  return {
    getModelVariant: vi.fn(async (modelId: string): Promise<IModel> => {
      const model = models.get(modelId);
      if (model === undefined) {
        throw new Error(`Unknown model ${modelId}`);
      }
      return model;
    }),
  };
}

function createRuntime(
  catalog: VisionCatalogHandle,
  createChatSession: (model: IModel) => VisionChatSessionHandle,
  options: Pick<OptionalVisionChatRuntimeConfig, "candidateModelIds"> = {},
): OptionalVisionChatRuntime {
  return new OptionalVisionChatRuntime(
    catalog,
    {
      modelId: PRIMARY_MODEL_ID,
      runtime: {
        deviceType: DeviceType.GPU,
        executionProvider: EXECUTION_PROVIDER,
      },
      ...(options.candidateModelIds === undefined ? {} : { candidateModelIds: options.candidateModelIds }),
    },
    { createChatSession },
  );
}

function expectRequestMessages(
  session: FakeSession | undefined,
  systemPrompt: string,
  userPrompt: string,
): void {
  if (session === undefined) {
    throw new Error("Expected a per-turn session.");
  }
  const request = session.processStreamingRequest.mock.calls[0]?.[0];
  if (request === undefined) {
    throw new Error("Expected a streamed request.");
  }
  expect(request.getItem(0)).toMatchObject({
    type: "message",
    role: "system",
    content: systemPrompt,
  });
  expect(request.getItem(1)).toMatchObject({
    type: "message",
    role: "user",
    content: userPrompt,
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function completedStream(response: Promise<Response>): StreamingResponse {
  return {
    response,
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true, value: undefined }),
      };
    },
  };
}

function textResponse(text: string, finishReason: Response["finishReason"] = "stop"): Response {
  return {
    output: [{ type: "text", text }],
    finishReason,
    usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
  };
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject.");
}
