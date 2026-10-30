import type {
  AudioCapturePayload,
  AudioPartialTranscriptEvent,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamChunkResponse,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  AudioStreamStartResponse,
  AudioTranscriptionResult,
} from "../audio/audio-types";
import type { ModelRole, RuntimeTarget } from "../foundry/runtime-config";
import type { TranscriptSnapshot } from "../transcript/transcript-store";

export const ipcChannels = {
  bootstrap: "recorder:bootstrap",
  prepare: "recorder:prepare",
  authorizeMicrophone: "recorder:authorize-microphone",
  startLiveStream: "recorder:start-live-stream",
  appendLiveChunk: "recorder:append-live-chunk",
  finishLiveStream: "recorder:finish-live-stream",
  cancelLiveStream: "recorder:cancel-live-stream",
  transcribeCapture: "recorder:transcribe-capture",
  importWav: "recorder:import-wav",
  editTranscript: "recorder:edit-transcript",
  generateSummary: "recorder:generate-summary",
  reset: "recorder:reset",
  progress: "recorder:progress",
  audioPartial: "recorder:audio-partial",
} as const;

export type ReadinessStatus =
  | "not_initialized"
  | "checking"
  | "downloading"
  | "registering_provider"
  | "loading"
  | "ready"
  | "error";

export interface ModelIdentity {
  readonly role: ModelRole;
  readonly id: string;
  readonly alias: string;
  readonly deviceType: string;
  readonly executionProvider: string;
  readonly fileSizeMb: number | null;
}

export interface ModelReadiness {
  readonly target: RuntimeTarget;
  readonly model: ModelIdentity | null;
  readonly status: ReadinessStatus;
  readonly detail: string;
  readonly cached: boolean;
  readonly loaded: boolean;
}

export interface RuntimeReadiness {
  readonly sdkVersion: "2.2.1";
  readonly provider: "Foundry Local in-process SDK";
  readonly externalEndpointUsed: false;
  readonly embeddedWebServiceRunning: false;
  readonly embeddedWebServiceUrls: readonly [];
  readonly nonessentialTelemetryDisabled: true;
  readonly modelCachePath: string;
  readonly whisper: ModelReadiness;
  readonly nemotron: ModelReadiness;
  readonly summary: ModelReadiness;
}

export interface TraceEntry {
  readonly at: string;
  readonly responsibility: "Application" | "Foundry Local";
  readonly phase: string;
  readonly detail: string;
  readonly severity: "info" | "warning" | "error";
  readonly durationMs?: number;
}

export interface PipelineTiming {
  readonly firstCaptionMs: number | null;
  readonly stopToWhisperFinalMs: number | null;
  readonly transcriptFinalToSummaryMs: number | null;
}

export interface RecorderSnapshot {
  readonly readiness: RuntimeReadiness;
  readonly transcript: TranscriptSnapshot;
  readonly trace: readonly TraceEntry[];
  readonly timing: PipelineTiming;
  readonly maxRecordingMs: number;
  readonly retention: "Temporary audio is deleted after transcription; transcript and summary remain in memory until Reset.";
}

export interface ProgressEvent {
  readonly phase: string;
  readonly detail: string;
}

export interface PrepareRecorderRequest {
  readonly enableLiveCaptions: boolean;
}

export interface PrepareRecorderResponse {
  readonly snapshot: RecorderSnapshot;
  readonly liveCaptionsAvailable: boolean;
  readonly liveCaptionsFailure: string | null;
}

export interface MicrophoneAuthorizationRequest {
  readonly hasTransientUserActivation: boolean;
}

export interface LiveStreamResult {
  readonly result: AudioTranscriptionResult;
  readonly snapshot: RecorderSnapshot;
}

export interface TranscriptionResponse {
  readonly result: AudioTranscriptionResult;
  readonly snapshot: RecorderSnapshot;
}

export interface ImportWavResponse extends TranscriptionResponse {
  readonly fileName: string;
}

export interface EditTranscriptRequest {
  readonly text: string;
}

export interface SummaryResponse {
  readonly snapshot: RecorderSnapshot;
  readonly summaryInput: string;
}

export interface RecorderApi {
  getBootstrap(): Promise<RecorderSnapshot>;
  prepare(request: PrepareRecorderRequest): Promise<PrepareRecorderResponse>;
  authorizeMicrophone(): Promise<void>;
  startLiveStream(request: AudioStreamStartRequest): Promise<AudioStreamStartResponse>;
  appendLiveChunk(request: AudioStreamChunkRequest): Promise<AudioStreamChunkResponse>;
  finishLiveStream(request: AudioStreamFinishRequest): Promise<LiveStreamResult>;
  cancelLiveStream(request: AudioStreamCancelRequest): Promise<void>;
  transcribeCapture(request: AudioCapturePayload): Promise<TranscriptionResponse>;
  importWav(): Promise<ImportWavResponse | null>;
  editTranscript(request: EditTranscriptRequest): Promise<RecorderSnapshot>;
  generateSummary(): Promise<SummaryResponse>;
  reset(): Promise<RecorderSnapshot>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onAudioPartial(callback: (event: AudioPartialTranscriptEvent) => void): () => void;
}
