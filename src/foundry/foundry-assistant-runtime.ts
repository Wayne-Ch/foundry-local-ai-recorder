import type { EpDownloadResult, EpInfo, FoundryLocalConfig, RequestOptions } from "foundry-local-sdk";
import { FoundryLocalManager } from "foundry-local-sdk";
import { AUDIO_EXECUTION_PROVIDER } from "../audio/audio-types";
import { type AssistantRuntimeTarget, resolveAssistantRuntimeTarget } from "./assistant-runtime-config";
import {
  OptionalVisionChatRuntime,
  type OptionalVisionChatRuntimeStatus,
  type PreparedVisionChatModel,
  type VisionCatalogHandle,
  type VisionChatTurnInput,
  type VisionChatTurnResult,
} from "./optional-vision-chat-runtime";
import type { RecorderPaths } from "./paths";
import { resolveRecorderPaths } from "./paths";
import { canonicalExecutionProvider } from "./runtime-config";

interface AssistantManagerHandle {
  readonly catalog: VisionCatalogHandle;
  readonly urls?: readonly string[];
  readonly isWebServiceRunning?: boolean;
  discoverEps(): EpInfo[];
  downloadAndRegisterEps(
    names: string[],
    progressCallback: (epName: string, percent: number) => void,
  ): Promise<EpDownloadResult>;
  shutdown(): void;
  dispose(): void;
}

interface VisionRuntimeHandle {
  readonly status: OptionalVisionChatRuntimeStatus;
  prepare(signal?: AbortSignal): Promise<PreparedVisionChatModel>;
  runTurn(
    input: VisionChatTurnInput,
    options?: { readonly signal?: AbortSignal; readonly requestOptions?: RequestOptions },
  ): Promise<VisionChatTurnResult>;
  cancelActiveTurn(reason?: unknown): boolean;
  dispose(): Promise<void>;
}

export interface AssistantRuntimeProgress {
  readonly phase: "provider" | "model";
  readonly detail: string;
}

export interface FoundryAssistantRuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resolvePaths?: () => Promise<RecorderPaths>;
  readonly createManager?: (config: FoundryLocalConfig) => AssistantManagerHandle;
  readonly createVisionRuntime?: (
    catalog: VisionCatalogHandle,
    target: AssistantRuntimeTarget,
  ) => VisionRuntimeHandle;
}

