import type {
  ChatSession,
  IModel,
  ImageItem,
  RequestOptions,
  RequestPreflightResult,
  Response,
  TextItem,
} from "foundry-local-sdk";
import { Item, Request } from "foundry-local-sdk";
import {
  type AssistantImageByteLifecycle,
  secureAssistantImageByteLifecycle,
} from "../assistant/image-byte-lifecycle";

export const VISION_LANGUAGE_CHAT_TASK = "vision-language-chat";
export const QWEN_VISION_CHAT_CANDIDATE_MODEL_ID = "qwen3.5-0.8b-generic-cpu:3";

export interface VisionChatRuntimeTarget {
  readonly deviceType: string;
  readonly executionProvider: string;
}

export type VisionChatSessionHandle = Pick<ChatSession, "preflightRequest" | "processRequest" | "dispose">;

export type VisionModelCompatibilityField =
  | "model.id"
  | "model.info.id"
  | "task"
  | "runtime"
  | "runtime.deviceType"
  | "runtime.executionProvider"
  | "inputModalities"
  | "outputModalities";

export interface VisionModelCompatibilityIssue {
  readonly field: VisionModelCompatibilityField;
  readonly expected: string;
  readonly actual: string | null;
}

export type VisionModelCompatibility =
  | {
      readonly compatible: true;
      readonly inputModalities: readonly string[];
      readonly outputModalities: readonly string[];
    }
  | {
      readonly compatible: false;
      readonly inputModalities: readonly string[];
      readonly outputModalities: readonly string[];
      readonly issues: readonly VisionModelCompatibilityIssue[];
    };

export interface PreparedAssistantModel {
  readonly modelId: string;
  readonly source: "shared_summary_assistant_slot";
  readonly task: string;
  readonly runtime: VisionChatRuntimeTarget;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
}

export type VisionImageInput = {
  readonly kind: "data";
  readonly data: Uint8Array;
  readonly format: string;
};

export interface VisionChatTurnInput {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly images?: readonly VisionImageInput[];
}

export interface VisionChatTurnResult {
  readonly text: string;
  readonly model: PreparedAssistantModel;
  readonly preflight: RequestPreflightResult;
  readonly response: Response;
}

export interface AssistantTurnAdapterOptions {
  readonly signal?: AbortSignal;
  readonly requestOptions?: RequestOptions;
  readonly createChatSession: (model: IModel) => VisionChatSessionHandle;
  readonly createImageItem?: (format: string, data: Uint8Array) => ImageItem;
  readonly imageByteLifecycle?: AssistantImageByteLifecycle;
  readonly onCleanupError?: (error: unknown) => void;
  readonly assertCurrent?: () => void;
}

export class AssistantTurnCleanupError extends AggregateError {
  constructor(errors: readonly unknown[], message: string) {
    super(errors, message);
    this.name = "AssistantTurnCleanupError";
  }
}

export function inspectVisionChatModel(
  model: IModel,
  expectedModelId: string,
  expectedRuntime: VisionChatRuntimeTarget,
): VisionModelCompatibility {
  const info = model.info;
  const inputModalities = modalityTokens(model.inputModalities);
  const outputModalities = modalityTokens(model.outputModalities);
  const issues: VisionModelCompatibilityIssue[] = [];

  if (model.id !== expectedModelId) {
    issues.push({ field: "model.id", expected: expectedModelId, actual: model.id });
  }
  if (info.id !== expectedModelId) {
    issues.push({ field: "model.info.id", expected: expectedModelId, actual: info.id });
  }
  if (info.task !== VISION_LANGUAGE_CHAT_TASK) {
    issues.push({
      field: "task",
      expected: VISION_LANGUAGE_CHAT_TASK,
      actual: info.task ?? null,
    });
  }
  if (info.runtime === undefined || info.runtime === null) {
    issues.push({
      field: "runtime",
      expected: `${expectedRuntime.deviceType}/${expectedRuntime.executionProvider}`,
      actual: null,
    });
  } else {
    if (info.runtime.deviceType !== expectedRuntime.deviceType) {
      issues.push({
        field: "runtime.deviceType",
        expected: expectedRuntime.deviceType,
        actual: info.runtime.deviceType,
      });
    }
    if (info.runtime.executionProvider !== expectedRuntime.executionProvider) {
      issues.push({
        field: "runtime.executionProvider",
        expected: expectedRuntime.executionProvider,
        actual: info.runtime.executionProvider,
      });
    }
  }
  if (!inputModalities.includes("text") || !inputModalities.includes("image")) {
    issues.push({
      field: "inputModalities",
      expected: "exact tokens: text and image",
      actual: model.inputModalities,
    });
  }
  if (!outputModalities.includes("text")) {
    issues.push({
      field: "outputModalities",
      expected: "exact token: text",
      actual: model.outputModalities,
    });
  }

  return issues.length === 0
    ? { compatible: true, inputModalities, outputModalities }
    : { compatible: false, inputModalities, outputModalities, issues };
}

