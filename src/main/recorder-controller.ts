import { performance } from "node:perf_hooks";
import {
  audioDurationMsFromPcmBytes,
  extractPcm16FromWav,
  validateAudioCapturePayload,
  validateAudioStreamChunk,
  validateAudioStreamFinish,
  validateAudioStreamStart,
} from "../audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
  type AudioPartialTranscriptEvent,
  type AudioStreamChunkRequest,
  type AudioStreamFinishRequest,
  type AudioStreamStartRequest,
  type AudioStreamStartResponse,
  type AudioTranscriptionResult,
  type ValidatedAudioCapture,
} from "../audio/audio-types";
import {
  FoundryRecorderRuntime,
  type PrepareRuntimeResult,
  type SummaryGenerationResult,
} from "../foundry/foundry-runtime";
import type {
  ImportWavResponse,
  LiveStreamResult,
  PipelineTiming,
  PrepareRecorderRequest,
  PrepareRecorderResponse,
  ProgressEvent,
  RecorderSnapshot,
  RuntimeReadiness,
  SummaryResponse,
  TraceEntry,
  TranscriptionResponse,
} from "../shared/contracts";
import { TranscriptStore } from "../transcript/transcript-store";

const TRACE_LIMIT = 250;

export interface RecorderRuntime {
  readonly readiness: RuntimeReadiness;
  prepare(
    enableLiveCaptions: boolean,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareRuntimeResult>;
  startLiveStream(onPartial: (event: AudioPartialTranscriptEvent) => void): Promise<AudioStreamStartResponse>;
  appendLiveChunk(
    streamId: string,
    sequence: number,
    pcmBytes: Uint8Array,
  ): { readonly acceptedSequence: number; readonly totalBytes: number };
  finishLiveStream(request: AudioStreamFinishRequest): Promise<AudioTranscriptionResult>;
  cancelLiveStream(streamId: string): Promise<void>;
  transcribeCapture(capture: ValidatedAudioCapture): Promise<AudioTranscriptionResult>;
  summarize(transcript: string): Promise<SummaryGenerationResult>;
  reset(): Promise<void>;
  shutdown(): Promise<void>;
}

export class RecorderController {
  readonly #runtime: RecorderRuntime;
  readonly #transcript = new TranscriptStore();
  readonly #trace: TraceEntry[] = [];
  #timing: PipelineTiming = {
    firstCaptionMs: null,
    stopToWhisperFinalMs: null,
    transcriptFinalToSummaryMs: null,
  };
  #stopRequestedAt: number | null = null;
  #finalizedAt: number | null = null;
  #operationGeneration = 0;
  #lastRecoveryWarningKey: string | null = null;

