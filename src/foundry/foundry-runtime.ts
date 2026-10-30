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
  readonly liveCaptionsFailure: string | null;
}

export interface FoundryRecorderRuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resolvePaths?: () => Promise<RecorderPaths>;
  readonly createManager?: (config: FoundryLocalConfig) => ManagerHandle;
  readonly createChatSession?: (model: IModel) => ChatSessionHandle;
  readonly createAudioSession?: (model: IModel) => AudioSessionHandle;
  readonly tempAudioStore?: TempAudioStore;
}

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
  #paths: RecorderPaths | null = null;
  #manager: ManagerHandle | null = null;
  #tempAudioStore: TempAudioStore | null;
  #initializePromise: Promise<void> | null = null;
  #preparePromise: Promise<PrepareRuntimeResult> | null = null;
  #activeStream: ActiveAudioStream | null = null;
  #generation = 0;
  #shuttingDown = false;
  #readiness: RuntimeReadiness;

  constructor(options: FoundryRecorderRuntimeOptions = {}) {
    this.#targets = resolveRuntimeTargets(options.environment);
    this.#resolvePaths = options.resolvePaths ?? resolveRecorderPaths;
    this.#createManager = options.createManager ?? ((config) => FoundryLocalManager.create(config));
    this.#createChatSession = options.createChatSession ?? ((model) => new ChatSession(model));
    this.#createAudioSession = options.createAudioSession ?? ((model) => new AudioSession(model));
    this.#tempAudioStore = options.tempAudioStore ?? null;
    this.#readiness = initialReadiness(this.#targets);
  }

  get readiness(): RuntimeReadiness {
    return this.#readiness;
  }

  initialize(): Promise<void> {
    this.#assertAvailable();
    if (this.#manager !== null) {
      return Promise.resolve();
    }
    if (this.#initializePromise !== null) {
      return this.#initializePromise;
    }
    let trackedPromise: Promise<void>;
    trackedPromise = this.#initialize().finally(() => {
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
    this.#assertAvailable();
    if (this.#preparePromise !== null) {
      return this.#preparePromise;
    }
    let trackedPromise: Promise<PrepareRuntimeResult>;
    trackedPromise = this.#prepare(enableLiveCaptions, onProgress).finally(() => {
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
      throw new Error("A live audio stream is already active.");
    }
    const model = this.#requireModel("nemotron");
    const generation = this.#generation;
    let session: AudioSessionHandle | null = null;
    let queue: ItemQueue | null = null;
    try {
      session = this.#createAudioSession(model);
      queue = new ItemQueue();
      const request = new Request()
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
      };
      active.consumePromise = this.#consumeAudioStream(active);
      this.#activeStream = active;
      return {
        streamId: active.id,
        model: audioModelIdentity(model, true),
        mode: "nemotron_streaming",
      };
    } catch (error) {
      try {
        queue?.dispose();
      } finally {
        session?.dispose();
      }
      throw new Error(`Failed to start Nemotron live captions: ${errorMessage(error)}`, { cause: error });
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
      const response = await active.stream.response;
      this.#assertCurrent(active.generation);
      const result = response.output.find((item) => item.type === "speechResult");
      if (result?.type !== "speechResult" || !result.text.trim()) {
        throw new Error("Nemotron returned no terminal transcript.");
      }
      const completedAt = performance.now();
      return {
        transcript: active.accumulator.finalize(result.text.trim()).trim(),
        transcriptionMs: Math.round(completedAt - active.startedAt),
        audioDurationMs: measuredDuration,
        model: audioModelIdentity(active.model, true),
        mode: "nemotron_streaming",
        transcriptSource: "live_stream_final",
        firstPartialMs: active.firstPartialMs,
        finalizationMs: Math.round(completedAt - active.stopRequestedAt),
        externalEndpointUsed: false,
      };
    } finally {
      await this.#cleanupStream(active);
    }
  }

  async cancelLiveStream(streamId: string): Promise<void> {
    const active = this.#activeStream;
    if (active === null || active.id !== streamId) {
      return;
    }
    await this.#settleStream(active);
    await this.#cleanupStream(active);
  }

  async transcribeCapture(capture: ValidatedAudioCapture): Promise<AudioTranscriptionResult> {
    this.#assertAvailable();
    const model = this.#requireModel("whisper");
    const store = this.#requireTempStore();
    const generation = this.#generation;
    const startedAt = performance.now();
    try {
      const transcript = await withTemporaryWav(store, capture.pcmBytes, async (filePath) => {
        const session = this.#createAudioSession(model);
        const request = new Request();
        try {
          request
            .addItem(Item.audioFromUri(filePath))
            .setOptions({ search: { temperature: 0 }, additionalOptions: { language: AUDIO_LANGUAGE } });
          const response = await session.processRequest(request);
          this.#assertCurrent(generation);
          const result = response.output.find((item) => item.type === "speechResult");
          if (result?.type !== "speechResult" || !result.text.trim()) {
            throw new Error("Whisper returned no final speech transcript.");
          }
          return result.text.trim();
        } finally {
          request.cancel();
          session.dispose();
        }
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
  }

  async summarize(transcript: string): Promise<SummaryGenerationResult> {
    this.#assertAvailable();
    const model = this.#requireModel("summary");
    const generation = this.#generation;
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
    const startedAt = performance.now();
    try {
      const preflight = await session.preflightRequest(request);
      if (!preflight.fits) {
        throw new Error(
          `Summary request needs ${preflight.requiredTokens} tokens but the context limit is ${preflight.contextLimitTokens}.`,
        );
      }
      const response = await session.processRequest(request);
      this.#assertCurrent(generation);
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
    } finally {
      request.cancel();
      session.dispose();
    }
  }

  async reset(): Promise<void> {
    this.#generation += 1;
    if (this.#activeStream !== null) {
      await this.cancelLiveStream(this.#activeStream.id);
    }
    await this.#tempAudioStore?.cleanupAll();
  }

  async shutdown(): Promise<void> {
    if (this.#shuttingDown) {
      return;
    }
    this.#shuttingDown = true;
    this.#generation += 1;
    try {
      if (this.#activeStream !== null) {
        await this.cancelLiveStream(this.#activeStream.id);
      }
      await this.#tempAudioStore?.cleanupAll();
      await Promise.all([
        this.#slots.nemotron.clear(),
        this.#slots.whisper.clear(),
        this.#slots.summary.clear(),
      ]);
      this.#manager?.shutdown();
      this.#manager?.dispose();
      this.#manager = null;
    } finally {
      this.#shuttingDown = false;
    }
  }

  async #initialize(): Promise<void> {
    this.#paths = await this.#resolvePaths();
    this.#tempAudioStore ??= new TempAudioStore(this.#paths.audioTempDir);
    await this.#tempAudioStore.recoverOwnedCaptures();
    this.#manager = this.#createManager({
      appName: "FoundryLocalSmartAIRecorder",
      appDataDir: this.#paths.appDataDir,
      modelCacheDir: this.#paths.modelCacheDir,
      logsDir: this.#paths.logsDir,
      logLevel: "info",
      disableNonessentialTelemetry: true,
    });
    if (this.#manager.isWebServiceRunning === true || (this.#manager.urls?.length ?? 0) > 0) {
      throw new Error("The Foundry Local embedded web service started unexpectedly.");
    }
    this.#readiness = { ...this.#readiness, modelCachePath: this.#paths.modelCacheDir };
  }

  async #prepare(
    enableLiveCaptions: boolean,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareRuntimeResult> {
    await this.initialize();
    await this.#prepareModel("whisper", onProgress);
    await this.#prepareModel("summary", onProgress);
    let liveCaptionsFailure: string | null = null;
    if (enableLiveCaptions) {
      try {
        await this.#prepareModel("nemotron", onProgress);
      } catch (error) {
        liveCaptionsFailure = errorMessage(error);
      }
    }
    return {
      readiness: this.#readiness,
      liveCaptionsAvailable: this.#slots.nemotron.active !== null,
      liveCaptionsFailure,
    };
  }

  async #prepareModel(role: ModelRole, onProgress?: (event: ProgressEvent) => void): Promise<IModel> {
    const target = this.#targets[role];
    const manager = this.#requireManager();
    const current = this.#slots[role].active;
    if (
      current !== null &&
      current.id === target.modelId &&
      executionProvider(current) === target.executionProvider &&
      (await current.isLoaded())
    ) {
      this.#setReadiness(role, current, "ready", `${current.id} is loaded and ready.`);
      return current;
    }

    this.#setReadiness(role, null, "checking", `Resolving exact ${role} model ${target.modelId}.`);
    let candidate: IModel | null = null;
    try {
      candidate = await this.#resolveModel(target);
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
        if (!candidate.isCached) {
          throw new Error(`Model download completed without caching ${candidate.id}.`);
        }
      }
      await this.#ensureProvider(target, manager, onProgress);
      onProgress?.({ phase: `${role}:load`, detail: `Loading ${candidate.id} in-process.` });
      await this.#slots[role].activate(candidate);
      this.#setReadiness(role, candidate, "ready", `${candidate.id} is ready for local inference.`);
      return candidate;
    } catch (error) {
      if (candidate !== null && candidate !== current) {
        try {
          if (await candidate.isLoaded()) {
            await candidate.unload();
          }
        } catch {
          // Preserve the preparation error; a later shutdown retries cleanup.
        }
      }
      this.#setReadiness(role, current, "error", errorMessage(error));
      throw new Error(`Failed to prepare ${role}: ${errorMessage(error)}`, { cause: error });
    }
  }

  async #resolveModel(target: RuntimeTarget): Promise<IModel> {
    const manager = this.#requireManager();
    try {
      return await manager.catalog.getModelVariant(target.modelId);
    } catch (catalogError) {
      const cached = (await manager.catalog.getCachedModels()).find((model) => model.id === target.modelId);
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

  async #settleStream(active: ActiveAudioStream): Promise<void> {
    active.abortController.abort();
    active.request.cancel();
    if (!active.queue.finished) {
      active.queue.markFinished();
    }
    await Promise.allSettled([active.consumePromise, active.stream.response]);
  }

  async #cleanupStream(active: ActiveAudioStream): Promise<void> {
    if (active.cleanedUp) {
      return;
    }
    active.cleanedUp = true;
    if (this.#activeStream === active) {
      this.#activeStream = null;
    }
    try {
      active.queue.dispose();
    } finally {
      active.session.dispose();
    }
  }

  #setReadiness(
    role: ModelRole,
    model: IModel | null,
    status: ModelReadiness["status"],
    detail: string,
  ): void {
    this.#readiness = {
      ...this.#readiness,
      [role]: {
        target: this.#targets[role],
        model: model === null ? this.#readiness[role].model : modelIdentity(role, model),
        status,
        detail,
        cached: model?.isCached ?? this.#readiness[role].cached,
        loaded: status === "ready",
      },
    };
  }

  #requireManager(): ManagerHandle {
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
    const model = this.#slots[role].active;
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
    if (generation !== this.#generation || this.#shuttingDown) {
      throw new Error("The recorder operation was cancelled.");
    }
  }

  #assertAvailable(): void {
    if (this.#shuttingDown) {
      throw new Error("The Foundry Local runtime is shutting down.");
    }
  }
}

function initialReadiness(targets: RuntimeTargets): RuntimeReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    externalEndpointUsed: false,
    embeddedWebServiceRunning: false,
    embeddedWebServiceUrls: [],
    nonessentialTelemetryDisabled: true,
    modelCachePath: "",
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
