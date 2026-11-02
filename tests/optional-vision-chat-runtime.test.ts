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
import {
  inspectVisionChatModel,
  processAssistantTurn,
  QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
  type VisionChatSessionHandle,
} from "../src/foundry/optional-vision-chat-runtime";

const CPU_PROVIDER = "CPUExecutionProvider";

describe("optional vision/chat adapter", () => {
  it("accepts only the exact CPU vision-language-chat model and modalities", () => {
    const compatible = inspectVisionChatModel(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
      QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      { deviceType: DeviceType.CPU, executionProvider: CPU_PROVIDER },
    );
    const incompatible = inspectVisionChatModel(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID, {
        deviceType: DeviceType.GPU,
        executionProvider: "WebGPUExecutionProvider",
      }),
      QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      { deviceType: DeviceType.CPU, executionProvider: CPU_PROVIDER },
    );

    expect(compatible).toMatchObject({ compatible: true });
    expect(incompatible).toMatchObject({
      compatible: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "runtime.deviceType", expected: DeviceType.CPU }),
        expect.objectContaining({
          field: "runtime.executionProvider",
          expected: CPU_PROVIDER,
        }),
      ]),
    });
  });

  it("uses exact mixed text/image parts, retains bytes through settlement, then zeroes them", async () => {
    const response = deferred<Response>();
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
    const source = new Uint8Array([1, 2, 3]);
    const turn = processAssistantTurn(
      new FakeModel(QWEN_VISION_CHAT_CANDIDATE_MODEL_ID),
      visionIdentity(),
      {
        systemPrompt: "Classroom safety.",
        prompt: "Describe the ODE slide.",
        images: [{ kind: "data", format: "png", data: source }],
      },
      {
        createChatSession: () => session,
        requestOptions: {
          search: { doSample: false, maxOutputTokens: 64 },
          toolChoice: "none",
        },
      },
    );
    await vi.waitFor(() => expect(copiedImageBytes).toBeDefined());
    source.fill(9);

    expect(copiedImageBytes).toEqual(new Uint8Array([1, 2, 3]));
    response.resolve(textResponse("The slide shows exponential decay."));
    await expect(turn).resolves.toMatchObject({ text: "The slide shows exponential decay." });
    expect(copiedImageBytes).toEqual(new Uint8Array([0, 0, 0]));
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("creates and disposes a separate session with the system prompt on every turn", async () => {
    const sessions = [fakeSession(), fakeSession()];
    const createChatSession = vi.fn(() => {
      const session = sessions.shift();
      if (session === undefined) {
        throw new Error("No fake session remains.");
      }
      return session;
    });
    const model = new FakeModel("qwen3-0.6b-generic-gpu:2", {
      task: "chat-completion",
      deviceType: DeviceType.GPU,
      executionProvider: "WebGPUExecutionProvider",
      inputModalities: "text",
    });

    for (const prompt of ["First safety prompt.", "Second safety prompt."]) {
      await processAssistantTurn(
        model,
        {
          modelId: model.id,
          source: "summary_slot",
          task: "chat-completion",
          runtime: {
            deviceType: DeviceType.GPU,
            executionProvider: "WebGPUExecutionProvider",
          },
          inputModalities: ["text"],
          outputModalities: ["text"],
        },
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
      new FakeModel("qwen3-0.6b-generic-gpu:2", {
        task: "chat-completion",
        deviceType: DeviceType.GPU,
        executionProvider: "WebGPUExecutionProvider",
        inputModalities: "text",
      }),
      summaryIdentity(),
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
        new FakeModel("qwen3-0.6b-generic-gpu:2", {
          task: "chat-completion",
          deviceType: DeviceType.GPU,
          executionProvider: "WebGPUExecutionProvider",
          inputModalities: "text",
        }),
        summaryIdentity(),
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
});

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
    const deviceType = options.deviceType ?? DeviceType.CPU;
    const executionProvider = options.executionProvider ?? CPU_PROVIDER;
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
    source: "vision_slot" as const,
    task: "vision-language-chat",
    runtime: { deviceType: DeviceType.CPU, executionProvider: CPU_PROVIDER },
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  };
}

function summaryIdentity() {
  return {
    modelId: "qwen3-0.6b-generic-gpu:2",
    source: "summary_slot" as const,
    task: "chat-completion",
    runtime: {
      deviceType: DeviceType.GPU,
      executionProvider: "WebGPUExecutionProvider",
    },
    inputModalities: ["text"],
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
} {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
