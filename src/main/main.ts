import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  session,
  type WebContents,
  type WebFrameMain,
} from "electron";
import type {
  AudioCapturePayload,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
} from "../audio/audio-types";
import { AUDIO_MAX_PCM_BYTES } from "../audio/audio-types";
import {
  type EditTranscriptRequest,
  ipcChannels,
  type MicrophoneAuthorizationRequest,
  type PrepareRecorderRequest,
} from "../shared/contracts";
import { type AudioStreamOwnerIdentity, AudioStreamOwnership } from "./audio-stream-owner";
import {
  isAllowedAppNavigation,
  MicrophonePermissionGate,
  permissionOriginForDocument,
} from "./microphone-permission";
import { RecorderController } from "./recorder-controller";

let mainWindow: BrowserWindow | null = null;
let mainWebContents: WebContents | null = null;
let microphonePermissionGate: MicrophonePermissionGate | null = null;
let shutdownStarted = false;
const controller = new RecorderController();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererFilePath = path.join(currentDirectory, "..", "renderer", "index.html");
const rendererDocumentUrl = pathToFileURL(rendererFilePath).href;
const rendererPermissionOrigin = permissionOriginForDocument(rendererDocumentUrl);
const microphonePermissionProbeEnabled = process.env.SMART_RECORDER_MIC_PERMISSION_PROBE === "1";
const streamOwnerProbeEnabled = process.env.SMART_RECORDER_STREAM_OWNER_PROBE === "1";
const streamOwnerReloadProbeId = "00000000-0000-4000-8000-000000000001";
const streamOwnerCloseProbeId = "00000000-0000-4000-8000-000000000002";
const streamOwnerProbeIds = new Set([streamOwnerReloadProbeId, streamOwnerCloseProbeId]);
const streamOwnerProbeCancellations = new Set<string>();
let streamOwnerProbeTerminating = false;
let microphonePermissionProbeCheck:
  | {
      readonly requestingOrigin: string;
      readonly requestingUrl: string | undefined;
      readonly securityOrigin: string | undefined;
      readonly mediaType: string | undefined;
      readonly allowed: boolean;
    }
  | undefined;
let microphonePermissionProbeRequest:
  | {
      readonly requestingUrl: string | undefined;
      readonly securityOrigin: string | undefined;
      readonly mediaTypes: readonly string[] | undefined;
      readonly allowed: boolean;
    }
  | undefined;

const audioStreamOwnership = new AudioStreamOwnership(async (streamId) => {
  if (streamOwnerProbeEnabled && streamOwnerProbeIds.has(streamId)) {
    streamOwnerProbeCancellations.add(streamId);
    return;
  }
  await controller.cancelLiveStream(streamId);
});

