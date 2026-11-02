import { contextBridge, ipcRenderer } from "electron";
import type { AssistantLaneSnapshot } from "../assistant/assistant-types";
import type {
  AudioCapturePayload,
  AudioPartialTranscriptEvent,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamChunkResponse,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  AudioStreamStartResponse,
} from "../audio/audio-types";
import {
  type AssistantAskRequest,
  type AssistantBootstrapResponse,
  type AssistantCancelRequest,
  type AssistantSessionRequest,
  type AssistantSetModeRequest,
  type AssistantStartResponse,
  type AssistantUpdateEvent,
  type EditTranscriptRequest,
  type ImportWavResponse,
  ipcChannels,
  type LiveStreamResult,
  type MicrophoneAuthorizationRequest,
  type PrepareRecorderRequest,
  type PrepareRecorderResponse,
  type ProgressEvent,
  type RecorderApi,
  type RecorderSnapshot,
  type SummaryResponse,
  type TranscriptionResponse,
} from "../shared/contracts";
import { type SafeDiagnosticCode, toSafeDiagnostic } from "../shared/safe-diagnostic";

const api: RecorderApi = {
  getBootstrap: () => invokeSafely<RecorderSnapshot>(ipcChannels.bootstrap, "LOCAL_OPERATION_FAILED"),
  prepare: (request: PrepareRecorderRequest) =>
    invokeSafely<PrepareRecorderResponse>(ipcChannels.prepare, "LOCAL_OPERATION_FAILED", request),
  authorizeMicrophone: () => {
    const request: MicrophoneAuthorizationRequest = {
      hasTransientUserActivation: navigator.userActivation.isActive,
    };
    return invokeSafely<void>(ipcChannels.authorizeMicrophone, "PERMISSION_DENIED", request);
  },
  startLiveStream: (request: AudioStreamStartRequest) =>
    invokeSafely<AudioStreamStartResponse>(ipcChannels.startLiveStream, "OPTIONAL_LIVE_FAILED", request),
  appendLiveChunk: (request: AudioStreamChunkRequest) =>
    invokeSafely<AudioStreamChunkResponse>(ipcChannels.appendLiveChunk, "OPTIONAL_LIVE_FAILED", request),
  finishLiveStream: (request: AudioStreamFinishRequest) =>
    invokeSafely<LiveStreamResult>(ipcChannels.finishLiveStream, "OPTIONAL_LIVE_FAILED", request),
  cancelLiveStream: (request: AudioStreamCancelRequest) =>
    invokeSafely<void>(ipcChannels.cancelLiveStream, "OPTIONAL_LIVE_CLEANUP_PENDING", request),
  transcribeCapture: (request: AudioCapturePayload) =>
    invokeSafely<TranscriptionResponse>(ipcChannels.transcribeCapture, "LOCAL_OPERATION_FAILED", request),
  importWav: () => invokeSafely<ImportWavResponse | null>(ipcChannels.importWav, "LOCAL_OPERATION_FAILED"),
  editTranscript: (request: EditTranscriptRequest) =>
    invokeSafely<RecorderSnapshot>(ipcChannels.editTranscript, "LOCAL_OPERATION_FAILED", request),
  generateSummary: () => invokeSafely<SummaryResponse>(ipcChannels.generateSummary, "LOCAL_OPERATION_FAILED"),
  reset: () => invokeSafely<RecorderSnapshot>(ipcChannels.reset, "LOCAL_OPERATION_FAILED"),
  getAssistantBootstrap: () =>
    invokeSafely<AssistantBootstrapResponse>(ipcChannels.assistantBootstrap, "OPTIONAL_ASSISTANT_FAILED"),
  selectAssistantImage: (request: AssistantSessionRequest) =>
    invokeSafely<AssistantLaneSnapshot | null>(
      ipcChannels.assistantSelectImage,
      "OPTIONAL_ASSISTANT_FAILED",
      request,
    ),
  setAssistantMode: (request: AssistantSetModeRequest) =>
    invokeSafely<AssistantLaneSnapshot>(ipcChannels.assistantSetMode, "OPTIONAL_ASSISTANT_FAILED", request),
  analyzeAssistantImage: (request: AssistantSessionRequest) =>
    invokeSafely<AssistantStartResponse>(
      ipcChannels.assistantAnalyzeImage,
      "OPTIONAL_ASSISTANT_FAILED",
      request,
    ),
  askAssistant: (request: AssistantAskRequest) =>
    invokeSafely<AssistantStartResponse>(ipcChannels.assistantAsk, "OPTIONAL_ASSISTANT_FAILED", request),
  cancelAssistant: (request: AssistantCancelRequest) =>
    invokeSafely<AssistantLaneSnapshot>(
      ipcChannels.assistantCancel,
      "OPTIONAL_ASSISTANT_CLEANUP_PENDING",
      request,
    ),
  clearAssistantChat: (request: AssistantSessionRequest) =>
    invokeSafely<AssistantLaneSnapshot>(
      ipcChannels.assistantClearChat,
      "OPTIONAL_ASSISTANT_CLEANUP_PENDING",
      request,
    ),
  removeAssistantImage: (request: AssistantSessionRequest) =>
    invokeSafely<AssistantLaneSnapshot>(
      ipcChannels.assistantRemoveImage,
      "OPTIONAL_ASSISTANT_CLEANUP_PENDING",
      request,
    ),
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ProgressEvent) => callback(progress);
    ipcRenderer.on(ipcChannels.progress, listener);
    return () => ipcRenderer.removeListener(ipcChannels.progress, listener);
  },
  onAudioPartial: (callback: (event: AudioPartialTranscriptEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, partial: AudioPartialTranscriptEvent) =>
      callback(partial);
    ipcRenderer.on(ipcChannels.audioPartial, listener);
    return () => ipcRenderer.removeListener(ipcChannels.audioPartial, listener);
  },
  onAssistantUpdate: (callback: (event: AssistantUpdateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: AssistantUpdateEvent) => callback(update);
    ipcRenderer.on(ipcChannels.assistantUpdate, listener);
    return () => ipcRenderer.removeListener(ipcChannels.assistantUpdate, listener);
  },
};

contextBridge.exposeInMainWorld("recorderApi", api);

async function invokeSafely<T>(
  channel: string,
  fallbackCode: SafeDiagnosticCode,
  ...args: readonly unknown[]
): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    throw toSafeDiagnostic(error, fallbackCode);
  }
}
