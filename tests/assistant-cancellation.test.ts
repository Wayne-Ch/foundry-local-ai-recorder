import type { IModel, Request, RequestOptions, RequestPreflightResult, Response } from "foundry-local-sdk";
import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
import type { PreparedAssistantInferenceImage } from "../src/assistant/image-inference";
import type { ValidatedImage } from "../src/assistant/image-security";
import type { AssistantRuntimeStatus } from "../src/foundry/foundry-runtime";
import {
  processAssistantTurn,
  QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
  type VisionChatTurnInputSource,
  type VisionChatTurnResult,
} from "../src/foundry/optional-vision-chat-runtime";
import type { AssistantRuntime } from "../src/main/assistant-controller";
import { AssistantController } from "../src/main/assistant-controller";
import { toSafeDiagnostic } from "../src/shared/safe-diagnostic";

describe("assistant cancellation cleanup", () => {
  it.each(["reset", "clear", "mode", "revoke", "shutdown"] as const)(
    "contains native cancel throws during %s and still disposes and zeroes",
    async (trigger) => {
      const lifecycle = new TrackingImageByteLifecycle();
      const runtime = new ThrowingCancelRuntime();
      const controller = new AssistantController({
        runtime,
        getTranscript: () => ({
          liveDraft: "",
          liveSequence: -1,
          liveStreamId: null,
          finalText: "lesson",
          version: 1,
          submittedVersion: null,
          summary: null,
        }),
        imageByteLifecycle: lifecycle,
      });
      controller.selectImage(image(), "data:image/png;base64,abc", inferenceImage());
      controller.startChat("session-1", "Explain the selected image.", () => {});
      await runtime.started;
      const operationBytes = lifecycle.copies("assistant-operation")[0];

      expect(() => {
        switch (trigger) {
          case "reset":
            controller.reset();
            break;
          case "clear":
            controller.clearChat();
            break;
          case "mode":
            controller.setMode("clinic");
            break;
          case "revoke":
            controller.revokeSession("session-1");
            break;
          case "shutdown":
            controller.shutdown();
            break;
        }
      }).not.toThrow();

      expect(runtime.assistantStatus.cleanupDiagnostic).toMatchObject({
        code: "OPTIONAL_ASSISTANT_CLEANUP_PENDING",
      });
      await vi.waitFor(() => expect(runtime.dispose).toHaveBeenCalledOnce());
      await vi.waitFor(() =>
        expect(controller.snapshot().trace.some((entry) => entry.phase === "assistant-failure")).toBe(true),
      );

      expect(runtime.requestBytes).toEqual(new Uint8Array([0, 0, 0]));
      expect(operationBytes).toEqual(new Uint8Array([0, 0, 0]));
      expect(lifecycle.isLive(operationBytes as Uint8Array)).toBe(false);
    },
  );
});

class ThrowingCancelRuntime implements AssistantRuntime {
  assistantStatus: AssistantRuntimeStatus = {
    active: false,
    draining: false,
    sharedModelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
    cleanupDiagnostic: null,
  };
  readonly dispose = vi.fn();
  requestBytes: Uint8Array | null = null;
  readonly #started = deferred<void>();
  #activeController: AbortController | null = null;
  #activeSettlement: Promise<void> | null = null;

  get started(): Promise<void> {
    return this.#started.promise;
  }