if (process.env.SMART_RECORDER_CAPTURE_PATH?.trim()) {
  app.disableHardwareAcceleration();
}
if (microphonePermissionProbeEnabled) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
}
if (streamOwnerProbeEnabled) {
  process.on("uncaughtException", (error) => failStreamOwnerProbe("UNCAUGHT_EXCEPTION", error));
  process.on("unhandledRejection", (error) => failStreamOwnerProbe("UNHANDLED_REJECTION", error));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: "#071018",
    title: "Smart AI Recorder",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const webContents = window.webContents;
  const webContentsId = webContents.id;
  mainWebContents = webContents;
  const permissionGate = new MicrophonePermissionGate({
    expectedWebContents: webContents,
    expectedDocumentUrl: rendererDocumentUrl,
    expectedOrigin: rendererPermissionOrigin,
  });
  microphonePermissionGate = permissionGate;
  webContents.setWindowOpenHandler(() => {
    permissionGate.revoke();
    return { action: "deny" };
  });
  webContents.on("will-frame-navigate", (event) => {
    permissionGate.revoke();
    if (event.isMainFrame) {
      revokeAudioStreamOwner(webContentsId, frameOwnership(event.frame));
    }
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event) => {
    permissionGate.revoke();
    if (event.isMainFrame) {
      revokeAudioStreamOwner(webContentsId, frameOwnership(event.frame));
    }
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) {
      revokeAudioStreamOwner(webContentsId);
    }
  });
  webContents.on("render-process-gone", () => {
    permissionGate.revoke();
    revokeAudioStreamOwner(webContentsId);
  });
  webContents.on("destroyed", () => {
    revokeAudioStreamOwner(webContentsId);
    if (mainWebContents === webContents) {
      mainWebContents = null;
    }
  });
  window.on("closed", () => {
    permissionGate.revoke();
    revokeAudioStreamOwner(webContentsId);
    if (mainWindow === window) {
      mainWindow = null;
      if (mainWebContents === webContents) {
        mainWebContents = null;
      }
      microphonePermissionGate = null;
    }
  });

  void webContents.loadURL(rendererDocumentUrl);
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });
  if (process.env.SMART_RECORDER_SMOKE_AND_EXIT === "1") {
    webContents.once("did-finish-load", () => setTimeout(() => app.quit(), 3_000));
  }
  if (microphonePermissionProbeEnabled) {
    webContents.once("did-finish-load", () => void runMicrophonePermissionProbe(webContents));
  }
  if (streamOwnerProbeEnabled) {
    webContents.once("did-finish-load", () => void runStreamOwnerProbe(window, webContents, webContentsId));
  }
  if (process.env.SMART_RECORDER_OPEN_DEVTOOLS === "1") {
    webContents.openDevTools({ mode: "detach" });
  }

  const capturePath = process.env.SMART_RECORDER_CAPTURE_PATH?.trim();
  if (capturePath) {
    webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        if (webContents.isDestroyed()) {
          throw new Error("The renderer was destroyed before UI capture.");
        }
        const image = await webContents.capturePage();
        await mkdir(path.dirname(capturePath), { recursive: true });
        await writeFile(capturePath, image.toPNG());
        if (process.env.SMART_RECORDER_CAPTURE_AND_EXIT === "1") {
          app.quit();
        }
      } catch (error) {
        console.error("Failed to capture Smart AI Recorder UI:", error);
        app.exit(1);
      }
    });
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.bootstrap, (event) => {
    assertTrustedRendererIpc(event);
    return controller.bootstrap();
  });
  ipcMain.handle(ipcChannels.prepare, (event, request: PrepareRecorderRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    return controller.prepare(request, (progress) => {
      sendToFrame(renderer.frame, ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.authorizeMicrophone, (event, request: MicrophoneAuthorizationRequest) => {
    const window = mainWindow;
    const webContents = mainWebContents;
    const gate = microphonePermissionGate;
    const frame = event.senderFrame;
    if (
      window === null ||
      window.isDestroyed() ||
      webContents === null ||
      webContents.isDestroyed() ||
      event.sender !== webContents ||
      gate === null ||
      !gate.authorize({
        webContents: event.sender,
        frame,
        mainFrame: event.sender.mainFrame,
        documentUrl: event.sender.getURL(),
        frameUrl: frame?.url ?? "",
        hasTransientUserActivation: request?.hasTransientUserActivation === true,
      })
    ) {
      throw new Error("Microphone capture was not authorized by an active app gesture.");
    }
  });
  ipcMain.handle(ipcChannels.startLiveStream, async (event, request: AudioStreamStartRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    const lease = audioStreamOwnership.begin(renderer.owner);
    try {
      const response = await controller.startLiveStream(request, (partial) => {
        if (!audioStreamOwnership.canRoute(lease, partial.streamId)) {
          return;
        }
        if (!sendToFrame(renderer.frame, ipcChannels.audioPartial, partial)) {
          revokeAudioStreamOwner(renderer.owner.webContentsId, renderer.owner);
        }
      });
      if (!(await audioStreamOwnership.activate(lease, response.streamId))) {
        throw new Error("The renderer frame was replaced before the live stream became active.");
      }
      return response;
    } catch (error) {
      audioStreamOwnership.release(lease);
      throw error;
    }
  });
  ipcMain.handle(ipcChannels.appendLiveChunk, (event, request: AudioStreamChunkRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    audioStreamOwnership.assertOwned(renderer.owner, request.streamId);
    return controller.appendLiveChunk(request);
  });
  ipcMain.handle(ipcChannels.finishLiveStream, async (event, request: AudioStreamFinishRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    return audioStreamOwnership.finish(renderer.owner, request.streamId, () =>
      controller.finishLiveStream(request),
    );
  });
  ipcMain.handle(ipcChannels.cancelLiveStream, async (event, request: AudioStreamCancelRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    audioStreamOwnership.assertOwned(renderer.owner, request.streamId);
    try {
      await controller.cancelLiveStream(request.streamId);
    } finally {
      audioStreamOwnership.complete(renderer.owner, request.streamId);
    }
  });
  ipcMain.handle(ipcChannels.transcribeCapture, (event, request: AudioCapturePayload) => {
    assertTrustedRendererIpc(event);
    return controller.transcribeCapture(request);
  });
  ipcMain.handle(ipcChannels.importWav, async (event) => {
    assertTrustedRendererIpc(event);
    const owner = mainWindow;
    if (owner === null || owner.isDestroyed()) {
      throw new Error("The application window is not available.");
    }
    const result = await dialog.showOpenDialog(owner, {
      title: "Open a 16 kHz mono PCM WAV",
      properties: ["openFile"],
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || filePath === undefined) {
      return null;
    }
    const file = await stat(filePath);
    if (file.size > AUDIO_MAX_PCM_BYTES + 1_048_576) {
      throw new Error("The selected WAV exceeds the bounded 30-second import limit.");
    }
    return controller.transcribeImportedWav(path.basename(filePath), await readFile(filePath));
  });
  ipcMain.handle(ipcChannels.editTranscript, (event, request: EditTranscriptRequest) => {
    assertTrustedRendererIpc(event);
    return controller.editTranscript(request.text);
  });
  ipcMain.handle(ipcChannels.generateSummary, (event) => {
    assertTrustedRendererIpc(event);
    return controller.generateSummary();
  });
  ipcMain.handle(ipcChannels.reset, async (event) => {
    const renderer = assertTrustedRendererIpc(event);
    await audioStreamOwnership.revokeOwner(renderer.owner.webContentsId, renderer.owner);
    return controller.reset();
  });
}

function assertTrustedRendererIpc(event: IpcMainInvokeEvent): {
  readonly webContents: WebContents;
  readonly frame: WebFrameMain;
  readonly owner: AudioStreamOwnerIdentity;
} {
  const window = mainWindow;
  const webContents = mainWebContents;
  const frame = event.senderFrame;
  if (
    window === null ||
    window.isDestroyed() ||
    webContents === null ||
    webContents.isDestroyed() ||
    event.sender.isDestroyed() ||
    event.sender !== webContents ||
    frame === null ||
    frame !== event.sender.mainFrame ||
    event.sender.getURL() !== rendererDocumentUrl ||
    frame.url !== rendererDocumentUrl
  ) {
    throw new Error("Recorder IPC is restricted to the active application main frame.");
  }
  return {
    webContents: event.sender,
    frame,
    owner: {
      webContentsId: event.sender.id,
      processId: event.processId,
      frameId: event.frameId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameToken: frame.frameToken,
    },
  };
}

function sendToFrame(frame: WebFrameMain, channel: string, payload: unknown): boolean {
  try {
    if (frame.isDestroyed() || frame.detached) {
      return false;
    }
    frame.send(channel, payload);
    return true;
  } catch (error) {
    console.error(`Failed to send ${channel} to the owning renderer frame:`, error);
    return false;
  }
}

function revokeAudioStreamOwner(
  webContentsId: number,
  frame?: Pick<AudioStreamOwnerIdentity, "frameTreeNodeId" | "frameToken">,
): void {
  void audioStreamOwnership.revokeOwner(webContentsId, frame).catch((error: unknown) => {
    console.error("Failed to cancel the renderer-owned live stream:", error);
  });
}

function frameOwnership(
  frame: WebFrameMain | null,
): Pick<AudioStreamOwnerIdentity, "frameTreeNodeId" | "frameToken"> | undefined {
  if (frame === null) {
    return undefined;
  }
  try {
    if (frame.isDestroyed()) {
      return undefined;
    }
    return { frameTreeNodeId: frame.frameTreeNodeId, frameToken: frame.frameToken };
  } catch (error) {
    console.error("Failed to capture renderer frame ownership:", error);
    return undefined;
  }
}

registerIpc();

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const gate = microphonePermissionGate;
    const allowed =
      gate?.allowCheck({
        webContents,
        mainFrame: webContents?.mainFrame ?? null,
        currentDocumentUrl: webContents?.getURL() ?? "",
        mainFrameUrl: webContents?.mainFrame.url ?? "",
        permission,
        requestingOrigin,
        requestingUrl: details.requestingUrl,
        securityOrigin: details.securityOrigin,
        mediaType: details.mediaType,
        isMainFrame: details.isMainFrame,
      }) ?? false;
    if (microphonePermissionProbeEnabled) {
      microphonePermissionProbeCheck = {
        requestingOrigin,
        requestingUrl: details.requestingUrl,
        securityOrigin: details.securityOrigin,
        mediaType: details.mediaType,
        allowed,
      };
    }
    return allowed;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const gate = microphonePermissionGate;
    const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const allowed =
      gate?.allowRequest({
        webContents,
        mainFrame: webContents.mainFrame,
        currentDocumentUrl: webContents.getURL(),
        mainFrameUrl: webContents.mainFrame.url,
        permission,
        requestingUrl: details.requestingUrl,
        securityOrigin,
        mediaTypes,
        isMainFrame: details.isMainFrame,
      }) ?? false;
    if (microphonePermissionProbeEnabled) {
      microphonePermissionProbeRequest = {
        requestingUrl: details.requestingUrl,
        securityOrigin,
        mediaTypes,
        allowed,
      };
    }
    callback(allowed);
  });
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

async function runMicrophonePermissionProbe(webContents: WebContents): Promise<void> {
  try {
    const rendererResult = (await webContents.executeJavaScript(
      `(async () => {
        await window.recorderApi.authorizeMicrophone();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const result = {
          documentUrl: window.location.href,
          audioTrackCount: stream.getAudioTracks().length,
          videoTrackCount: stream.getVideoTracks().length,
        };
        for (const track of stream.getTracks()) track.stop();
        return result;
      })()`,
      true,
    )) as {
      readonly documentUrl: string;
      readonly audioTrackCount: number;
      readonly videoTrackCount: number;
    };
    if (
      rendererResult.documentUrl !== rendererDocumentUrl ||
      rendererResult.audioTrackCount < 1 ||
      rendererResult.videoTrackCount !== 0 ||
      microphonePermissionProbeRequest?.allowed !== true ||
      microphonePermissionProbeRequest.requestingUrl !== rendererDocumentUrl ||
      microphonePermissionProbeRequest.securityOrigin !== rendererPermissionOrigin ||
      microphonePermissionProbeRequest.mediaTypes?.length !== 1 ||
      microphonePermissionProbeRequest.mediaTypes[0] !== "audio"
    ) {
      throw new Error(
        `Microphone permission probe missed the exact grant path: ${JSON.stringify({
          rendererDocumentUrl,
          rendererPermissionOrigin,
          rendererResult,
          permissionCheck: microphonePermissionProbeCheck,
          permissionRequest: microphonePermissionProbeRequest,
        })}`,
      );
    }
    console.log(
      `MICROPHONE_PERMISSION_PROBE_OK ${JSON.stringify({
        rendererDocumentUrl,
        rendererPermissionOrigin,
        rendererResult,
        permissionCheck: microphonePermissionProbeCheck,
        permissionRequest: microphonePermissionProbeRequest,
      })}`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error("MICROPHONE_PERMISSION_PROBE_FAILED", error);
  } finally {
    app.quit();
  }
}

async function runStreamOwnerProbe(
  window: BrowserWindow,
  webContents: WebContents,
  webContentsId: number,
): Promise<void> {
  try {
    const frame = webContents.mainFrame;
    const previousFrameToken = frame.frameToken;
    const lease = audioStreamOwnership.begin({
      webContentsId,
      processId: frame.processId,
      frameId: frame.routingId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameToken: frame.frameToken,
    });
    if (!(await audioStreamOwnership.activate(lease, streamOwnerReloadProbeId))) {
      throw new Error("The initial renderer frame could not acquire the probe stream.");
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for renderer reload.")), 10_000);
      webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
      webContents.reload();
    });
    if (
      !streamOwnerProbeCancellations.has(streamOwnerReloadProbeId) ||
      audioStreamOwnership.canRoute(lease, streamOwnerReloadProbeId)
    ) {
      throw new Error("Renderer reload did not cancel and revoke the original stream owner.");
    }
    const currentFrame = webContents.mainFrame;
    const currentFrameToken = currentFrame.frameToken;
    const nextLease = audioStreamOwnership.begin({
      webContentsId,
      processId: currentFrame.processId,
      frameId: currentFrame.routingId,
      frameTreeNodeId: currentFrame.frameTreeNodeId,
      frameToken: currentFrame.frameToken,
    });
    if (!(await audioStreamOwnership.activate(nextLease, streamOwnerCloseProbeId))) {
      throw new Error("The replacement renderer could not acquire the close probe stream.");
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for window close.")), 10_000);
      window.once("closed", () => {
        clearTimeout(timeout);
        resolve();
      });
      window.close();
    });
    await waitForProbeCancellation(streamOwnerCloseProbeId);
    if (audioStreamOwnership.canRoute(nextLease, streamOwnerCloseProbeId)) {
      throw new Error("Window close left the old stream owner routable.");
    }
    console.log(
      `STREAM_OWNER_PROBE_OK ${JSON.stringify({
        previousFrameToken,
        currentFrameToken,
        previousSessionId: lease.sessionId,
        currentSessionId: nextLease.sessionId,
        reloadCancelled: true,
        closeCancelled: true,
        stalePartialRoutable: false,
      })}`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error("STREAM_OWNER_PROBE_FAILED", error);
  } finally {
    streamOwnerProbeTerminating = true;
    app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  }
}

async function waitForProbeCancellation(streamId: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!streamOwnerProbeCancellations.has(streamId)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for cancellation of probe stream ${streamId}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function failStreamOwnerProbe(kind: string, error: unknown): void {
  if (streamOwnerProbeTerminating) {
    return;
  }
  streamOwnerProbeTerminating = true;
  process.exitCode = 1;
  console.error(`STREAM_OWNER_PROBE_${kind}`, error);
  app.exit(1);
}

app.on("window-all-closed", () => {
  if (streamOwnerProbeEnabled) {
    return;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void controller
    .shutdown()
    .catch((error: unknown) => {
      process.exitCode = 1;
      console.error("Failed to shut down Foundry Local cleanly:", error);
    })
    .finally(() => app.quit());
});
