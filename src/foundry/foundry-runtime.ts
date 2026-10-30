import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { EpDownloadResult, EpInfo, FoundryLocalConfig, IModel } from "foundry-local-sdk";
import {
  AudioSession,
  ChatSession,
  FoundryLocalManager,
  Item,
  ItemQueue,
  Request,
  type RequestPreflightResult,
  type Response,
  type StreamingResponse,
} from "foundry-local-sdk";
import { audioDurationMsFromPcmBytes, StreamingTranscriptAccumulator } from "../audio/audio-contract";
import {
  AUDIO_BYTES_PER_SAMPLE,
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_LANGUAGE,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_MIN_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  AUDIO_STREAM_CHUNK_BYTES,
  AUDIO_STREAM_MAX_CHUNKS,
  AUDIO_STREAM_MAX_QUEUED_CHUNKS,
  type AudioModelIdentity,
  type AudioPartialTranscriptEvent,
  type AudioStreamChunkResponse,
  type AudioStreamFinishRequest,
  type AudioStreamStartResponse,
  type AudioTranscriptionResult,
  type ValidatedAudioCapture,
} from "../audio/audio-types";
import { TempAudioStore, withTemporaryWav } from "../audio/temp-audio-store";
import type { ModelIdentity, ModelReadiness, ProgressEvent, RuntimeReadiness } from "../shared/contracts";
import { formatSafeDiagnostic, type SafeDiagnostic, toSafeDiagnostic } from "../shared/safe-diagnostic";
import { SUMMARY_SYSTEM_PROMPT, summaryUserPrompt } from "../summary/summary-prompt";
import { ModelSlot } from "./model-slot";
import { type RecorderPaths, resolveRecorderPaths } from "./paths";
import {
  canonicalExecutionProvider,
  type ModelRole,
  type RuntimeTarget,
  type RuntimeTargets,
  resolveRuntimeTargets,
} from "./runtime-config";

interface CatalogHandle {
  getCachedModels(): Promise<IModel[]>;
  getModelVariant(modelId: string): Promise<IModel>;
}

interface ManagerHandle {
  readonly catalog: CatalogHandle;
  readonly urls?: string[];
  readonly isWebServiceRunning?: boolean;
  discoverEps(): EpInfo[];
  downloadAndRegisterEps(
    names: string[],
    progressCallback: (epName: string, percent: number) => void,
  ): Promise<EpDownloadResult>;
  shutdown(): void;
  dispose(): void;
}

interface ManagerContext {
  readonly handle: ManagerHandle;
  readonly epoch: number;
}

interface QuarantinedManager {
  readonly manager: ManagerContext;
  shutdownConfirmed: boolean;
  disposeConfirmed: boolean;
}

interface ChatSessionHandle {
  readonly turnCount: number;
  preflightRequest(request: Request): Promise<RequestPreflightResult>;
  processRequest(request: Request): Promise<Response>;
  dispose(): void;
}

interface AudioSessionHandle {
  processRequest(request: Request): Promise<Response>;
  processStreamingRequest(request: Request, options?: { readonly signal?: AbortSignal }): StreamingResponse;
  dispose(): void;
}

interface ActiveAudioStream {
  readonly id: string;
  readonly generation: number;
  readonly model: IModel;
  readonly session: AudioSessionHandle;
  readonly queue: ItemQueue;
  readonly request: Request;
  readonly abortController: AbortController;
  readonly stream: StreamingResponse;
  readonly responsePromise: Promise<Response>;
  readonly accumulator: StreamingTranscriptAccumulator;
  readonly startedAt: number;
  readonly onPartial: (event: AudioPartialTranscriptEvent) => void;
  consumePromise: Promise<void>;
  nextSequence: number;
  partialSequence: number;
  totalBytes: number;
  firstPartialMs: number | null;
  stopRequestedAt: number | null;
  streamError: unknown | null;
  cleanedUp: boolean;
  queueDisposed: boolean;
  sessionDisposed: boolean;
  terminationPromise: Promise<void> | null;
  terminationResultPromise: Promise<void> | null;
}

interface ActiveNativeOperation {
  readonly kind: "whisper" | "summary";
  readonly generation: number;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  cancel: (() => void) | null;
  cancelRequested: boolean;
  cancelInvoked: boolean;
  cancelError: unknown | null;
}

interface NativeOperationContext {
  setCancel(cancel: () => void): void;
  assertCurrent(): void;
}

interface LifecycleCleanupGeneration {
  readonly generation: number;
  shutdownRequested: boolean;
  completion: Promise<void>;
  result: Promise<void>;
}

export interface SummaryGenerationResult {
  readonly text: string;
  readonly durationMs: number;
  readonly model: ModelIdentity;
  readonly preflight: RequestPreflightResult;
  readonly response: Response;
}

export interface PrepareRuntimeResult {
  readonly readiness: RuntimeReadiness;
  readonly liveCaptionsAvailable: boolean;
  readonly liveCaptionsFailure: SafeDiagnostic | null;
}

export interface FoundryRecorderRuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resolvePaths?: () => Promise<RecorderPaths>;
  readonly createManager?: (config: FoundryLocalConfig) => ManagerHandle;
  readonly createChatSession?: (model: IModel) => ChatSessionHandle;
  readonly createAudioSession?: (model: IModel) => AudioSessionHandle;
  readonly tempAudioStore?: TempAudioStore;
  readonly settlementTimeoutMs?: number;
}

const DEFAULT_SETTLEMENT_TIMEOUT_MS = 10_000;

