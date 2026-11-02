import type {
  Catalog,
  IModel,
  ImageItem,
  RequestOptions,
  RequestPreflightResult,
  Response,
  StreamingResponse,
  TextItem,
} from "foundry-local-sdk";
import { ChatSession, DeviceType, Item, Request } from "foundry-local-sdk";

export const VISION_LANGUAGE_CHAT_TASK = "vision-language-chat";
export const QWEN_VISION_CHAT_CANDIDATE_MODEL_ID = "qwen3.5-0.8b-generic-gpu:2";

export interface VisionChatRuntimeTarget {
  readonly deviceType: DeviceType;
  readonly executionProvider: string;
}

export interface OptionalVisionChatRuntimeConfig {
  readonly modelId: string;
  readonly runtime: VisionChatRuntimeTarget;
  readonly candidateModelIds?: readonly string[];
  readonly downloadIfNeeded?: boolean;
  readonly requestOptions?: RequestOptions;
}

export type VisionCatalogHandle = Pick<Catalog, "getModelVariant">;
export type VisionChatSessionHandle = Pick<
  ChatSession,
  "preflightRequest" | "processStreamingRequest" | "dispose"
>;

export interface OptionalVisionChatRuntimeOptions {
  readonly createChatSession?: (model: IModel) => VisionChatSessionHandle;
}

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

export type VisionModelSelectionAttempt =
  | {
      readonly modelId: string;
      readonly source: "primary" | "candidate";
      readonly outcome: "catalog-error";
      readonly detail: string;
    }
  | {
      readonly modelId: string;
      readonly source: "primary" | "candidate";
      readonly outcome: "incompatible";
      readonly issues: readonly VisionModelCompatibilityIssue[];
    };

export interface ResolvedVisionChatModel {
  readonly model: IModel;
  readonly modelId: string;
  readonly source: "primary" | "candidate";
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
}

export interface PreparedVisionChatModel {
  readonly modelId: string;
  readonly source: "primary" | "candidate";
  readonly task: typeof VISION_LANGUAGE_CHAT_TASK;
  readonly runtime: VisionChatRuntimeTarget;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
}

export type VisionImageInput =
  | {
      readonly kind: "uri";
      readonly uri: string;
      readonly format?: string;
    }
  | {
      readonly kind: "data";
      readonly data: Uint8Array;
      readonly format: string;
    };

export interface VisionChatTurnInput {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly images?: readonly VisionImageInput[];
}

export interface VisionChatTurnOptions {
  readonly signal?: AbortSignal;
  readonly requestOptions?: RequestOptions;
}

export interface VisionChatTurnResult {
  readonly text: string;
  readonly model: PreparedVisionChatModel;
  readonly preflight: RequestPreflightResult;
  readonly response: Response;
}

export type OptionalVisionChatRuntimeState = "idle" | "preparing" | "ready" | "disposing" | "disposed";

export interface OptionalVisionChatRuntimeStatus {
  readonly state: OptionalVisionChatRuntimeState;
  readonly model: PreparedVisionChatModel | null;
  readonly turnActive: boolean;
}

export type OptionalVisionChatErrorCode =
  | "VISION_MODEL_UNAVAILABLE"
  | "MODEL_NOT_CACHED"
  | "MODEL_LOAD_FAILED"
  | "REQUEST_TOO_LARGE"
  | "INCOMPLETE_RESPONSE"
  | "EMPTY_RESPONSE"
  | "RUNTIME_BUSY"
  | "RUNTIME_DISPOSED";

export class OptionalVisionChatError extends Error {
  constructor(
    readonly code: OptionalVisionChatErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OptionalVisionChatError";
  }
}

export class VisionModelResolutionError extends OptionalVisionChatError {
  constructor(readonly attempts: readonly VisionModelSelectionAttempt[]) {
    super(
      "VISION_MODEL_UNAVAILABLE",
      `No exact compatible ${VISION_LANGUAGE_CHAT_TASK} model was found. ${attempts
        .map(describeSelectionAttempt)
        .join(" ")}`,
    );
    this.name = "VisionModelResolutionError";
  }
}

