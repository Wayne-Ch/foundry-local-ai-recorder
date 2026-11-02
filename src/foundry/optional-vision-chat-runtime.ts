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
  readonly source: "summary_slot" | "vision_slot";
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
  readonly assertCurrent?: () => void;
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
  const built = buildRequest(input, options.requestOptions);
  const cancel = () => built.request.cancel();
  options.signal?.addEventListener("abort", cancel, { once: true });
  let session: VisionChatSessionHandle | null = null;
  let outcome:
    | { readonly ok: true; readonly value: VisionChatTurnResult }
    | { readonly ok: false; readonly error: unknown };
  try {
    session = options.createChatSession(model);
    options.assertCurrent?.();
    const preflight = await session.preflightRequest(built.request);
    throwIfAborted(options.signal);
    options.assertCurrent?.();
    if (!preflight.fits) {
      throw new Error(
        `Assistant request needs ${preflight.requiredTokens} tokens but the context limit is ${preflight.contextLimitTokens}.`,
      );
    }
    const response = await session.processRequest(built.request);
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

  options.signal?.removeEventListener("abort", cancel);
  const cleanupErrors: unknown[] = [];
  try {
    built.request.cancel();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    session?.dispose();
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const bytes of built.retainedImageBytes) {
    bytes.fill(0);
  }
  if (!outcome.ok) {
    throw cleanupErrors.length === 0
      ? outcome.error
      : new AggregateError([outcome.error, ...cleanupErrors], "Assistant request and cleanup failed.");
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Assistant request cleanup failed.");
  }
  return outcome.value;
}

function buildRequest(
  input: VisionChatTurnInput,
  requestOptions: RequestOptions | undefined,
): { readonly request: Request; readonly retainedImageBytes: readonly Uint8Array[] } {
  const request = new Request();
  if (input.systemPrompt !== undefined) {
    request.addItem(Item.systemMessage(input.systemPrompt));
  }
  const retainedImageBytes: Uint8Array[] = [];
  if ((input.images?.length ?? 0) === 0) {
    request.addItem(Item.userMessage(input.prompt));
  } else {
    const parts: Array<TextItem | ImageItem> = [Item.text(input.prompt)];
    for (const image of input.images ?? []) {
      const copiedBytes = image.data.slice();
      retainedImageBytes.push(copiedBytes);
      parts.push(Item.imageFromData(image.format, copiedBytes));
    }
    request.addItem(Item.userMessage(parts));
  }
  if (requestOptions !== undefined) {
    request.setOptions(requestOptions);
  }
  return { request, retainedImageBytes };
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