export class FoundryRecorderRuntime {
  readonly #targets: RuntimeTargets;
  readonly #resolvePaths: () => Promise<RecorderPaths>;
  readonly #createManager: (config: FoundryLocalConfig) => ManagerHandle;
  readonly #createChatSession: (model: IModel) => ChatSessionHandle;
  readonly #createAudioSession: (model: IModel) => AudioSessionHandle;
  readonly #slots: Record<ModelRole, ModelSlot<IModel>> = {
    whisper: new ModelSlot<IModel>(),
    nemotron: new ModelSlot<IModel>(),
    summary: new ModelSlot<IModel>(),
  };
  #manager: ManagerContext | null = null;
  #quarantinedManager: QuarantinedManager | null = null;
  #managerEpoch = 0;
  #tempAudioStore: TempAudioStore | null;
  #initializePromise: Promise<void> | null = null;
  #preparePromise: Promise<PrepareRuntimeResult> | null = null;
  #activeStream: ActiveAudioStream | null = null;
  readonly #activeOperations = new Set<ActiveNativeOperation>();
  readonly #settlementTimeoutMs: number;
  #cleanupCompletion: Promise<void> | null = null;
  #lifecycleCleanup: LifecycleCleanupGeneration | null = null;
  #generation = 0;
  #shutdownRequested = false;
  #shutdownComplete = false;
  #invalidatingManager = false;
  #audioCleanupRequired = false;
  #readiness: RuntimeReadiness;

  constructor(options: FoundryRecorderRuntimeOptions = {}) {
    this.#targets = resolveRuntimeTargets(options.environment);
    this.#resolvePaths = options.resolvePaths ?? resolveRecorderPaths;
    this.#createManager = options.createManager ?? ((config) => FoundryLocalManager.create(config));
    this.#createChatSession = options.createChatSession ?? ((model) => new ChatSession(model));
    this.#createAudioSession = options.createAudioSession ?? ((model) => new AudioSession(model));
    this.#tempAudioStore = options.tempAudioStore ?? null;
    this.#settlementTimeoutMs = options.settlementTimeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS;
    if (!Number.isFinite(this.#settlementTimeoutMs) || this.#settlementTimeoutMs <= 0) {
      throw new Error("Native settlement timeout must be a positive finite duration.");
    }
    this.#readiness = initialReadiness(this.#targets);
  }

  get readiness(): RuntimeReadiness {
    return this.#readiness;
  }

  get cleanupCompletion(): Promise<void> | null {
    return this.#cleanupCompletion;
  }

  initialize(): Promise<void> {
    this.#assertNotShutdown();
    if (this.#initializePromise !== null) {
      return this.#initializePromise;
    }
    let trackedPromise: Promise<void>;
    trackedPromise = this.#initializeOrRevalidate().finally(() => {
      if (this.#initializePromise === trackedPromise) {
        this.#initializePromise = null;
      }
    });
    this.#initializePromise = trackedPromise;
    return trackedPromise;
  }

  prepare(
    enableLiveCaptions: boolean,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareRuntimeResult> {
    this.#assertNotShutdown();
    if (this.#preparePromise !== null) {
      return this.#preparePromise;
    }
    const generation = this.#generation;
    let trackedPromise: Promise<PrepareRuntimeResult>;
    trackedPromise = this.#prepare(enableLiveCaptions, generation, onProgress).finally(() => {
      if (this.#preparePromise === trackedPromise) {
        this.#preparePromise = null;
      }
    });
    this.#preparePromise = trackedPromise;
    return trackedPromise;
  }

  async startLiveStream(
    onPartial: (event: AudioPartialTranscriptEvent) => void,
  ): Promise<AudioStreamStartResponse> {
    this.#assertAvailable();
    if (this.#activeStream !== null) {
      throw new Error("The previous live-caption stream is still active or draining.");
    }
    await this.#ensureValidatedManager();
    this.#assertAvailable();
    if (this.#activeStream !== null) {
      throw new Error("The previous live-caption stream is still active or draining.");
    }
    const model = this.#requireModel("nemotron");
    const generation = this.#generation;
    let session: AudioSessionHandle | null = null;
    let queue: ItemQueue | null = null;
    let request: Request | null = null;
    try {
      session = this.#createAudioSession(model);
      queue = new ItemQueue();
      request = new Request()
        .addItem(Item.audioDescriptor("pcm", AUDIO_SAMPLE_RATE, AUDIO_CHANNELS))
        .addItem(queue);
      const abortController = new AbortController();
      const stream = session.processStreamingRequest(request, { signal: abortController.signal });
      const active: ActiveAudioStream = {
        id: randomUUID(),
        generation,
        model,
        session,
        queue,
        request,
        abortController,
        stream,
        responsePromise: stream.response,
        accumulator: new StreamingTranscriptAccumulator(),
        startedAt: performance.now(),
        onPartial,
        consumePromise: Promise.resolve(),
        nextSequence: 0,
        partialSequence: 0,
        totalBytes: 0,
        firstPartialMs: null,
        stopRequestedAt: null,
        streamError: null,
        cleanedUp: false,
        queueDisposed: false,
        sessionDisposed: false,
        terminationPromise: null,
        terminationResultPromise: null,
      };
      void active.responsePromise.catch((error) => {
        active.streamError ??= error;
      });
      active.consumePromise = this.#consumeAudioStream(active);
      this.#activeStream = active;
      return {
        streamId: active.id,
        model: audioModelIdentity(model, true),
        mode: "nemotron_streaming",
      };
    } catch (error) {
      const cleanupErrors = await collectCleanupErrors([
        () => request?.cancel(),
        () => queue?.dispose(),
        () => session?.dispose(),
      ]);
      const failure = combineErrors(
        error,
        cleanupErrors,
        `Failed to start Nemotron live captions: ${errorMessage(error)} Cleanup also failed.`,
      );
      throw new Error(`Failed to start Nemotron live captions: ${errorMessage(failure)}`, {
        cause: failure,
      });
    }
  }

  appendLiveChunk(streamId: string, sequence: number, pcmBytes: Uint8Array): AudioStreamChunkResponse {
    const active = this.#requireStream(streamId);
    this.#assertCurrent(active.generation);
    if (active.stopRequestedAt !== null || active.queue.finished) {
      throw new Error("The live audio stream no longer accepts chunks.");
    }
    if (sequence !== active.nextSequence) {
      throw new Error(`Expected audio chunk ${active.nextSequence}, received ${sequence}.`);
    }
    if (active.nextSequence >= AUDIO_STREAM_MAX_CHUNKS) {
      throw new Error("Audio stream exceeded the maximum number of chunks.");
    }
    if (active.streamError !== null) {
      throw new Error(`The native live audio stream failed: ${errorMessage(active.streamError)}`, {
        cause: active.streamError,
      });
    }
    if (
      pcmBytes.byteLength === 0 ||
      pcmBytes.byteLength > AUDIO_STREAM_CHUNK_BYTES ||
      pcmBytes.byteLength % AUDIO_BYTES_PER_SAMPLE !== 0
    ) {
      throw new Error(`Audio chunks must contain 1-${AUDIO_STREAM_CHUNK_BYTES} complete PCM bytes.`);
    }
    if (active.totalBytes + pcmBytes.byteLength > AUDIO_MAX_PCM_BYTES) {
      throw new Error("Audio stream exceeded the maximum recording duration.");
    }
    if (active.queue.size >= AUDIO_STREAM_MAX_QUEUED_CHUNKS) {
      throw new Error("Audio stream backpressure capacity was exceeded.");
    }
    active.queue.push(Item.bytes(pcmBytes.slice()));
    active.totalBytes += pcmBytes.byteLength;
    active.nextSequence += 1;
    return { acceptedSequence: sequence, totalBytes: active.totalBytes };
  }

  async finishLiveStream(input: AudioStreamFinishRequest): Promise<AudioTranscriptionResult> {
    const active = this.#requireStream(input.streamId);
    this.#assertCurrent(active.generation);
    active.stopRequestedAt = performance.now();
    let result: AudioTranscriptionResult | null = null;
    let operationError: unknown | null = null;
    try {
      if (input.lastSequence !== active.nextSequence - 1) {
        throw new Error(
          `Expected final audio sequence ${active.nextSequence - 1}, received ${input.lastSequence}.`,
        );
      }
      const measuredDuration = audioDurationMsFromPcmBytes(active.totalBytes);
      if (measuredDuration < AUDIO_MIN_DURATION_MS || measuredDuration > AUDIO_MAX_DURATION_MS) {
        throw new Error(`Stream contains ${measuredDuration} ms of audio, outside the prototype bounds.`);
      }
      if (measuredDuration !== input.audioDurationMs) {
        throw new Error(
          `Stream duration ${input.audioDurationMs} ms does not match ${active.totalBytes} PCM bytes.`,
        );
      }
      active.queue.markFinished();
      await active.consumePromise;
      if (active.streamError !== null) {
        throw active.streamError;
      }
      const response = await active.responsePromise;
      this.#assertCurrent(active.generation);
      const speechResult = response.output.find((item) => item.type === "speechResult");
      if (speechResult?.type !== "speechResult" || !speechResult.text.trim()) {
        throw new Error("Nemotron returned no terminal transcript.");
      }
      const completedAt = performance.now();
      result = {
        transcript: active.accumulator.finalize(speechResult.text.trim()).trim(),
        transcriptionMs: Math.round(completedAt - active.startedAt),
        audioDurationMs: measuredDuration,
        model: audioModelIdentity(active.model, true),
        mode: "nemotron_streaming",
        transcriptSource: "live_stream_final",
        firstPartialMs: active.firstPartialMs,
        finalizationMs: Math.round(completedAt - active.stopRequestedAt),
        externalEndpointUsed: false,
      };
    } catch (error) {
      operationError = error;
    }

    let terminationError: unknown | null = null;
    try {
      await this.#terminateStream(active);
    } catch (error) {
      terminationError = error;
    }
    if (operationError !== null) {
      if (terminationError !== null) {
        throw new AggregateError(
          [operationError, terminationError],
          "Nemotron finalization failed and native stream cleanup also failed.",
        );
      }
      throw operationError;
    }
    if (terminationError !== null) {
      throw terminationError;
    }
    if (result === null) {
      throw new Error("Nemotron finalization completed without a result.");
    }
    return result;
  }

  cancelLiveStream(streamId: string): Promise<void> {
    const active = this.#activeStream;
    if (active === null || active.id !== streamId) {
      return Promise.resolve();
    }
    return this.#terminateStream(active);
  }

  async transcribeCapture(capture: ValidatedAudioCapture): Promise<AudioTranscriptionResult> {
    this.#assertAvailable();
    await this.#ensureValidatedManager();
    this.#assertAvailable();
    const model = this.#requireModel("whisper");
    const store = this.#requireTempStore();
    const generation = this.#generation;
    const startedAt = performance.now();
    return this.#runTrackedOperation("whisper", generation, async (operation) => {
      try {
        const transcript = await withTemporaryWav(store, capture.pcmBytes, async (filePath) => {
          operation.assertCurrent();
          const session = this.#createAudioSession(model);
          const request = new Request();
          operation.setCancel(() => request.cancel());
          return await runWithCleanup(
            async () => {
              request
                .addItem(Item.audioFromUri(filePath))
                .setOptions({ search: { temperature: 0 }, additionalOptions: { language: AUDIO_LANGUAGE } });
              const response = await session.processRequest(request);
              operation.assertCurrent();
              const speechResult = response.output.find((item) => item.type === "speechResult");
              if (speechResult?.type !== "speechResult" || !speechResult.text.trim()) {
                throw new Error("Whisper returned no final speech transcript.");
              }
              return speechResult.text;
            },
            [() => request.cancel(), () => session.dispose()],
            "Whisper native request",
          );
        });
        const durationMs = Math.round(performance.now() - startedAt);
        return {
          transcript,
          transcriptionMs: durationMs,
          audioDurationMs: capture.durationMs,
          model: audioModelIdentity(model, false),
          mode: "whisper_file",
          transcriptSource: "whisper_file_final",
          firstPartialMs: null,
          finalizationMs: durationMs,
          externalEndpointUsed: false,
        };
      } catch (error) {
        throw new Error(`Whisper transcription failed: ${errorMessage(error)}`, { cause: error });
      }
    });
  }

  async summarize(transcript: string): Promise<SummaryGenerationResult> {
    this.#assertAvailable();
    await this.#ensureValidatedManager();
    this.#assertAvailable();
    const model = this.#requireModel("summary");
    const generation = this.#generation;
    return this.#runTrackedOperation("summary", generation, async (operation) => {
      const session = this.#createChatSession(model);
      const request = new Request()
        .addItem(Item.systemMessage(SUMMARY_SYSTEM_PROMPT))
        .addItem(Item.userMessage(summaryUserPrompt(transcript)))
        .setOptions({
          search: {
            doSample: false,
            temperature: 0,
            seed: 42,
            maxOutputTokens: 260,
          },
          toolChoice: "none",
          additionalOptions: {
            chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
          },
        });
      operation.setCancel(() => request.cancel());
      const startedAt = performance.now();
      return await runWithCleanup(
        async () => {
          const preflight = await session.preflightRequest(request);
          operation.assertCurrent();
          if (!preflight.fits) {
            throw new Error(
              `Summary request needs ${preflight.requiredTokens} tokens but the context limit is ${preflight.contextLimitTokens}.`,
            );
          }
          const response = await session.processRequest(request);
          operation.assertCurrent();
          if (response.finishReason !== "stop") {
            throw new Error(`Summary generation ended with ${response.finishReason}.`);
          }
          const text = extractDefaultText(response);
          if (!text) {
            throw new Error("The local summary model returned no text.");
          }
          if (text.length > 2_500) {
            throw new Error("The local summary exceeded the prototype output bound.");
          }
          return {
            text,
            durationMs: Math.round(performance.now() - startedAt),
            model: modelIdentity("summary", model),
            preflight,
            response,
          };
        },
        [() => request.cancel(), () => session.dispose()],
        "Qwen native request",
      );
    });
  }

  reset(): Promise<void> {
    if (this.#lifecycleCleanup !== null) {
      return this.#lifecycleCleanup.result;
    }
    this.#assertNotShutdown();
    this.#generation += 1;
    return this.#startLifecycleCleanup(false);
  }

  shutdown(): Promise<void> {
    if (this.#shutdownComplete) {
      return Promise.resolve();
    }
    if (this.#lifecycleCleanup !== null) {
      if (!this.#lifecycleCleanup.shutdownRequested) {
        this.#lifecycleCleanup.shutdownRequested = true;
        this.#shutdownRequested = true;
        this.#setCleanupDetail("Native recorder work is draining before model and manager shutdown.");
      }
      return this.#lifecycleCleanup.result;
    }
    if (!this.#shutdownRequested) {
      this.#shutdownRequested = true;
      this.#generation += 1;
    }
    return this.#startLifecycleCleanup(true);
  }

  async #initializeOrRevalidate(): Promise<void> {
    await this.#recoverBlockingCleanup();
    if (this.#manager !== null) {
      await this.#revalidateExistingManager(this.#manager);
      return;
    }
    await this.#initialize();
  }

  async #initialize(): Promise<void> {
    const paths = await this.#resolvePaths();
    this.#assertAvailable();
    this.#tempAudioStore ??= new TempAudioStore(paths.audioTempDir);
    const recovery = await this.#tempAudioStore.recoverOwnedCaptures();
    this.#assertAvailable();
    this.#readiness = {
      ...this.#readiness,
      modelCachePath: paths.modelCacheDir,
      audioRecovery: {
        ...this.#readiness.audioRecovery,
        discovered: recovery.discovered,
        removed: recovery.removed,
        retained: recovery.retained,
      },
    };
    const manager: ManagerContext = {
      handle: this.#createManager({
        appName: "FoundryLocalSmartAIRecorder",
        appDataDir: paths.appDataDir,
        modelCacheDir: paths.modelCacheDir,
        logsDir: paths.logsDir,
        logLevel: "info",
        disableNonessentialTelemetry: true,
      }),
      epoch: this.#managerEpoch + 1,
    };
    this.#managerEpoch = manager.epoch;
    try {
      this.#assertAvailable();
      this.#validateInProcessBoundary(manager.handle);
      this.#manager = manager;
    } catch (error) {
      await this.#invalidateManager(manager, error);
    }
  }

  async #revalidateExistingManager(manager: ManagerContext): Promise<void> {
    try {
      this.#validateInProcessBoundary(manager.handle);
    } catch (error) {
      await this.#invalidateManager(manager, error);
    }
  }

  async #ensureValidatedManager(): Promise<ManagerContext> {
    const manager = this.#requireManager();
    try {
      this.#validateInProcessBoundary(manager.handle);
      return manager;
    } catch (error) {
      return await this.#invalidateManager(manager, error);
    }
  }

  async #invalidateManager(manager: ManagerContext, primaryError: unknown): Promise<never> {
    this.#invalidatingManager = true;
    this.#generation += 1;
    if (this.#manager === manager) {
      this.#manager = null;
    }
    this.#quarantineManager(manager);
    for (const role of ["whisper", "nemotron", "summary"] as const) {
      this.#setReadiness(
        role,
        null,
        "error",
        "Inference is blocked because the in-process endpoint guard failed.",
      );
    }
    const cleanupCompletion = this.#queueCleanup(
      "Endpoint guard cleanup is draining native work before manager disposal.",
      async () => {
        const cleanupErrors: unknown[] = [];
        try {
          await this.#drainNativeResources();
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (this.#hasUnsafeNativeResources()) {
          throwCollectedErrors(
            cleanupErrors,
            "Endpoint guard cleanup could not confirm native resource disposal.",
          );
          throw new Error("Endpoint guard cleanup could not confirm native resource disposal.");
        }
        cleanupErrors.push(...(await this.#cleanupQuarantinedResources()));
        throwCollectedErrors(cleanupErrors, "Endpoint guard cleanup failed.");
      },
    );
    const cleanupErrors: unknown[] = [];
    try {
      await this.#awaitBoundedSettlement(cleanupCompletion, "Endpoint guard cleanup");
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      this.#invalidatingManager = false;
    }
    throw combineErrors(primaryError, cleanupErrors, "Endpoint guard cleanup failed.");
  }

  async #prepare(
    enableLiveCaptions: boolean,
    generation: number,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareRuntimeResult> {
    await this.initialize();
    this.#assertCurrent(generation);
    await this.#prepareModel("whisper", generation, onProgress);
    await this.#prepareModel("summary", generation, onProgress);
    let liveCaptionsFailure: SafeDiagnostic | null = null;
    if (enableLiveCaptions) {
      try {
        await this.#prepareModel("nemotron", generation, onProgress);
      } catch (error) {
        liveCaptionsFailure = toSafeDiagnostic(error, "OPTIONAL_LIVE_FAILED");
      }
    }
    this.#assertCurrent(generation);
    const manager = this.#requireManager();
    return {
      readiness: this.#readiness,
      liveCaptionsAvailable: this.#activeStream === null && this.#slots.nemotron.activeFor(manager) !== null,
      liveCaptionsFailure,
    };
  }

  async #prepareModel(
    role: ModelRole,
    generation: number,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<IModel> {
    const target = this.#targets[role];
    const manager = this.#requireManager();
    if (role === "nemotron" && this.#activeStream !== null) {
      throw new Error("The previous live-caption stream is still active or draining.");
    }
    const current = this.#slots[role].activeFor(manager);
    let candidate: IModel | null = null;
    try {
      if (
        current !== null &&
        current.id === target.modelId &&
        executionProvider(current) === target.executionProvider &&
        (await current.isLoaded())
      ) {
        this.#assertCurrent(generation);
        this.#setReadiness(role, current, "ready", `${current.id} is loaded and ready.`);
        return current;
      }

      this.#setReadiness(role, null, "checking", `Resolving exact ${role} model ${target.modelId}.`);
      candidate = await this.#resolveModel(target, manager);
      this.#assertCurrent(generation);
      this.#assertModel(role, candidate, target);
      this.#setReadiness(
        role,
        candidate,
        candidate.isCached ? "loading" : "downloading",
        candidate.isCached ? `Loading ${candidate.id}.` : `Downloading ${candidate.id}.`,
      );
      if (!candidate.isCached) {
        onProgress?.({ phase: `${role}:download`, detail: `Downloading exact model ${candidate.id}.` });
        await candidate.download((percent) => {
          onProgress?.({
            phase: `${role}:download`,
            detail: `${candidate?.id ?? target.modelId} ${percent.toFixed(1)}%`,
          });
        });
        this.#assertCurrent(generation);
        if (!candidate.isCached) {
          throw new Error(`Model download completed without caching ${candidate.id}.`);
        }
      }
      await this.#ensureProvider(target, manager.handle, onProgress);
      this.#assertCurrent(generation);
      onProgress?.({ phase: `${role}:load`, detail: `Loading ${candidate.id} in-process.` });
      await this.#slots[role].activate(candidate, manager);
      this.#assertCurrent(generation);
      this.#setReadiness(role, candidate, "ready", `${candidate.id} is ready for local inference.`);
      return candidate;
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (candidate !== null && candidate !== current) {
        try {
          if (this.#slots[role].active === candidate) {
            await this.#slots[role].clear();
          } else if (await candidate.isLoaded()) {
            await candidate.unload();
          }
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      const currentLoaded = current !== null && (await isModelLoaded(current));
      const failure = combineErrors(
        error,
        cleanupErrors,
        `Failed to clean up ${role} after model preparation failed.`,
      );
      this.#setReadiness(
        role,
        current,
        currentLoaded ? "ready" : "error",
        currentLoaded
          ? `Keeping working model ${current.id}; replacement preparation failed. ${formatSafeDiagnostic(
              toSafeDiagnostic(failure, "LOCAL_OPERATION_FAILED"),
            )}`
          : formatSafeDiagnostic(toSafeDiagnostic(failure, "LOCAL_OPERATION_FAILED")),
      );
      throw new Error(`Failed to prepare ${role}: ${errorMessage(failure)}`, { cause: failure });
    }
  }

  async #resolveModel(target: RuntimeTarget, manager: ManagerContext): Promise<IModel> {
    try {
      return await manager.handle.catalog.getModelVariant(target.modelId);
    } catch (catalogError) {
      const cached = (await manager.handle.catalog.getCachedModels()).find(
        (model) => model.id === target.modelId,
      );
      if (cached !== undefined) {
        return cached;
      }
      throw new Error(
        `Exact model ${target.modelId} is unavailable in the public catalog and local cache: ${errorMessage(
          catalogError,
        )}`,
        { cause: catalogError },
      );
    }
  }

  async #ensureProvider(
    target: RuntimeTarget,
    manager: ManagerHandle,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<void> {
    if (target.executionProvider === AUDIO_EXECUTION_PROVIDER) {
      return;
    }
    const provider = manager
      .discoverEps()
      .find((candidate) => canonicalExecutionProvider(candidate.name) === target.executionProvider);
    if (provider === undefined) {
      throw new Error(`Execution provider ${target.executionProvider} is not discoverable.`);
    }
    if (provider.isRegistered) {
      return;
    }
    this.#setReadiness(target.role, null, "registering_provider", `Registering ${provider.name}.`);
    const result = await manager.downloadAndRegisterEps([provider.name], (name, percent) => {
      onProgress?.({
        phase: `${target.role}:provider`,
        detail: `${name} ${percent.toFixed(1)}%`,
      });
    });
    if (!result.success || result.failedEps.length > 0) {
      throw new Error(`Execution provider registration failed: ${result.status}`);
    }
  }

  #assertModel(role: ModelRole, model: IModel, target: RuntimeTarget): void {
    if (model.id !== target.modelId) {
      throw new Error(`Resolved ${model.id}; expected exact model ${target.modelId}.`);
    }
    if (executionProvider(model) !== target.executionProvider) {
      throw new Error(`${model.id} uses ${executionProvider(model)}; expected ${target.executionProvider}.`);
    }
    const task = model.info.task?.toLowerCase() ?? "";
    if ((role === "whisper" || role === "nemotron") && task !== "automatic-speech-recognition") {
      throw new Error(`${model.id} is not an automatic-speech-recognition model.`);
    }
    if (role === "summary" && !["chat-completion", "coding"].includes(task)) {
      throw new Error(`${model.id} does not expose a supported text generation task.`);
    }
  }

  async #consumeAudioStream(active: ActiveAudioStream): Promise<void> {
    try {
      for await (const item of active.stream) {
        this.#assertCurrent(active.generation);
        if (item.type !== "speechSegment") {
          continue;
        }
        const text = active.accumulator.push({ kind: item.kind, text: item.text });
        if (!text.trim()) {
          continue;
        }
        if (active.firstPartialMs === null) {
          active.firstPartialMs = Math.round(performance.now() - active.startedAt);
        }
        active.onPartial({
          streamId: active.id,
          sequence: active.partialSequence,
          text,
          firstPartialMs: active.firstPartialMs,
          model: audioModelIdentity(active.model, true),
          mode: "nemotron_streaming",
          externalEndpointUsed: false,
        });
        active.partialSequence += 1;
      }
    } catch (error) {
      active.streamError = error;
    }
  }

  #terminateStream(active: ActiveAudioStream): Promise<void> {
    const completion = this.#terminateStreamCompletion(active);
    if (active.terminationResultPromise === null) {
      active.terminationResultPromise = this.#awaitBoundedSettlement(completion, "Nemotron live stream");
      void active.terminationResultPromise.catch(() => undefined);
    }
    return active.terminationResultPromise;
  }

  #terminateStreamCompletion(active: ActiveAudioStream): Promise<void> {
    if (active.terminationPromise !== null) {
      return active.terminationPromise;
    }
    this.#setReadiness(
      "nemotron",
      active.model,
      "ready",
      "Optional live-caption cleanup is draining; Whisper and Qwen remain available.",
    );
    const errors: unknown[] = [];
    try {
      active.abortController.abort();
    } catch (error) {
      errors.push(error);
    }
    try {
      active.request.cancel();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!active.queue.finished) {
        active.queue.markFinished();
      }
    } catch (error) {
      errors.push(error);
    }
    let trackedPromise: Promise<void>;
    trackedPromise = (async () => {
      await Promise.allSettled([active.consumePromise, active.responsePromise]);
      try {
        await this.#cleanupStream(active);
      } catch (error) {
        errors.push(error);
      }
      throwCollectedErrors(errors, "Nemotron live stream cleanup failed.");
    })();
    active.terminationPromise = trackedPromise;
    void trackedPromise.then(
      () => undefined,
      () => {
        if (active.terminationPromise === trackedPromise) {
          active.terminationPromise = null;
          active.terminationResultPromise = null;
        }
      },
    );
    return trackedPromise;
  }

  async #cleanupStream(active: ActiveAudioStream): Promise<void> {
    if (active.cleanedUp) {
      return;
    }
    const errors: unknown[] = [];
    if (!active.queueDisposed) {
      try {
        active.queue.dispose();
        active.queueDisposed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (!active.sessionDisposed) {
      try {
        active.session.dispose();
        active.sessionDisposed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (active.queueDisposed && active.sessionDisposed) {
      active.cleanedUp = true;
      if (this.#activeStream === active) {
        this.#activeStream = null;
      }
      if (!this.#shutdownRequested && this.#manager !== null) {
        this.#setReadiness(
          "nemotron",
          active.model,
          "ready",
          `${active.model.id} is ready for local inference.`,
        );
      }
    }
    throwCollectedErrors(errors, "Failed to dispose Nemotron native resources.");
  }

  async #runTrackedOperation<T>(
    kind: ActiveNativeOperation["kind"],
    generation: number,
    run: (operation: NativeOperationContext) => Promise<T>,
  ): Promise<T> {
    let resolveSettled = () => {};
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const active: ActiveNativeOperation = {
      kind,
      generation,
      settled,
      resolveSettled,
      cancel: null,
      cancelRequested: false,
      cancelInvoked: false,
      cancelError: null,
    };
    this.#activeOperations.add(active);
    const context: NativeOperationContext = {
      setCancel: (cancel) => {
        active.cancel = cancel;
        if (active.cancelRequested) {
          this.#invokeOperationCancel(active);
        }
      },
      assertCurrent: () => this.#assertCurrent(generation),
    };
    try {
      context.assertCurrent();
      return await run(context);
    } finally {
      this.#activeOperations.delete(active);
      active.resolveSettled();
    }
  }

  async #settleActiveOperations(): Promise<void> {
    const active = [...this.#activeOperations];
    for (const operation of active) {
      operation.cancelRequested = true;
      this.#invokeOperationCancel(operation);
    }
    if (active.length === 0) {
      return;
    }
    const errors: unknown[] = [];
    await Promise.all(active.map(async (operation) => operation.settled));
    for (const operation of active) {
      if (operation.cancelError !== null) {
        errors.push(operation.cancelError);
      }
    }
    throwCollectedErrors(errors, "Failed to cancel one or more native inference requests.");
  }

  async #drainNativeResources(): Promise<void> {
    const errors: unknown[] = [];
    while (this.#activeStream !== null || this.#activeOperations.size > 0) {
      const activeStream = this.#activeStream;
      const outcomes = await Promise.allSettled([
        ...(activeStream === null ? [] : [this.#terminateStreamCompletion(activeStream)]),
        this.#settleActiveOperations(),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          errors.push(outcome.reason);
        }
      }
      if (this.#activeStream === activeStream && activeStream !== null) {
        break;
      }
    }
    throwCollectedErrors(errors, "Native recorder cleanup encountered failures.");
  }

  #invokeOperationCancel(operation: ActiveNativeOperation): void {
    if (operation.cancelInvoked || operation.cancel === null) {
      return;
    }
    operation.cancelInvoked = true;
    try {
      operation.cancel();
    } catch (error) {
      operation.cancelError = error;
    }
  }

  #startLifecycleCleanup(shutdownRequested: boolean): Promise<void> {
    const cycle: LifecycleCleanupGeneration = {
      generation: this.#generation,
      shutdownRequested,
      completion: Promise.resolve(),
      result: Promise.resolve(),
    };
    const completion = this.#queueCleanup(
      shutdownRequested
        ? "Native recorder work is draining before model and manager shutdown."
        : "Native recorder work is draining before temporary audio cleanup.",
      async () => this.#performLifecycleCleanup(cycle),
    );
    cycle.completion = completion;
    cycle.result = this.#awaitBoundedSettlement(
      completion,
      shutdownRequested ? "Foundry Local shutdown cleanup" : "Recorder reset cleanup",
    );
    this.#lifecycleCleanup = cycle;
    void cycle.result.catch(() => undefined);
    void completion.then(
      () => {
        if (this.#lifecycleCleanup === cycle) {
          this.#lifecycleCleanup = null;
        }
      },
      () => {
        if (this.#lifecycleCleanup === cycle) {
          this.#lifecycleCleanup = null;
        }
      },
    );
    return cycle.result;
  }

  async #performLifecycleCleanup(cycle: LifecycleCleanupGeneration): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.#drainNativeResources();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#awaitPendingPreparation();
    } catch (error) {
      errors.push(error);
    }
    if (this.#hasUnsafeNativeResources()) {
      throwCollectedErrors(errors, "Recorder cleanup could not confirm native resource cleanup.");
      throw new Error("Recorder cleanup could not confirm native resource cleanup.");
    }
    try {
      await this.#tempAudioStore?.cleanupAll();
      this.#audioCleanupRequired = false;
    } catch (error) {
      this.#audioCleanupRequired = true;
      errors.push(error);
    }
    this.#updateAudioRecoveryReadiness();
    await Promise.resolve();
    if (cycle.shutdownRequested) {
      await this.#performShutdownTeardown(errors);
    }
    throwCollectedErrors(
      errors,
      cycle.shutdownRequested
        ? "Foundry Local shutdown encountered cleanup failures."
        : "Recorder reset encountered cleanup failures.",
    );
  }

  async #performShutdownTeardown(errors: unknown[]): Promise<void> {
    const manager = this.#manager;
    this.#manager = null;
    if (manager !== null) {
      this.#quarantineManager(manager);
    }
    errors.push(...(await this.#cleanupQuarantinedResources()));
    for (const role of ["whisper", "nemotron", "summary"] as const) {
      const active = this.#slots[role].active;
      this.#setReadiness(
        role,
        active,
        active === null ? "not_initialized" : "error",
        active === null
          ? `${this.#targets[role].modelId} is unloaded.`
          : `${this.#targets[role].modelId} cleanup must be retried before manager disposal.`,
      );
    }
    this.#readiness = {
      ...this.#readiness,
      inProcessModeValidated: false,
    };
    if (
      this.#quarantinedManager === null &&
      this.#modelSlotsCleared() &&
      !this.#hasUnsafeNativeResources() &&
      !this.#audioCleanupRequired
    ) {
      this.#shutdownComplete = true;
    }
  }

  async #awaitPendingPreparation(): Promise<void> {
    const pending: Promise<unknown>[] = [];
    if (this.#initializePromise !== null) {
      pending.push(this.#initializePromise);
    }
    if (this.#preparePromise !== null) {
      pending.push(this.#preparePromise);
    }
    if (pending.length === 0) {
      return;
    }
    await Promise.allSettled(pending);
  }

  async #awaitBoundedSettlement(operation: Promise<void>, label: string): Promise<void> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new NativeSettlementTimeoutError(`${label} did not settle within ${this.#settlementTimeoutMs} ms.`),
        );
      }, this.#settlementTimeoutMs);
      timeoutId.unref?.();
    });
    try {
      await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async #recoverBlockingCleanup(): Promise<void> {
    const pending = this.#cleanupCompletion;
    if (pending !== null) {
      try {
        await this.#awaitBoundedSettlement(pending, "Pending runtime cleanup");
      } catch (error) {
        if (error instanceof NativeSettlementTimeoutError) {
          throw error;
        }
      }
    }
    if (this.#hasUnsafeNativeResources()) {
      const completion = this.#queueCleanup(
        "Retrying deferred native recorder cleanup before manager initialization.",
        async () => this.#drainNativeResources(),
      );
      await this.#awaitBoundedSettlement(completion, "Deferred native recorder cleanup");
    }
    if (this.#quarantinedManager !== null) {
      const errors = await this.#cleanupQuarantinedResources();
      this.#restoreCleanupReadiness();
      throwCollectedErrors(errors, "Rejected Foundry Local manager cleanup failed again.");
    }
    this.#restoreCleanupReadiness();
  }

  #queueCleanup(detail: string, work: () => Promise<void>): Promise<void> {
    const previous = this.#cleanupCompletion;
    this.#readiness = {
      ...this.#readiness,
      inProcessModeValidated: false,
      cleanup: {
        state: "draining",
        required: true,
        completionPending: true,
        detail,
      },
    };
    let completion: Promise<void>;
    completion = (async () => {
      const errors: unknown[] = [];
      if (previous !== null) {
        try {
          await previous;
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await work();
      } catch (error) {
        errors.push(error);
      }
      throwCollectedErrors(errors, "Runtime cleanup encountered multiple failures.");
    })().finally(() => {
      if (this.#cleanupCompletion === completion) {
        this.#cleanupCompletion = null;
        this.#restoreCleanupReadiness();
      }
    });
    this.#cleanupCompletion = completion;
    void completion.catch(() => undefined);
    return completion;
  }

  #restoreCleanupReadiness(): void {
    if (this.#cleanupCompletion !== null) {
      return;
    }
    if (this.#audioCleanupRequired) {
      this.#readiness = {
        ...this.#readiness,
        inProcessModeValidated: false,
        cleanup: {
          state: "audio_cleanup_required",
          required: true,
          completionPending: false,
          detail: "App-owned temporary audio cleanup must be retried.",
        },
      };
      return;
    }
    if (this.#hasUnsafeNativeResources()) {
      this.#readiness = {
        ...this.#readiness,
        inProcessModeValidated: false,
        cleanup: {
          state: "native_cleanup_required",
          required: true,
          completionPending: false,
          detail: "Native recorder resources are quarantined until cleanup succeeds.",
        },
      };
      return;
    }
    if (this.#quarantinedManager !== null) {
      const handle = this.#quarantinedManager.manager.handle;
      this.#readiness = {
        ...this.#readiness,
        externalEndpointUsed: false,
        inProcessModeValidated: false,
        embeddedWebServiceRunning: handle.isWebServiceRunning === true,
        embeddedWebServiceUrls: [...(handle.urls ?? [])],
        cleanup: {
          state: "manager_cleanup_required",
          required: true,
          completionPending: false,
          detail:
            "The rejected Foundry Local manager remains quarantined until shutdown and disposal are confirmed.",
        },
      };
      return;
    }
    const manager = this.#manager?.handle ?? null;
    const embeddedWebServiceUrls =
      manager === null ? [...this.#readiness.embeddedWebServiceUrls] : [...(manager.urls ?? [])];
    const embeddedWebServiceRunning =
      manager === null ? this.#readiness.embeddedWebServiceRunning : manager.isWebServiceRunning === true;
    this.#readiness = {
      ...this.#readiness,
      externalEndpointUsed: false,
      inProcessModeValidated:
        !this.#shutdownRequested &&
        manager !== null &&
        !embeddedWebServiceRunning &&
        embeddedWebServiceUrls.length === 0,
      embeddedWebServiceRunning,
      embeddedWebServiceUrls,
      cleanup: {
        state: "none",
        required: false,
        completionPending: false,
        detail: "No deferred runtime cleanup is pending.",
      },
    };
  }

  #setCleanupDetail(detail: string): void {
    if (this.#cleanupCompletion === null) {
      return;
    }
    this.#readiness = {
      ...this.#readiness,
      cleanup: {
        state: "draining",
        required: true,
        completionPending: true,
        detail,
      },
    };
  }

  #quarantineManager(manager: ManagerContext): void {
    if (this.#quarantinedManager === null) {
      this.#quarantinedManager = {
        manager,
        shutdownConfirmed: false,
        disposeConfirmed: false,
      };
      return;
    }
    if (this.#quarantinedManager.manager !== manager) {
      throw new Error("A different Foundry Local manager is already quarantined.");
    }
  }

  #attemptQuarantinedManagerCleanup(): unknown[] {
    const quarantine = this.#quarantinedManager;
    if (quarantine === null) {
      return [];
    }
    const errors: unknown[] = [];
    if (!quarantine.shutdownConfirmed) {
      try {
        quarantine.manager.handle.shutdown();
        quarantine.shutdownConfirmed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (!quarantine.disposeConfirmed) {
      try {
        quarantine.manager.handle.dispose();
        quarantine.disposeConfirmed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (quarantine.shutdownConfirmed && quarantine.disposeConfirmed) {
      this.#quarantinedManager = null;
    }
    return errors;
  }

  async #cleanupQuarantinedResources(): Promise<unknown[]> {
    const errors: unknown[] = [];
    const slotOutcomes = await Promise.allSettled([
      this.#slots.nemotron.clear(),
      this.#slots.whisper.clear(),
      this.#slots.summary.clear(),
    ]);
    for (const outcome of slotOutcomes) {
      if (outcome.status === "rejected") {
        errors.push(outcome.reason);
      }
    }
    if (this.#modelSlotsCleared()) {
      errors.push(...this.#attemptQuarantinedManagerCleanup());
    }
    return errors;
  }

  #modelSlotsCleared(): boolean {
    return (
      this.#slots.nemotron.active === null &&
      this.#slots.whisper.active === null &&
      this.#slots.summary.active === null
    );
  }

  #hasUnsafeNativeResources(): boolean {
    return this.#activeStream !== null || this.#activeOperations.size > 0;
  }

  #updateAudioRecoveryReadiness(): void {
    if (this.#tempAudioStore === null) {
      return;
    }
    const retained = this.#tempAudioStore.activeCount;
    this.#readiness = {
      ...this.#readiness,
      audioRecovery: {
        ...this.#readiness.audioRecovery,
        removed: Math.max(
          this.#readiness.audioRecovery.removed,
          this.#readiness.audioRecovery.discovered - retained,
        ),
        retained,
      },
    };
  }

  #validateInProcessBoundary(manager: ManagerHandle): void {
    const embeddedWebServiceUrls = [...(manager.urls ?? [])];
    const embeddedWebServiceRunning = manager.isWebServiceRunning === true;
    const boundarySafe = !embeddedWebServiceRunning && embeddedWebServiceUrls.length === 0;
    const inProcessModeValidated =
      boundarySafe && !this.#readiness.cleanup.required && this.#quarantinedManager === null;
    this.#readiness = {
      ...this.#readiness,
      externalEndpointUsed: false,
      inProcessModeValidated,
      embeddedWebServiceRunning,
      embeddedWebServiceUrls,
    };
    if (!boundarySafe) {
      throw new Error(
        `Foundry Local endpoint guard rejected embedded service state (${embeddedWebServiceUrls.length} URL${
          embeddedWebServiceUrls.length === 1 ? "" : "s"
        }, running=${embeddedWebServiceRunning}).`,
      );
    }
  }

  #setReadiness(
    role: ModelRole,
    model: IModel | null,
    status: ModelReadiness["status"],
    detail: string,
  ): void {
    const clearModel = model === null && (status === "error" || status === "not_initialized");
    this.#readiness = {
      ...this.#readiness,
      [role]: {
        target: this.#targets[role],
        model:
          model === null ? (clearModel ? null : this.#readiness[role].model) : modelIdentity(role, model),
        status,
        detail,
        cached: model?.isCached ?? (clearModel ? false : this.#readiness[role].cached),
        loaded: status === "ready",
      },
    };
  }

  #requireManager(): ManagerContext {
    if (this.#manager === null) {
      throw new Error("Foundry Local manager is not initialized.");
    }
    return this.#manager;
  }

  #requireTempStore(): TempAudioStore {
    if (this.#tempAudioStore === null) {
      throw new Error("Temporary audio storage is not initialized.");
    }
    return this.#tempAudioStore;
  }

  #requireModel(role: ModelRole): IModel {
    const model = this.#slots[role].activeFor(this.#requireManager());
    if (model === null) {
      throw new Error(`The ${role} model is not ready.`);
    }
    return model;
  }

  #requireStream(streamId: string): ActiveAudioStream {
    const active = this.#activeStream;
    if (active === null || active.id !== streamId) {
      throw new Error("The live audio stream is no longer active.");
    }
    return active;
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#generation || this.#shutdownRequested) {
      throw new Error("The recorder operation was cancelled.");
    }
  }

  #assertAvailable(): void {
    if (this.#shutdownRequested) {
      throw new Error("The Foundry Local runtime is shutting down.");
    }
    if (this.#invalidatingManager) {
      throw new Error("The Foundry Local runtime is recovering from an endpoint guard failure.");
    }
    if (this.#cleanupCompletion !== null || this.#readiness.cleanup.required) {
      throw new Error(`The Foundry Local runtime is blocked for cleanup: ${this.#readiness.cleanup.detail}`);
    }
  }

  #assertNotShutdown(): void {
    if (this.#shutdownRequested) {
      throw new Error("The Foundry Local runtime is shutting down.");
    }
  }
}