  constructor(runtime: RecorderRuntime = new FoundryRecorderRuntime()) {
    this.#runtime = runtime;
    this.#traceEvent(
      "Application",
      "startup",
      "Recorder state is memory-only; temporary WAV recovery runs on initialize.",
    );
  }

  bootstrap(): RecorderSnapshot {
    return this.#snapshot();
  }

  async prepare(
    request: PrepareRecorderRequest,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareRecorderResponse> {
    const generation = this.#operationGeneration;
    this.#traceEvent(
      "Application",
      "prepare",
      `Preparing Whisper core, Qwen summary, and ${
        request.enableLiveCaptions ? "optional Nemotron live captions" : "no live-caption model"
      }.`,
    );
    try {
      const result = await this.#runtime.prepare(request.enableLiveCaptions, (event) => {
        if (generation !== this.#operationGeneration) {
          return;
        }
        this.#traceEvent("Foundry Local", event.phase, event.detail);
        onProgress?.(event);
      });
      this.#assertCurrent(generation);
      this.#traceRecoveryWarning();
      if (result.liveCaptionsFailure !== null) {
        this.#traceEvent(
          "Application",
          "live-fallback",
          `Nemotron is unavailable; Whisper-only recording remains ready. ${result.liveCaptionsFailure}`,
          "warning",
        );
      }
      return {
        snapshot: this.#snapshot(),
        liveCaptionsAvailable: result.liveCaptionsAvailable,
        liveCaptionsFailure: result.liveCaptionsFailure,
      };
    } catch (error) {
      this.#traceRecoveryWarning();
      this.#traceErrorIfCurrent(generation, "prepare", error);
      throw error;
    }
  }

  async startLiveStream(
    request: AudioStreamStartRequest,
    onPartial: (event: AudioPartialTranscriptEvent) => void,
  ): Promise<AudioStreamStartResponse> {
    const generation = this.#operationGeneration;
    validateAudioStreamStart(request);
    const response = await this.#runtime.startLiveStream((event) => {
      if (generation !== this.#operationGeneration) {
        return;
      }
      if (this.#transcript.snapshot.liveStreamId === null) {
        this.#transcript.startLiveDraft(event.streamId);
      }
      if (this.#transcript.applyLivePartial(event.streamId, event.sequence, event.text)) {
        this.#timing = { ...this.#timing, firstCaptionMs: event.firstPartialMs };
        onPartial(event);
      }
    });
    this.#assertCurrent(generation);
    if (this.#transcript.snapshot.liveStreamId !== response.streamId) {
      this.#transcript.startLiveDraft(response.streamId);
    }
    this.#traceEvent(
      "Foundry Local",
      "nemotron-stream",
      `${response.model.id} opened a PCM16LE 16 kHz mono ItemQueue.`,
    );
    return response;
  }

  appendLiveChunk(request: AudioStreamChunkRequest) {
    const validated = validateAudioStreamChunk(request);
    return this.#runtime.appendLiveChunk(validated.streamId, validated.sequence, validated.pcmBytes);
  }

  async finishLiveStream(request: AudioStreamFinishRequest): Promise<LiveStreamResult> {
    const generation = this.#operationGeneration;
    const validated = validateAudioStreamFinish(request);
    this.#stopRequestedAt = performance.now();
    try {
      const result = await this.#runtime.finishLiveStream(validated);
      this.#assertCurrent(generation);
      this.#traceEvent(
        "Application",
        "live-terminal-discarded",
        `Nemotron terminal text completed in ${result.finalizationMs} ms and remains display-only; Whisper will author the final transcript.`,
        "info",
        result.finalizationMs,
      );
      return { result, snapshot: this.#snapshot() };
    } catch (error) {
      this.#traceErrorIfCurrent(generation, "nemotron-finish", error);
      throw error;
    }
  }

  async cancelLiveStream(streamId: string): Promise<void> {
    const generation = this.#operationGeneration;
    await this.#runtime.cancelLiveStream(streamId);
    if (generation !== this.#operationGeneration) {
      return;
    }
    this.#transcript.clearLiveDraft(streamId);
    this.#traceEvent("Application", "live-cancel", "Renderer-owned live stream was cancelled.");
  }

  async transcribeCapture(payload: AudioCapturePayload): Promise<TranscriptionResponse> {
    const generation = this.#operationGeneration;
    const validation = validateAudioCapturePayload(payload);
    if (!validation.ok) {
      throw new Error(validation.error.message);
    }
    this.#stopRequestedAt ??= performance.now();
    this.#traceEvent(
      "Application",
      "whisper-input",
      `Validated ${validation.value.durationMs} ms capture; writing an owned temporary WAV.`,
    );
    try {
      const result = await this.#runtime.transcribeCapture(validation.value);
      this.#assertCurrent(generation);
      this.#transcript.setWhisperFinal(result.transcript);
      this.#finalizedAt = performance.now();
      this.#timing = {
        ...this.#timing,
        stopToWhisperFinalMs: Math.round(this.#finalizedAt - this.#stopRequestedAt),
        transcriptFinalToSummaryMs: null,
      };
      this.#stopRequestedAt = null;
      this.#traceEvent(
        "Foundry Local",
        "whisper-final",
        `${result.model.id} produced authoritative transcript version ${this.#transcript.snapshot.version}.`,
        "info",
        result.transcriptionMs,
      );
      if (validation.value.liveCaptionFailure !== null) {
        this.#traceEvent(
          "Application",
          "live-caption-warning",
          `Whisper final succeeded; live captions failed: ${validation.value.liveCaptionFailure}`,
          "warning",
        );
      }
      return { result, snapshot: this.#snapshot() };
    } catch (error) {
      if (validation.value.liveCaptionFailure !== null) {
        this.#traceEvent(
          "Application",
          "live-caption-warning",
          `Whisper final failed after live captions failed: ${validation.value.liveCaptionFailure}`,
          "warning",
        );
      }
      this.#traceErrorIfCurrent(generation, "whisper-final", error);
      throw error;
    }
  }

  async transcribeImportedWav(fileName: string, wavBytes: Uint8Array): Promise<ImportWavResponse> {
    const pcmBytes = extractPcm16FromWav(wavBytes);
    const durationMs = audioDurationMsFromPcmBytes(pcmBytes.byteLength);
    const payload: AudioCapturePayload = {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs,
      data: pcmBytes.buffer.slice(
        pcmBytes.byteOffset,
        pcmBytes.byteOffset + pcmBytes.byteLength,
      ) as ArrayBuffer,
    };
    const response = await this.transcribeCapture(payload);
    this.#traceEvent(
      "Application",
      "wav-import",
      `${fileName} was decoded as bounded PCM and passed through the same owned temporary-WAV Whisper path.`,
    );
    return { ...response, fileName };
  }

  editTranscript(text: string): RecorderSnapshot {
    const previousVersion = this.#transcript.snapshot.version;
    const snapshot = this.#transcript.editFinal(text);
    if (snapshot.version !== previousVersion) {
      this.#finalizedAt = performance.now();
      this.#timing = { ...this.#timing, transcriptFinalToSummaryMs: null };
      this.#traceEvent(
        "Application",
        "transcript-edit",
        `Final transcript advanced to version ${snapshot.version}; prior summary state was invalidated.`,
      );
    }
    return this.#snapshot();
  }

  async generateSummary(): Promise<SummaryResponse> {
    const generation = this.#operationGeneration;
    const submitted = this.#transcript.submitForSummary();
    this.#traceEvent(
      "Application",
      "summary-submit",
      `Submitting exact Whisper transcript version ${submitted.version}; live captions are excluded.`,
    );
    try {
      const result = await this.#runtime.summarize(submitted.text);
      this.#assertCurrent(generation);
      this.#transcript.applySummary({
        text: result.text,
        transcriptVersion: submitted.version,
        generatedAt: new Date().toISOString(),
        modelId: result.model.id,
        durationMs: result.durationMs,
        promptTokens: result.response.usage.promptTokens,
        completionTokens: result.response.usage.completionTokens,
      });
      const completedAt = performance.now();
      this.#timing = {
        ...this.#timing,
        transcriptFinalToSummaryMs:
          this.#finalizedAt === null ? result.durationMs : Math.round(completedAt - this.#finalizedAt),
      };
      this.#traceEvent(
        "Foundry Local",
        "summary-final",
        `${result.model.id} produced a bounded summary from transcript version ${submitted.version}.`,
        "info",
        result.durationMs,
      );
      return { snapshot: this.#snapshot(), summaryInput: submitted.text };
    } catch (error) {
      this.#traceErrorIfCurrent(generation, "summary-final", error);
      throw error;
    }
  }

  async reset(): Promise<RecorderSnapshot> {
    this.#operationGeneration += 1;
    await this.#runtime.reset();
    this.#transcript.reset();
    this.#timing = {
      firstCaptionMs: null,
      stopToWhisperFinalMs: null,
      transcriptFinalToSummaryMs: null,
    };
    this.#stopRequestedAt = null;
    this.#finalizedAt = null;
    this.#lastRecoveryWarningKey = null;
    this.#trace.length = 0;
    this.#traceEvent(
      "Application",
      "reset",
      "Temporary audio and all in-memory transcript/summary state were removed.",
    );
    return this.#snapshot();
  }

  shutdown(): Promise<void> {
    this.#operationGeneration += 1;
    return this.#runtime.shutdown();
  }

  #snapshot(): RecorderSnapshot {
    return {
      readiness: this.#runtime.readiness,
      transcript: this.#transcript.snapshot,
      trace: [...this.#trace],
      timing: this.#timing,
      maxRecordingMs: AUDIO_MAX_DURATION_MS,
      retention:
        "Temporary audio is deleted after transcription; transcript and summary remain in memory until Reset.",
    };
  }

  #traceEvent(
    responsibility: TraceEntry["responsibility"],
    phase: string,
    detail: string,
    severity: TraceEntry["severity"] = "info",
    durationMs?: number,
  ): void {
    this.#trace.push({
      at: new Date().toISOString(),
      responsibility,
      phase,
      detail,
      severity,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
    if (this.#trace.length > TRACE_LIMIT) {
      this.#trace.splice(0, this.#trace.length - TRACE_LIMIT);
    }
  }

  #traceError(phase: string, error: unknown): void {
    this.#traceEvent("Application", phase, error instanceof Error ? error.message : String(error), "error");
  }

  #traceErrorIfCurrent(generation: number, phase: string, error: unknown): void {
    if (generation === this.#operationGeneration) {
      this.#traceError(phase, error);
    }
  }

  #traceRecoveryWarning(): void {
    const recovery = this.#runtime.readiness.audioRecovery;
    if (recovery.retained === 0) {
      this.#lastRecoveryWarningKey = null;
      return;
    }
    const warningKey = `${recovery.discovered}:${recovery.removed}:${recovery.retained}`;
    if (warningKey === this.#lastRecoveryWarningKey) {
      return;
    }
    this.#lastRecoveryWarningKey = warningKey;
    this.#traceEvent(
      "Application",
      "startup-audio-retained",
      `${recovery.retained} locked app-owned temporary audio ${
        recovery.retained === 1 ? "file remains" : "files remain"
      } in the private temp directory. Exact paths are hidden. ${recovery.retryGuidance}`,
      "warning",
    );
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#operationGeneration) {
      throw new Error("The recorder operation was cancelled.");
    }
  }
}
