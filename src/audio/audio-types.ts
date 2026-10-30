export const NEMOTRON_AUDIO_MODEL_ID = "nemotron-speech-streaming-en-0.6b-generic-cpu:3";
export const NEMOTRON_AUDIO_MODEL_ALIAS = "nemotron-speech-streaming-en-0.6b";
export const WHISPER_AUDIO_MODEL_ID = "openai-whisper-tiny-generic-cpu:4";
export const WHISPER_AUDIO_MODEL_ALIAS = "whisper-tiny";
export const AUDIO_EXECUTION_PROVIDER = "CPUExecutionProvider";
export const AUDIO_LANGUAGE = "en";
export const AUDIO_FORMAT = "pcm_s16le";
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BYTES_PER_SAMPLE = 2;
export const AUDIO_MIN_DURATION_MS = 300;
export const AUDIO_MAX_DURATION_MS = 30_000;
export const AUDIO_MAX_PCM_BYTES =
  (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE * AUDIO_MAX_DURATION_MS) / 1000;
export const AUDIO_STREAM_CHUNK_MS = 100;
export const AUDIO_STREAM_CHUNK_BYTES =
  (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE * AUDIO_STREAM_CHUNK_MS) / 1000;
export const AUDIO_STREAM_MAX_QUEUED_CHUNKS = 8;
export const AUDIO_STREAM_MAX_CHUNKS = Math.ceil(AUDIO_MAX_PCM_BYTES / AUDIO_STREAM_CHUNK_BYTES);

export type AudioMode = "nemotron_streaming" | "whisper_file";

export interface AudioModelIdentity {
  readonly alias: string;
  readonly id: string;
  readonly deviceType: string;
  readonly executionProvider: string;
  readonly fileSizeMb: number | null;
  readonly language: typeof AUDIO_LANGUAGE;
  readonly inputMode: "streaming PCM ItemQueue" | "temporary PCM WAV file URI";
}

export interface AudioReadiness {
  readonly sdkVersion: "2.2.1";
  readonly provider: "Foundry Local in-process SDK";
  readonly model: AudioModelIdentity | null;
  readonly preferredModelId: typeof NEMOTRON_AUDIO_MODEL_ID;
  readonly fallbackModelId: typeof WHISPER_AUDIO_MODEL_ID;
  readonly activeMode: AudioMode | null;
  readonly fallbackAvailable: boolean;
  readonly fallbackReason: string | null;
  readonly modelCached: boolean;
  readonly localAudioReady: boolean;
  readonly externalEndpointUsed: false;
  readonly maxDurationMs: typeof AUDIO_MAX_DURATION_MS;
  readonly inputFormat: "PCM16LE · 16 kHz · mono";
  readonly status:
    | "not_initialized"
    | "checking"
    | "preparation_required"
    | "loading"
    | "ready"
    | "streaming"
    | "transcribing"
    | "model_unavailable"
    | "error";
  readonly detail: string;
  readonly lastTranscriptionMs: number | null;
}

export interface AudioCapturePayload {
  readonly format: typeof AUDIO_FORMAT;
  readonly sampleRate: typeof AUDIO_SAMPLE_RATE;
  readonly channels: typeof AUDIO_CHANNELS;
  readonly durationMs: number;
  readonly data: ArrayBuffer;
  readonly liveCaptionFailure?: string | null;
}

export interface ValidatedAudioCapture {
  readonly format: typeof AUDIO_FORMAT;
  readonly sampleRate: typeof AUDIO_SAMPLE_RATE;
  readonly channels: typeof AUDIO_CHANNELS;
  readonly durationMs: number;
  readonly pcmBytes: Uint8Array;
  readonly liveCaptionFailure: string | null;
}

export interface AudioTranscriptionResult {
  readonly transcript: string;
  readonly transcriptionMs: number;
  readonly audioDurationMs: number;
  readonly model: AudioModelIdentity;
  readonly mode: AudioMode;
  readonly transcriptSource: "live_stream_final" | "whisper_file_final";
  readonly firstPartialMs: number | null;
  readonly finalizationMs: number;
  readonly externalEndpointUsed: false;
}

export interface PrepareAudioRequest {
  readonly mode: AudioMode;
}

export interface AudioStreamStartRequest {
  readonly format: typeof AUDIO_FORMAT;
  readonly sampleRate: typeof AUDIO_SAMPLE_RATE;
  readonly channels: typeof AUDIO_CHANNELS;
  readonly maxDurationMs: typeof AUDIO_MAX_DURATION_MS;
}

export interface AudioStreamStartResponse {
  readonly streamId: string;
  readonly model: AudioModelIdentity;
  readonly mode: "nemotron_streaming";
}

export interface AudioStreamChunkRequest {
  readonly streamId: string;
  readonly sequence: number;
  readonly data: ArrayBuffer;
}

export interface AudioStreamChunkResponse {
  readonly acceptedSequence: number;
  readonly totalBytes: number;
}

export interface AudioStreamFinishRequest {
  readonly streamId: string;
  readonly lastSequence: number;
  readonly audioDurationMs: number;
}

export interface AudioStreamCancelRequest {
  readonly streamId: string;
}

export interface AudioPartialTranscriptEvent {
  readonly streamId: string;
  readonly sequence: number;
  readonly text: string;
  readonly firstPartialMs: number;
  readonly model: AudioModelIdentity;
  readonly mode: "nemotron_streaming";
  readonly externalEndpointUsed: false;
}

export interface LiveTranscriptDraft {
  readonly streamId: string | null;
  readonly sequence: number;
  readonly text: string;
  readonly isFinal: boolean;
}

export type AudioCaptureValidationErrorCode =
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SAMPLE_RATE"
  | "UNSUPPORTED_CHANNEL_COUNT"
  | "DURATION_OUT_OF_RANGE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_PCM_LENGTH"
  | "DURATION_SIZE_MISMATCH";

export interface AudioCaptureValidationError {
  readonly code: AudioCaptureValidationErrorCode;
  readonly message: string;
}

export type AudioCaptureValidationResult =
  | { readonly ok: true; readonly value: ValidatedAudioCapture }
  | { readonly ok: false; readonly error: AudioCaptureValidationError };

export type AudioRecorderStatus = "idle" | "requesting_permission" | "recording" | "transcribing" | "error";

export interface AudioRecorderState {
  readonly status: AudioRecorderStatus;
  readonly elapsedMs: number;
  readonly detail: string;
}

export type AudioRecorderEvent =
  | { readonly type: "REQUEST_PERMISSION" }
  | { readonly type: "START" }
  | { readonly type: "TICK"; readonly elapsedMs: number }
  | { readonly type: "TRANSCRIBE" }
  | { readonly type: "COMPLETE" }
  | { readonly type: "FAIL"; readonly detail: string }
  | { readonly type: "RESET" };

export interface TranscriptDraftUpdate {
  readonly value: string;
  readonly shouldSubmit: false;
}