function initialReadiness(targets: RuntimeTargets): RuntimeReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    externalEndpointUsed: false,
    inProcessModeValidated: false,
    embeddedWebServiceRunning: false,
    embeddedWebServiceUrls: [],
    cleanup: {
      state: "none",
      required: false,
      completionPending: false,
      detail: "No deferred runtime cleanup is pending.",
    },
    nonessentialTelemetryDisabled: true,
    modelCachePath: "",
    audioRecovery: {
      discovered: 0,
      removed: 0,
      retained: 0,
      pathPolicy: "App-owned temporary audio directory; exact paths are not exposed.",
      retryGuidance:
        "Close applications using retained files, then use Delete / reset or restart to retry cleanup.",
    },
    whisper: initialModelReadiness(targets.whisper),
    nemotron: initialModelReadiness(targets.nemotron),
    summary: initialModelReadiness(targets.summary),
  };
}

function initialModelReadiness(target: RuntimeTarget): ModelReadiness {
  return {
    target,
    model: null,
    status: "not_initialized",
    detail: `${target.modelId} has not been prepared.`,
    cached: false,
    loaded: false,
  };
}

function executionProvider(model: IModel): string {
  return canonicalExecutionProvider(
    model.info.runtime?.executionProvider ?? model.info.executionProvider ?? AUDIO_EXECUTION_PROVIDER,
  );
}

