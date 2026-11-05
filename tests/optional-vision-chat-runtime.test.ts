import { Buffer } from "node:buffer";
import type {
  AudioClient,
  ChatClient,
  EmbeddingClient,
  IModel,
  ModelInfo,
  Request,
  RequestPreflightResult,
  Response,
} from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
import {
  AssistantTurnCleanupError,
  inspectVisionChatModel,
  processAssistantTurn,
  QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
  type VisionChatSessionHandle,
} from "../src/foundry/optional-vision-chat-runtime";

const GPU_PROVIDER = "WebGPUExecutionProvider";

describe("optional vision/chat adapter", () => {
  it("accepts only the exact GPU vision-language-chat model and modalities", () => {
    const compatible = inspectVisionChatModel(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
      QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      { deviceType: DeviceType.GPU, executionProvider: GPU_PROVIDER },
    );
    const incompatible = inspectVisionChatModel(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID, {
        deviceType: DeviceType.CPU,
        executionProvider: "CPUExecutionProvider",
      }),
      QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      { deviceType: DeviceType.GPU, executionProvider: GPU_PROVIDER },
    );

    expect(compatible).toMatchObject({ compatible: true });
    expect(incompatible).toMatchObject({
      compatible: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "runtime.deviceType", expected: DeviceType.GPU }),
        expect.objectContaining({
          field: "runtime.executionProvider",
          expected: GPU_PROVIDER,
        }),
      ]),
    });
  });

  it.each([
    ["image analysis", "Analyze the ODE slide."],
    ["direct-image chat", "Explain the selected image."],
  ] as const)(
    "uses and zeroes one detached native request copy exactly once for %s",
    async (_flow, prompt) => {
      const response = deferred<Response>();
      const lifecycle = new TrackingImageByteLifecycle();
      let copiedImageBytes: Uint8Array | undefined;
      const session = fakeSession({
        processRequest: async (request) => {
          const message = request.getItem(1);
          if (message.type !== "message") {
            throw new Error("Expected user message.");
          }
          const image = message.parts?.find((part) => part.type === "image");
          if (image?.type !== "image" || image.data === undefined) {
            throw new Error("Expected image bytes.");
          }
          copiedImageBytes = image.data;
          return response.promise;
        },
      });
      const source = Buffer.from([1, 2, 3]);
      const turn = processAssistantTurn(
        new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
        visionIdentity(),
        {
          systemPrompt: "Classroom safety.",
          prompt,
          images: [{ kind: "data", format: "png", data: source }],
        },
        {
          createChatSession: () => session,
          requestOptions: {
            search: { doSample: false, maxOutputTokens: 64 },
            toolChoice: "none",
          },
          imageByteLifecycle: lifecycle,
        },
      );
      await vi.waitFor(() => expect(copiedImageBytes).toBeDefined());
      const nativeCopy = lifecycle.copies("native-request")[0];
      expect(lifecycle.copies("native-request")).toHaveLength(1);
      expect(Buffer.isBuffer(nativeCopy)).toBe(false);
      expect(nativeCopy?.constructor).toBe(Uint8Array);
      source.fill(9);

      expect(copiedImageBytes).toEqual(new Uint8Array([1, 2, 3]));
      response.resolve(textResponse("The slide shows exponential decay."));
      await expect(turn).resolves.toMatchObject({ text: "The slide shows exponential decay." });
      expect(copiedImageBytes).toEqual(new Uint8Array([0, 0, 0]));
      expect(nativeCopy).toEqual(new Uint8Array([0, 0, 0]));
      expect(lifecycle.releaseCount(nativeCopy as Uint8Array, "native-request")).toBe(1);
      expect(session.dispose).toHaveBeenCalledOnce();
    },
  );

  it("creates and disposes a separate session with the system prompt on every turn", async () => {
    const sessions = [fakeSession(), fakeSession()];
    const createChatSession = vi.fn(() => {
      const session = sessions.shift();
      if (session === undefined) {
        throw new Error("No fake session remains.");
      }
      return session;
    });
    const model = new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID);

    for (const prompt of ["First safety prompt.", "Second safety prompt."]) {
      await processAssistantTurn(
        model,
        visionIdentity(),
        { systemPrompt: prompt, prompt: "What is ODE?" },
        { createChatSession },
      );
    }

    expect(createChatSession).toHaveBeenCalledTimes(2);
    for (const [index, session] of [
      createChatSession.mock.results[0]?.value,
      createChatSession.mock.results[1]?.value,
    ].entries()) {
      expect(session?.processRequest.mock.calls[0]?.[0].getItem(0)).toMatchObject({
        type: "message",
        role: "system",
        content: index === 0 ? "First safety prompt." : "Second safety prompt.",
      });
      expect(session?.dispose).toHaveBeenCalledOnce();
    }
  });

  it("cancels the request, disposes the session, and rejects stale completion", async () => {
    const response = deferred<Response>();
    let request: (Request & { cancelled?: boolean }) | null = null;
    const session = fakeSession({
      processRequest: async (candidate) => {
        request = candidate as Request & { cancelled?: boolean };
        return response.promise;
      },
    });
    const controller = new AbortController();
    const turn = processAssistantTurn(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
      visionIdentity(),
      { prompt: "Wait." },
      { signal: controller.signal, createChatSession: () => session },
    );
    await vi.waitFor(() => expect(request).not.toBeNull());

    controller.abort();
    expect((request as unknown as { readonly cancelled?: boolean }).cancelled).toBe(true);
    response.resolve(textResponse("stale"));

    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("rejects non-stop output", async () => {
    await expect(
      processAssistantTurn(
        new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
        visionIdentity(),
        { prompt: "Answer." },
        {
          createChatSession: () =>
            fakeSession({
              processRequest: async () => textResponse("partial", "length"),
            }),
        },
      ),
    ).rejects.toThrow("ended with length");
  });

  it("contains abort-time cancel throws, reports them safely, and still disposes and zeroes", async () => {
    const response = deferred<Response>();
    let requestBytes: Uint8Array | undefined;
    const cleanupErrors: unknown[] = [];
    const session = fakeSession({
      processRequest: async (request) => {
        const message = request.getItem(0);
        if (message.type !== "message") {
          throw new Error("Expected user message.");
        }
        const image = message.parts?.find((part) => part.type === "image");
        if (image?.type !== "image" || image.data === undefined) {
          throw new Error("Expected image bytes.");
        }
        requestBytes = image.data;
        vi.spyOn(request, "cancel").mockImplementation(() => {
          response.reject(new Error("native request settled after cancel"));
          throw new Error("native cancel threw");
        });
        return response.promise;
      },
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const turn = processAssistantTurn(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
      visionIdentity(),
      {
        prompt: "Describe this.",
        images: [{ kind: "data", format: "png", data: new Uint8Array([3, 2, 1]) }],
      },
      {
        signal: controller.signal,
        createChatSession: () => session,
        onCleanupError: (error) => cleanupErrors.push(error),
      },
    );
    await vi.waitFor(() => expect(requestBytes).toBeDefined());

    expect(() => controller.abort()).not.toThrow();
    await expect(turn).rejects.toBeInstanceOf(AssistantTurnCleanupError);

    expect(cleanupErrors.map(errorMessage)).toContain("native cancel threw");
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(requestBytes).toEqual(new Uint8Array([0, 0, 0]));
    expect(removeListener).toHaveBeenCalled();
  });

  it("releases tracked request bytes when image request construction fails", async () => {
    const liveBytes = new Set<Uint8Array>();
    const releasedBytes: Uint8Array[] = [];

    await expect(
      processAssistantTurn(
        new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
        visionIdentity(),
        {
          prompt: "Describe this.",
          images: [{ kind: "data", format: "png", data: new Uint8Array([4, 5, 6]) }],
        },
        {
          createChatSession: () => fakeSession(),
          createImageItem: () => {
            throw new Error("image item construction failed");
          },
          imageByteLifecycle: {
            copy: (source) => {
              const copied = Uint8Array.from(source);
              liveBytes.add(copied);
              return copied;
            },
            release: (bytes) => {
              bytes.fill(0);
              liveBytes.delete(bytes);
              releasedBytes.push(bytes);
            },
          },
        },
      ),
    ).rejects.toThrow("image item construction failed");

    expect(liveBytes.size).toBe(0);
    expect(releasedBytes).toHaveLength(1);
    expect(releasedBytes[0]).toEqual(new Uint8Array([0, 0, 0]));
  });
});

class TrackingImageByteLifecycle implements AssistantImageByteLifecycle {
  readonly #copies = new Map<AssistantImageBytePurpose, Uint8Array[]>();
  readonly #releaseCounts = new Map<Uint8Array, Map<AssistantImageBytePurpose, number>>();

  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array {
    const copied = Uint8Array.from(source);
    const copies = this.#copies.get(purpose) ?? [];
    copies.push(copied);
    this.#copies.set(purpose, copies);
    return copied;
  }

  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void {
    const counts = this.#releaseCounts.get(bytes) ?? new Map<AssistantImageBytePurpose, number>();
    counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
    this.#releaseCounts.set(bytes, counts);
    bytes.fill(0);
  }

  copies(purpose: AssistantImageBytePurpose): readonly Uint8Array[] {
    return this.#copies.get(purpose) ?? [];
  }

  releaseCount(bytes: Uint8Array, purpose: AssistantImageBytePurpose): number {
    return this.#releaseCounts.get(bytes)?.get(purpose) ?? 0;
  }
}

interface FakeModelOptions {
  readonly task?: string;
  readonly deviceType?: DeviceType;
  readonly executionProvider?: string;
  readonly inputModalities?: string;
  readonly outputModalities?: string;
}

class FakeModel implements IModel {
  readonly info: ModelInfo;
  loaded = true;
  cached = true;

  constructor(
    readonly id: string,
    options: FakeModelOptions = {},
  ) {
    const deviceType = options.deviceType ?? DeviceType.GPU;
    const executionProvider = options.executionProvider ?? GPU_PROVIDER;
    this.info = {
      id,
      name: id,
      version: 1,
      alias: id,
      uri: `fake://${id}`,
      deviceType,
      executionProvider,
      providerType: "fake",
      cached: true,
      task: options.task ?? "vision-language-chat",
      runtime: { deviceType, executionProvider },
      inputModalities: options.inputModalities ?? '["text", "image"]',
      outputModalities: options.outputModalities ?? "text",
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
  async load(): Promise<void> {
    this.loaded = true;
  }
  async unload(): Promise<void> {
    this.loaded = false;
  }
  removeFromCache(): void {
    this.cached = false;
  }
  createChatClient(): ChatClient {
    throw new Error("Not used.");
  }
  createAudioClient(): AudioClient {
    throw new Error("Not used.");
  }
  createEmbeddingClient(): EmbeddingClient {
    throw new Error("Not used.");
  }
  get variants(): IModel[] {
    return [this];
  }
  selectVariant(): void {}
}

interface FakeSession extends VisionChatSessionHandle {
  readonly processRequest: ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

function fakeSession(
  options: { readonly processRequest?: (request: Request) => Promise<Response> } = {},
): FakeSession {
  return {
    preflightRequest: vi.fn(
      async (): Promise<RequestPreflightResult> => ({
        promptTokens: 10,
        outputReserveTokens: 64,
        requiredTokens: 74,
        contextLimitTokens: 4_096,
        fits: true,
        deficitTokens: 0,
      }),
    ),
    processRequest: vi.fn(options.processRequest ?? (async () => textResponse("An ODE answer."))),
    dispose: vi.fn(),
  };
}

function visionIdentity() {
  return {
    modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
    source: "shared_summary_assistant_slot" as const,
    task: "vision-language-chat",
    runtime: { deviceType: DeviceType.GPU, executionProvider: GPU_PROVIDER },
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  };
}

function textResponse(text: string, finishReason: Response["finishReason"] = "stop"): Response {
  return {
    output: [{ type: "text", text }],
    finishReason,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve = (_value: T) => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