interface NormalizedConfig {
  readonly modelId: string;
  readonly runtime: VisionChatRuntimeTarget;
  readonly candidateModelIds: readonly string[];
  readonly downloadIfNeeded: boolean;
  readonly requestOptions?: RequestOptions;
}

interface ActiveTurn {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  readonly markSettled: () => void;
  retainedImageBytes: readonly Uint8Array[];
}

interface BuiltVisionRequest {
  readonly request: Request;
  readonly retainedImageBytes: readonly Uint8Array[];
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
    issues.push({
      field: "model.id",
      expected: expectedModelId,
      actual: model.id,
    });
  }
  if (info.id !== expectedModelId) {
    issues.push({
      field: "model.info.id",
      expected: expectedModelId,
      actual: info.id,
    });
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

  if (issues.length === 0) {
    return {
      compatible: true,
      inputModalities,
      outputModalities,
    };
  }
  return {
    compatible: false,
    inputModalities,
    outputModalities,
    issues,
  };
}

export async function resolveVisionChatModel(
  catalog: VisionCatalogHandle,
  config: OptionalVisionChatRuntimeConfig,
  signal?: AbortSignal,
): Promise<ResolvedVisionChatModel> {
  const normalized = normalizeConfig(config);
  const attempts: VisionModelSelectionAttempt[] = [];
  const modelIds = [normalized.modelId, ...normalized.candidateModelIds];

  for (const [index, modelId] of modelIds.entries()) {
    throwIfAborted(signal);
    const source = index === 0 ? "primary" : "candidate";
    let model: IModel;
    try {
      model = await catalog.getModelVariant(modelId);
    } catch (error) {
      attempts.push({
        modelId,
        source,
        outcome: "catalog-error",
        detail: errorMessage(error),
      });
      continue;
    }
    throwIfAborted(signal);
    const compatibility = inspectVisionChatModel(model, modelId, normalized.runtime);
    if (!compatibility.compatible) {
      attempts.push({
        modelId,
        source,
        outcome: "incompatible",
        issues: compatibility.issues,
      });
      continue;
    }
    return {
      model,
      modelId,
      source,
      inputModalities: compatibility.inputModalities,
      outputModalities: compatibility.outputModalities,
    };
  }

  throw new VisionModelResolutionError(attempts);
}

export class OptionalVisionChatRuntime {
  readonly #catalog: VisionCatalogHandle;
  readonly #config: NormalizedConfig;
  readonly #createChatSession: (model: IModel) => VisionChatSessionHandle;
  #state: OptionalVisionChatRuntimeState = "idle";
  #preparedModel: PreparedVisionChatModel | null = null;
  #model: IModel | null = null;
  #ownsModelLoad = false;
  #preparePromise: Promise<PreparedVisionChatModel> | null = null;
  #prepareController: AbortController | null = null;
  #activeTurn: ActiveTurn | null = null;
  #disposePromise: Promise<void> | null = null;

  constructor(
    catalog: VisionCatalogHandle,
    config: OptionalVisionChatRuntimeConfig,
    options: OptionalVisionChatRuntimeOptions = {},
  ) {
    this.#catalog = catalog;
    this.#config = normalizeConfig(config);
    this.#createChatSession = options.createChatSession ?? ((model) => new ChatSession(model));
  }

  get status(): OptionalVisionChatRuntimeStatus {
    return {
      state: this.#state,
      model: this.#preparedModel,
      turnActive: this.#activeTurn !== null,
    };
  }