function modelIdentity(role: ModelRole, model: IModel): ModelIdentity {
  return {
    role,
    id: model.id,
    alias: model.alias,
    deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
    executionProvider: executionProvider(model),
    fileSizeMb: model.info.fileSizeMb ?? null,
  };
}

function audioModelIdentity(model: IModel, streaming: boolean): AudioModelIdentity {
  return {
    alias: model.alias,
    id: model.id,
    deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
    executionProvider: executionProvider(model),
    fileSizeMb: model.info.fileSizeMb ?? null,
    language: AUDIO_LANGUAGE,
    inputMode: streaming ? "streaming PCM ItemQueue" : "temporary PCM WAV file URI",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class NativeSettlementTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeSettlementTimeoutError";
  }
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}

function combineErrors(primary: unknown, additional: readonly unknown[], message: string): unknown {
  return additional.length === 0 ? primary : new AggregateError([primary, ...additional], message);
}

async function runWithCleanup<T>(
  operation: () => Promise<T>,
  cleanupActions: readonly (() => void | Promise<void>)[],
  label: string,
): Promise<T> {
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const cleanupErrors = await collectCleanupErrors(cleanupActions);
  if (!outcome.ok) {
    throw combineErrors(
      outcome.error,
      cleanupErrors,
      `${label} failed: ${errorMessage(outcome.error)} Cleanup also failed.`,
    );
  }
  throwCollectedErrors(cleanupErrors, `${label} cleanup failed.`);
  return outcome.value;
}

async function collectCleanupErrors(
  cleanupActions: readonly (() => void | Promise<void>)[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const cleanup of cleanupActions) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function isModelLoaded(model: IModel): Promise<boolean> {
  try {
    return await model.isLoaded();
  } catch {
    return false;
  }
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
  return parts.join("").trim();
}