export async function processAssistantTurn(
  model: IModel,
  modelIdentity: PreparedAssistantModel,
  input: VisionChatTurnInput,
  options: AssistantTurnAdapterOptions,
): Promise<VisionChatTurnResult> {
  validateTurnInput(input);
  throwIfAborted(options.signal);
  const imageByteLifecycle = options.imageByteLifecycle ?? secureAssistantImageByteLifecycle;
  const retainedImageBytes: Uint8Array[] = [];
  const cleanupErrors: unknown[] = [];
  let request: Request | null = null;
  let session: VisionChatSessionHandle | null = null;
  let cancelAttempted = false;
  let abortListenerAttached = false;
  const recordCleanupError = (error: unknown): void => {
    cleanupErrors.push(error);
    try {
      options.onCleanupError?.(error);
    } catch (diagnosticError) {
      cleanupErrors.push(diagnosticError);
    }
  };
  const cancel = (): void => {
    if (request === null || cancelAttempted) {
      return;
    }
    cancelAttempted = true;
    try {
      request.cancel();
    } catch (error) {
      recordCleanupError(error);
    }
  };
  let outcome:
    | { readonly ok: true; readonly value: VisionChatTurnResult }
    | { readonly ok: false; readonly error: unknown };
  try {
    request = buildRequest(
      input,
      options.requestOptions,
      retainedImageBytes,
      imageByteLifecycle,
      options.createImageItem ?? ((format, data) => Item.imageFromData(format, data)),
    );
    options.signal?.addEventListener("abort", cancel, { once: true });
    abortListenerAttached = options.signal !== undefined;
    throwIfAborted(options.signal);
    session = options.createChatSession(model);
    options.assertCurrent?.();
    const preflight = await session.preflightRequest(request);
    throwIfAborted(options.signal);
    options.assertCurrent?.();
    if (!preflight.fits) {
      throw new Error(
        `Assistant request needs ${preflight.requiredTokens} tokens but the context limit is ${preflight.contextLimitTokens}.`,
      );
    }
    const response = await session.processRequest(request);
    throwIfAborted(options.signal);
    options.assertCurrent?.();
    if (response.finishReason !== "stop") {
      throw new Error(`Assistant generation ended with ${response.finishReason}.`);
    }
    const text = extractDefaultText(response);
    if (!text.trim()) {
      throw new Error("The local assistant returned no default text.");
    }
    outcome = {
      ok: true,
      value: { text, model: modelIdentity, preflight, response },
    };
  } catch (error) {
    outcome = { ok: false, error };
  }

  if (abortListenerAttached) {
    options.signal?.removeEventListener("abort", cancel);
  }
  cancel();
  try {
    session?.dispose();
  } catch (error) {
    recordCleanupError(error);
  }
  for (const bytes of [...new Set(retainedImageBytes)].reverse()) {
    try {
      imageByteLifecycle.release(bytes, "native-request");
    } catch (error) {
      recordCleanupError(error);
    }
  }
  if (!outcome.ok) {
    throw cleanupErrors.length === 0
      ? outcome.error
      : new AssistantTurnCleanupError(
          [outcome.error, ...cleanupErrors],
          "Assistant request and cleanup failed.",
        );
  }
  if (cleanupErrors.length > 0) {
    throw new AssistantTurnCleanupError(cleanupErrors, "Assistant request cleanup failed.");
  }
  return outcome.value;
}

function buildRequest(
  input: VisionChatTurnInput,
  requestOptions: RequestOptions | undefined,
  retainedImageBytes: Uint8Array[],
  imageByteLifecycle: AssistantImageByteLifecycle,
  createImageItem: (format: string, data: Uint8Array) => ImageItem,
): Request {
  const request = new Request();
  if (input.systemPrompt !== undefined) {
    request.addItem(Item.systemMessage(input.systemPrompt));
  }
  if ((input.images?.length ?? 0) === 0) {
    request.addItem(Item.userMessage(input.prompt));
  } else {
    const parts: Array<TextItem | ImageItem> = [Item.text(input.prompt)];
    for (const image of input.images ?? []) {
      const copiedBytes = imageByteLifecycle.copy(image.data, "native-request");
      retainedImageBytes.push(copiedBytes);
      const imageItem = createImageItem(image.format, copiedBytes);
      if (imageItem.data !== undefined && imageItem.data !== copiedBytes) {
        retainedImageBytes.push(imageItem.data);
      }
      parts.push(imageItem);
    }
    const userMessage = Item.userMessage(parts);
    retainMessageImageBytes(userMessage, retainedImageBytes);
    request.addItem(userMessage);
    retainMessageImageBytes(request.getItem(input.systemPrompt === undefined ? 0 : 1), retainedImageBytes);
  }
  if (requestOptions !== undefined) {
    request.setOptions(requestOptions);
  }
  return request;
}

function retainMessageImageBytes(
  item: ReturnType<Request["getItem"]>,
  retainedImageBytes: Uint8Array[],
): void {
  if (item.type !== "message") {
    return;
  }
  for (const part of item.parts ?? []) {
    if (part.type === "image" && part.data !== undefined) {
      retainedImageBytes.push(part.data);
    }
  }
}

function validateTurnInput(input: VisionChatTurnInput): void {
  if (!input.prompt.trim()) {
    throw new TypeError("Assistant prompt must not be blank.");
  }
  if (input.systemPrompt !== undefined && !input.systemPrompt.trim()) {
    throw new TypeError("Assistant system prompt must not be blank.");
  }
  for (const image of input.images ?? []) {
    if (!image.format.trim() || image.data.byteLength === 0) {
      throw new TypeError("Assistant image data and format are required.");
    }
  }
}

function modalityTokens(value: string | null): readonly string[] {
  if (value === null) {
    return [];
  }
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9_-]+/u)
        .filter((token) => token.length > 0),
    ),
  ];
}

function extractDefaultText(response: Response): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type === "text" && (item.textType ?? "default") === "default") {
      parts.push(item.text);
      continue;
    }
    if (item.type === "message") {
      if (typeof item.content === "string") {
        parts.push(item.content);
      } else {
        for (const part of item.parts ?? []) {
          if (part.type === "text" && (part.textType ?? "default") === "default") {
            parts.push(part.text);
          }
        }
      }
    }
  }
  return parts.join("");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error("Assistant operation aborted.", { cause: signal.reason });
    error.name = "AbortError";
    throw error;
  }
}
