import type { AssistantLaneSnapshot, AssistantMode } from "../assistant/assistant-types";
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
import type { SafeDiagnostic } from "./safe-diagnostic";

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
  assistantBootstrap: "assistant:bootstrap",
  assistantSelectImage: "assistant:select-image",
  assistantSetMode: "assistant:set-mode",
  assistantAnalyzeImage: "assistant:analyze-image",
  assistantAsk: "assistant:ask",
  assistantCancel: "assistant:cancel",
  assistantClearChat: "assistant:clear-chat",
  assistantRemoveImage: "assistant:remove-image",
  assistantUpdate: "assistant:update",
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

export type RuntimeCleanupState =
  | "none"
  | "draining"
  | "native_cleanup_required"
  | "manager_cleanup_required"
  | "audio_cleanup_required";

export interface RuntimeCleanupReadiness {
  readonly state: RuntimeCleanupState;
  readonly required: boolean;
  readonly completionPending: boolean;
  readonly detail: string;
}

export interface RuntimeReadiness {
  readonly sdkVersion: "2.2.1";
  readonly provider: "Foundry Local in-process SDK";
  readonly externalEndpointUsed: boolean;
  readonly inProcessModeValidated: boolean;
  readonly embeddedWebServiceRunning: boolean;
  readonly embeddedWebServiceUrls: readonly string[];
  readonly cleanup: RuntimeCleanupReadiness;
  readonly nonessentialTelemetryDisabled: true;
  readonly modelCachePath: string;
  readonly audioRecovery: AudioRecoveryReadiness;
  readonly whisper: ModelReadiness;
  readonly nemotron: ModelReadiness;
  readonly summary: ModelReadiness;
}

export interface AudioRecoveryReadiness {
  readonly discovered: number;
  readonly removed: number;
  readonly retained: number;
  readonly pathPolicy: "App-owned temporary audio directory; exact paths are not exposed.";
  readonly retryGuidance: "Close applications using retained files, then use Delete / reset or restart to retry cleanup.";
}

export interface TraceEntry {
  readonly at: string;
  readonly responsibility: "Application" | "Foundry Local";
  readonly phase: string;
  readonly detail: string;
  readonly severity: "info" | "warning" | "error";
  readonly durationMs?: number;
  readonly summaryDisplayFormattingApplied?: boolean;
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
  readonly liveCaptionsFailure: SafeDiagnostic | null;
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

export interface AssistantSessionRequest {
  readonly sessionId: string;
}

export interface AssistantBootstrapResponse {
  readonly sessionId: string;
  readonly snapshot: AssistantLaneSnapshot;
}

export interface AssistantSetModeRequest extends AssistantSessionRequest {
  readonly mode: AssistantMode;
}

export interface AssistantAskRequest extends AssistantSessionRequest {
  readonly question: string;
}

export interface AssistantCancelRequest extends AssistantSessionRequest {
  readonly requestId: string;
}

export interface AssistantStartResponse {
  readonly requestId: string;
  readonly snapshot: AssistantLaneSnapshot;
}

export interface AssistantUpdateEvent {
  readonly sessionId: string;
  readonly snapshot: AssistantLaneSnapshot;
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
  getAssistantBootstrap(): Promise<AssistantBootstrapResponse>;
  selectAssistantImage(request: AssistantSessionRequest): Promise<AssistantLaneSnapshot | null>;
  setAssistantMode(request: AssistantSetModeRequest): Promise<AssistantLaneSnapshot>;
  analyzeAssistantImage(request: AssistantSessionRequest): Promise<AssistantStartResponse>;
  askAssistant(request: AssistantAskRequest): Promise<AssistantStartResponse>;
  cancelAssistant(request: AssistantCancelRequest): Promise<AssistantLaneSnapshot>;
  clearAssistantChat(request: AssistantSessionRequest): Promise<AssistantLaneSnapshot>;
  removeAssistantImage(request: AssistantSessionRequest): Promise<AssistantLaneSnapshot>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onAudioPartial(callback: (event: AudioPartialTranscriptEvent) => void): () => void;
  onAssistantUpdate(callback: (event: AssistantUpdateEvent) => void): () => void;
}