export class FoundryAssistantRuntime {
  readonly #target: AssistantRuntimeTarget;
  readonly #resolvePaths: () => Promise<RecorderPaths>;
  readonly #createManager: (config: FoundryLocalConfig) => AssistantManagerHandle;
  readonly #createVisionRuntime: (
    catalog: VisionCatalogHandle,
    target: AssistantRuntimeTarget,
  ) => VisionRuntimeHandle;
  #manager: AssistantManagerHandle | null = null;
  #runtime: VisionRuntimeHandle | null = null;
  #preparePromise: Promise<PreparedVisionChatModel> | null = null;
  #disposePromise: Promise<void> | null = null;
  #disposed = false;

  constructor(options: FoundryAssistantRuntimeOptions = {}) {
    this.#target = resolveAssistantRuntimeTarget(options.environment);
    this.#resolvePaths = options.resolvePaths ?? resolveRecorderPaths;
    this.#createManager = options.createManager ?? ((config) => FoundryLocalManager.create(config));
    this.#createVisionRuntime =
      options.createVisionRuntime ??
      ((catalog, target) =>
        new OptionalVisionChatRuntime(catalog, {
          modelId: target.modelId,
          runtime: {
            deviceType: target.deviceType,
            executionProvider: target.executionProvider,
          },
          candidateModelIds: [],
          downloadIfNeeded: true,
        }));
  }

  get target(): AssistantRuntimeTarget {
    return this.#target;
  }

  get status(): OptionalVisionChatRuntimeStatus | null {
    return this.#runtime?.status ?? null;
  }

  prepare(
    onProgress?: (event: AssistantRuntimeProgress) => void,
    signal?: AbortSignal,
  ): Promise<PreparedVisionChatModel> {
    this.#assertUsable();
    if (this.#preparePromise !== null) {
      return this.#preparePromise;
    }
    let tracked: Promise<PreparedVisionChatModel>;
    tracked = this.#prepare(onProgress, signal).finally(() => {
      if (this.#preparePromise === tracked) {
        this.#preparePromise = null;
      }
    });
    this.#preparePromise = tracked;
    return tracked;
  }

  async runTurn(
    input: VisionChatTurnInput,
    options: { readonly signal?: AbortSignal; readonly requestOptions?: RequestOptions } = {},
  ): Promise<VisionChatTurnResult> {
    await this.prepare(undefined, options.signal);
    this.#assertUsable();
    const runtime = this.#runtime;
    if (runtime === null) {
      throw new Error("The optional local vision/chat runtime is not initialized.");
    }
    return runtime.runTurn(input, options);
  }

  cancelActiveTurn(reason?: unknown): boolean {
    return this.#runtime?.cancelActiveTurn(reason) ?? false;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) {
      return this.#disposePromise;
    }
    if (this.#disposed) {
      return Promise.resolve();
    }
    this.#disposed = true;
    const operation = this.#dispose();
    this.#disposePromise = operation;
    return operation;
  }

  async #prepare(
    onProgress: ((event: AssistantRuntimeProgress) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<PreparedVisionChatModel> {
    const manager = await this.#ensureManager();
    await this.#ensureProvider(manager, onProgress);
    this.#assertUsable();
    this.#runtime ??= this.#createVisionRuntime(manager.catalog, this.#target);
    onProgress?.({
      phase: "model",
      detail: `Preparing exact optional model ${this.#target.modelId}.`,
    });
    return this.#runtime.prepare(signal);
  }

  async #ensureManager(): Promise<AssistantManagerHandle> {
    if (this.#manager !== null) {
      try {
        this.#validateInProcessBoundary(this.#manager);
        return this.#manager;
      } catch (error) {
        const manager = this.#manager;
        const runtime = this.#runtime;
        this.#manager = null;
        this.#runtime = null;
        const cleanupErrors: unknown[] = [];
        try {
          await runtime?.dispose();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        cleanupErrors.push(...cleanupManager(manager));
        throw combineErrors(error, cleanupErrors, "Optional assistant endpoint cleanup failed.");
      }
    }
    const paths = await this.#resolvePaths();
    this.#assertUsable();
    const manager = this.#createManager({
      appName: "FoundryLocalSmartAIRecorderAssistant",
      appDataDir: paths.appDataDir,
      modelCacheDir: paths.modelCacheDir,
      logsDir: paths.logsDir,
      logLevel: "info",
      disableNonessentialTelemetry: true,
    });
    try {
      this.#validateInProcessBoundary(manager);
      this.#manager = manager;
      return manager;
    } catch (error) {
      const cleanupErrors = cleanupManager(manager);
      throw combineErrors(error, cleanupErrors, "Optional assistant manager cleanup failed.");
    }
  }

  async #ensureProvider(
    manager: AssistantManagerHandle,
    onProgress?: (event: AssistantRuntimeProgress) => void,
  ): Promise<void> {
    if (this.#target.executionProvider === AUDIO_EXECUTION_PROVIDER) {
      return;
    }
    const provider = manager
      .discoverEps()
      .find((candidate) => canonicalExecutionProvider(candidate.name) === this.#target.executionProvider);
    if (provider === undefined) {
      throw new Error(`Optional execution provider ${this.#target.executionProvider} is not discoverable.`);
    }
    if (provider.isRegistered) {
      return;
    }
    const result = await manager.downloadAndRegisterEps([provider.name], (name, percent) => {
      onProgress?.({
        phase: "provider",
        detail: `${name} ${percent.toFixed(1)}%`,
      });
    });
    if (!result.success || result.failedEps.length > 0) {
      throw new Error(`Optional execution provider registration failed: ${result.status}`);
    }
  }

  #validateInProcessBoundary(manager: AssistantManagerHandle): void {
    const urls = manager.urls?.filter((url) => url.trim().length > 0) ?? [];
    if (manager.isWebServiceRunning === true || urls.length > 0) {
      throw new Error("The optional assistant endpoint guard rejected an embedded or external web service.");
    }
  }

  async #dispose(): Promise<void> {
    const runtime = this.#runtime;
    const manager = this.#manager;
    this.#runtime = null;
    this.#manager = null;
    const errors: unknown[] = [];
    try {
      await runtime?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (manager !== null) {
      errors.push(...cleanupManager(manager));
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Optional assistant cleanup failed.");
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("The optional assistant runtime is disposed.");
    }
  }
}

function cleanupManager(manager: AssistantManagerHandle): unknown[] {
  const errors: unknown[] = [];
  try {
    manager.shutdown();
  } catch (error) {
    errors.push(error);
  }
  try {
    manager.dispose();
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

function combineErrors(primary: unknown, cleanupErrors: readonly unknown[], message: string): Error {
  if (cleanupErrors.length === 0) {
    return primary instanceof Error ? primary : new Error(String(primary));
  }
  return new AggregateError([primary, ...cleanupErrors], message);
}
