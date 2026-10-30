import { contextBridge, ipcRenderer } from "electron";
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

const api: RecorderApi = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.bootstrap) as Promise<RecorderSnapshot>,
  prepare: (request: PrepareRecorderRequest) =>
    ipcRenderer.invoke(ipcChannels.prepare, request) as Promise<PrepareRecorderResponse>,
  authorizeMicrophone: () => {
    const request: MicrophoneAuthorizationRequest = {
      hasTransientUserActivation: navigator.userActivation.isActive,
    };
    return ipcRenderer.invoke(ipcChannels.authorizeMicrophone, request) as Promise<void>;
  },
  startLiveStream: (request: AudioStreamStartRequest) =>
    ipcRenderer.invoke(ipcChannels.startLiveStream, request) as Promise<AudioStreamStartResponse>,
  appendLiveChunk: (request: AudioStreamChunkRequest) =>
    ipcRenderer.invoke(ipcChannels.appendLiveChunk, request) as Promise<AudioStreamChunkResponse>,
  finishLiveStream: (request: AudioStreamFinishRequest) =>
    ipcRenderer.invoke(ipcChannels.finishLiveStream, request) as Promise<LiveStreamResult>,
  cancelLiveStream: (request: AudioStreamCancelRequest) =>
    ipcRenderer.invoke(ipcChannels.cancelLiveStream, request) as Promise<void>,
  transcribeCapture: (request: AudioCapturePayload) =>
    ipcRenderer.invoke(ipcChannels.transcribeCapture, request) as Promise<TranscriptionResponse>,
  importWav: () => ipcRenderer.invoke(ipcChannels.importWav) as Promise<ImportWavResponse | null>,
  editTranscript: (request: EditTranscriptRequest) =>
    ipcRenderer.invoke(ipcChannels.editTranscript, request) as Promise<RecorderSnapshot>,
  generateSummary: () => ipcRenderer.invoke(ipcChannels.generateSummary) as Promise<SummaryResponse>,
  reset: () => ipcRenderer.invoke(ipcChannels.reset) as Promise<RecorderSnapshot>,
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
};

contextBridge.exposeInMainWorld("recorderApi", api);