  prepare(signal?: AbortSignal): Promise<PreparedVisionChatModel> {
    this.#assertUsable();
    if (this.#preparedModel !== null && this.#model !== null) {
      return Promise.resolve(this.#preparedModel);
    }
    if (this.#preparePromise !== null) {
      return awaitWithAbort(this.#preparePromise, signal);
    }

    const controller = new AbortController();
    const unlinkSignal = forwardAbort(signal, controller);
    this.#prepareController = controller;
    this.#state = "preparing";
    const operation = this.#performPrepare(controller, unlinkSignal);
    this.#preparePromise = operation;
    return operation;
  }

  cancelPreparation(reason?: unknown): boolean {
    const controller = this.#prepareController;
    if (controller === null || controller.signal.aborted) {
      return false;
    }
    controller.abort(reason);
    return true;
  }

  async runTurn(
    input: VisionChatTurnInput,
    options: VisionChatTurnOptions = {},
  ): Promise<VisionChatTurnResult> {
    this.#assertUsable();
    if (this.#activeTurn !== null) {
      throw new OptionalVisionChatError(
        "RUNTIME_BUSY",
        "The optional vision/chat runtime already has an active turn.",
      );
    }
    validateTurnInput(input);

    let markSettled = () => {};
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const controller = new AbortController();
    const unlinkSignal = forwardAbort(options.signal, controller);
    const active: ActiveTurn = {
      controller,
      settled,
      markSettled,
      retainedImageBytes: [],
    };
    this.#activeTurn = active;
    let session: VisionChatSessionHandle | null = null;

    try {
      const prepared = await awaitWithAbort(this.prepare(), controller.signal);
      throwIfAborted(controller.signal);
      const model = this.#model;
      if (model === null) {
        throw new OptionalVisionChatError(
          "MODEL_LOAD_FAILED",
          "The compatible vision/chat model is no longer available.",
        );
      }

      session = this.#createChatSession(model);
      const builtRequest = buildRequest(input, options.requestOptions ?? this.#config.requestOptions);
      active.retainedImageBytes = builtRequest.retainedImageBytes;
      const preflight = await session.preflightRequest(builtRequest.request);
      throwIfAborted(controller.signal);
      if (!preflight.fits) {
        throw new OptionalVisionChatError(
          "REQUEST_TOO_LARGE",
          `Vision/chat request needs ${preflight.requiredTokens} tokens but the context limit is ${preflight.contextLimitTokens}.`,
        );
      }

      const stream = session.processStreamingRequest(builtRequest.request, {
        signal: controller.signal,
      });
      const response = await responseFrom(stream);
      if (response.finishReason !== "stop") {
        throw new OptionalVisionChatError(
          "INCOMPLETE_RESPONSE",
          `Vision/chat generation ended with ${response.finishReason}.`,
        );
      }
      const text = extractDefaultText(response);
      if (!text.trim()) {
        throw new OptionalVisionChatError(
          "EMPTY_RESPONSE",
          "The local vision/chat model returned no default text.",
        );
      }
      return {
        text,
        model: prepared,
        preflight,
        response,
      };
    } finally {
      try {
        session?.dispose();
      } finally {
        for (const bytes of active.retainedImageBytes) {
          bytes.fill(0);
        }
        active.retainedImageBytes = [];
        unlinkSignal();
        if (this.#activeTurn === active) {
          this.#activeTurn = null;
        }
        active.markSettled();
      }
    }
  }

  cancelActiveTurn(reason?: unknown): boolean {
    const active = this.#activeTurn;
    if (active === null || active.controller.signal.aborted) {
      return false;
    }
    active.controller.abort(reason);
    return true;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) {
      return this.#disposePromise;
    }
    if (this.#state === "disposed") {
      return Promise.resolve();
    }
    this.#state = "disposing";
    this.cancelPreparation(new DOMException("Vision/chat runtime disposed.", "AbortError"));
    this.cancelActiveTurn(new DOMException("Vision/chat runtime disposed.", "AbortError"));
    const operation = this.#performDispose();
    this.#disposePromise = operation;
    return operation;
  }

  async #performPrepare(
    controller: AbortController,
    unlinkSignal: () => void,
  ): Promise<PreparedVisionChatModel> {
    let ownedModel: IModel | null = null;
    try {
      const selection = await resolveVisionChatModel(
        this.#catalog,
        {
          modelId: this.#config.modelId,
          runtime: this.#config.runtime,
          candidateModelIds: this.#config.candidateModelIds,
          downloadIfNeeded: this.#config.downloadIfNeeded,
          ...(this.#config.requestOptions === undefined
            ? {}
            : { requestOptions: this.#config.requestOptions }),
        },
        controller.signal,
      );
      const model = selection.model;
      if (!model.isCached) {
        if (!this.#config.downloadIfNeeded) {
          throw new OptionalVisionChatError(
            "MODEL_NOT_CACHED",
            `Exact compatible model ${selection.modelId} is not cached; SDK download was not enabled.`,
          );
        }
        await model.download(controller.signal);
      }
      throwIfAborted(controller.signal);
      const compatibility = inspectVisionChatModel(model, selection.modelId, this.#config.runtime);
      if (!compatibility.compatible) {
        throw new VisionModelResolutionError([
          {
            modelId: selection.modelId,
            source: selection.source,
            outcome: "incompatible",
            issues: compatibility.issues,
          },
        ]);
      }
      const alreadyLoaded = await model.isLoaded();
      if (!alreadyLoaded) {
        await model.load();
        ownedModel = model;
      }
      throwIfAborted(controller.signal);
      if (!(await model.isLoaded())) {
        throw new OptionalVisionChatError(
          "MODEL_LOAD_FAILED",
          `Exact compatible model ${selection.modelId} did not report loaded after SDK load().`,
        );
      }
      const finalCompatibility = inspectVisionChatModel(model, selection.modelId, this.#config.runtime);
      if (!finalCompatibility.compatible) {
        throw new VisionModelResolutionError([
          {
            modelId: selection.modelId,
            source: selection.source,
            outcome: "incompatible",
            issues: finalCompatibility.issues,
          },
        ]);
      }

      if (this.#state === "disposing" || this.#state === "disposed") {
        throw new OptionalVisionChatError(
          "RUNTIME_DISPOSED",
          "The optional vision/chat runtime was disposed during preparation.",
        );
      }
      const prepared: PreparedVisionChatModel = {
        modelId: selection.modelId,
        source: selection.source,
        task: VISION_LANGUAGE_CHAT_TASK,
        runtime: this.#config.runtime,
        inputModalities: finalCompatibility.inputModalities,
        outputModalities: finalCompatibility.outputModalities,
      };
      this.#model = model;
      this.#ownsModelLoad = ownedModel === model;
      this.#preparedModel = prepared;
      this.#state = "ready";
      return prepared;
    } catch (error) {
      if (this.#state !== "disposing" && this.#state !== "disposed") {
        this.#state = "idle";
      }
      if (ownedModel !== null) {
        try {
          if (await ownedModel.isLoaded()) {
            await ownedModel.unload();
          }
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Vision/chat preparation failed and its owned optional model could not be unloaded.",
          );
        }
      }
      throw error;
    } finally {
      unlinkSignal();
      if (this.#prepareController === controller) {
        this.#prepareController = null;
        this.#preparePromise = null;
      }
    }
  }

  async #performDispose(): Promise<void> {
    const preparation = this.#preparePromise;
    if (preparation !== null) {
      await preparation.catch(() => undefined);
    }
    const active = this.#activeTurn;
    if (active !== null) {
      await active.settled;
    }

    const model = this.#model;
    const ownsModelLoad = this.#ownsModelLoad;
    try {
      if (model !== null && ownsModelLoad && (await model.isLoaded())) {
        await model.unload();
      }
    } finally {
      this.#model = null;
      this.#ownsModelLoad = false;
      this.#preparedModel = null;
      this.#state = "disposed";
    }
  }

  #assertUsable(): void {
    if (this.#state === "disposing" || this.#state === "disposed") {
      throw new OptionalVisionChatError(
        "RUNTIME_DISPOSED",
        "The optional vision/chat runtime is disposing or disposed.",
      );
    }
  }
}

function normalizeConfig(config: OptionalVisionChatRuntimeConfig): NormalizedConfig {
  assertExactNonBlank(config.modelId, "Vision/chat model id");
  assertExactNonBlank(config.runtime.executionProvider, "Vision/chat execution provider");
  if (config.runtime.deviceType === DeviceType.Invalid) {
    throw new TypeError("Vision/chat runtime device type must not be Invalid.");
  }

  const configuredCandidates = config.candidateModelIds ?? ([QWEN_VISION_CHAT_CANDIDATE_MODEL_ID] as const);
  const candidateModelIds: string[] = [];
  const seen = new Set([config.modelId]);
  for (const candidate of configuredCandidates) {
    assertExactNonBlank(candidate, "Vision/chat candidate model id");
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidateModelIds.push(candidate);
    }
  }

  return {
    modelId: config.modelId,
    runtime: {
      deviceType: config.runtime.deviceType,
      executionProvider: config.runtime.executionProvider,
    },
    candidateModelIds,
    downloadIfNeeded: config.downloadIfNeeded ?? false,
    ...(config.requestOptions === undefined ? {} : { requestOptions: config.requestOptions }),
  };
}

function validateTurnInput(input: VisionChatTurnInput): void {
  if (!input.prompt.trim()) {
    throw new TypeError("Vision/chat prompt must not be blank.");
  }
  if (input.systemPrompt !== undefined && !input.systemPrompt.trim()) {
    throw new TypeError("Vision/chat system prompt must not be blank.");
  }
  for (const image of input.images ?? []) {
    if (image.kind === "uri") {
      assertExactNonBlank(image.uri, "Vision image URI");
      if (image.format !== undefined) {
        assertExactNonBlank(image.format, "Vision image format");
      }
      continue;
    }
    assertExactNonBlank(image.format, "Vision image format");
    if (image.data.byteLength === 0) {
      throw new TypeError("Vision image data must not be empty.");
    }
  }
}

function buildRequest(
  input: VisionChatTurnInput,
  requestOptions: RequestOptions | undefined,
): BuiltVisionRequest {
  const request = new Request();
  if (input.systemPrompt !== undefined) {
    request.addItem(Item.systemMessage(input.systemPrompt));
  }

  const images = input.images ?? [];
  const retainedImageBytes: Uint8Array[] = [];
  if (images.length === 0) {
    request.addItem(Item.userMessage(input.prompt));
  } else {
    const parts: Array<TextItem | ImageItem> = [Item.text(input.prompt)];
    for (const image of images) {
      if (image.kind === "uri") {
        parts.push(Item.imageFromUri(image.uri, image.format));
      } else {
        const copiedBytes = new Uint8Array(image.data);
        retainedImageBytes.push(copiedBytes);
        parts.push(Item.imageFromData(image.format, copiedBytes));
      }
    }
    request.addItem(Item.userMessage(parts));
  }
  if (requestOptions !== undefined) {
    request.setOptions(requestOptions);
  }
  return {
    request,
    retainedImageBytes,
  };
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

async function responseFrom(stream: StreamingResponse): Promise<Response> {
  return await stream.response;
}

function describeSelectionAttempt(attempt: VisionModelSelectionAttempt): string {
  if (attempt.outcome === "catalog-error") {
    return `${attempt.source} ${attempt.modelId}: catalog lookup failed (${attempt.detail}).`;
  }
  return `${attempt.source} ${attempt.modelId}: ${attempt.issues
    .map((issue) => `${issue.field} expected ${issue.expected}, got ${issue.actual ?? "(missing)"}`)
    .join("; ")}.`;
}

function assertExactNonBlank(value: string, label: string): void {
  if (!value.trim()) {
    throw new TypeError(`${label} must not be blank.`);
  }
  if (value !== value.trim()) {
    throw new TypeError(`${label} must not have leading or trailing whitespace.`);
  }
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined) {
    return () => {};
  }
  const onAbort = () => {
    controller.abort(signal.reason);
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError(signal.reason);
  }
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") {
    return reason;
  }
  const error = new Error("Vision/chat operation aborted.", { cause: reason });
  error.name = "AbortError";
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