  async runAssistantTurn(
    inputSource: VisionChatTurnInputSource,
    options: {
      readonly signal?: AbortSignal;
      readonly requestOptions?: RequestOptions;
      readonly onProgress?: (phase: "initializing_runtime" | "running_inference") => void;
      readonly operationId?: string;
    } = {},
  ): Promise<VisionChatTurnResult> {
    const controller = new AbortController();
    const forwardAbort = () => {
      try {
        controller.abort(options.signal?.reason);
      } catch (error) {
        this.#recordCleanup(error);
      }
    };
    if (options.signal?.aborted === true) {
      forwardAbort();
    } else {
      options.signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    this.#activeController = controller;
    this.assistantStatus = { ...this.assistantStatus, active: true, draining: false };
    options.onProgress?.("initializing_runtime");
    const input = typeof inputSource === "function" ? inputSource() : inputSource;
    const nativeResponse = deferred<Response>();
    options.onProgress?.("running_inference");
    const turn = processAssistantTurn(
      {} as IModel,
      {
        modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
        source: "shared_summary_assistant_slot",
        task: "vision-language-chat",
        runtime: {
          deviceType: DeviceType.GPU,
          executionProvider: "WebGPUExecutionProvider",
        },
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
      },
      input,
      {
        signal: controller.signal,
        ...(options.requestOptions === undefined ? {} : { requestOptions: options.requestOptions }),
        createChatSession: () => ({
          preflightRequest: async (): Promise<RequestPreflightResult> => ({
            promptTokens: 1,
            outputReserveTokens: 1,
            requiredTokens: 2,
            contextLimitTokens: 4_096,
            fits: true,
            deficitTokens: 0,
          }),
          processRequest: async (request: Request) => {
            const message = request.getItem(1);
            if (message.type !== "message") {
              throw new Error("Expected image chat user message.");
            }
            const imagePart = message.parts?.find((part) => part.type === "image");
            if (imagePart?.type !== "image" || imagePart.data === undefined) {
              throw new Error("Expected image bytes.");
            }
            this.requestBytes = imagePart.data;
            vi.spyOn(request, "cancel").mockImplementation(() => {
              nativeResponse.reject(new Error("native request settled after cancel"));
              throw new Error("native request cancel threw");
            });
            this.#started.resolve();
            return nativeResponse.promise;
          },
          dispose: this.dispose,
        }),
        onCleanupError: (error) => this.#recordCleanup(error),
      },
    );
    this.#activeSettlement = turn.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await turn;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
      this.#activeController = null;
      this.assistantStatus = { ...this.assistantStatus, active: false, draining: false };
    }
  }

  cancelAssistantOperations(reason?: unknown): Promise<void> | null {
    const controller = this.#activeController;
    if (controller === null) {
      return null;
    }
    this.assistantStatus = { ...this.assistantStatus, active: false, draining: true };
    try {
      controller.abort(reason);
    } catch (error) {
      this.#recordCleanup(error);
    }
    return this.#activeSettlement;
  }

  resetAssistant(): Promise<void> {
    return (
      this.cancelAssistantOperations(new Error("Assistant reset cancelled optional work.")) ??
      Promise.resolve()
    );
  }

  #recordCleanup(error: unknown): void {
    this.assistantStatus = {
      ...this.assistantStatus,
      cleanupDiagnostic: toSafeDiagnostic(error, "OPTIONAL_ASSISTANT_CLEANUP_PENDING"),
    };
  }
}

class TrackingImageByteLifecycle implements AssistantImageByteLifecycle {
  readonly #copies = new Map<AssistantImageBytePurpose, Uint8Array[]>();
  readonly #live = new Set<Uint8Array>();

  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array {
    const bytes = Uint8Array.from(source);
    const copies = this.#copies.get(purpose) ?? [];
    copies.push(bytes);
    this.#copies.set(purpose, copies);
    this.#live.add(bytes);
    return bytes;
  }

  release(bytes: Uint8Array): void {
    bytes.fill(0);
    this.#live.delete(bytes);
  }

  copies(purpose: AssistantImageBytePurpose): readonly Uint8Array[] {
    return this.#copies.get(purpose) ?? [];
  }

  isLive(bytes: Uint8Array): boolean {
    return this.#live.has(bytes);
  }
}

function image(): ValidatedImage {
  return {
    basename: "lesson.png",
    mimeType: "image/png",
    sizeBytes: 3,
    width: 1,
    height: 1,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

function inferenceImage(): PreparedAssistantInferenceImage {
  return {
    mimeType: "image/png",
    format: "png",
    sizeBytes: 3,
    width: 1,
    height: 1,
    bytes: new Uint8Array([7, 8, 9]),
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
