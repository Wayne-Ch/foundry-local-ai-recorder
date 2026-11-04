import "katex/dist/katex.min.css";
import "../renderer/styles.css";
import type { AssistantLaneSnapshot, AssistantTraceEntry } from "../assistant/assistant-types";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
} from "../audio/audio-types";
import type { ModelReadiness, RecorderSnapshot, TraceEntry } from "../shared/contracts";
import { formatSafeDiagnostic, type SafeDiagnostic, toSafeDiagnostic } from "../shared/safe-diagnostic";
import { type AssistantUiAction, applyAssistantControlProgress } from "./assistant-control-progress";
import {
  assistantOperationStatusMessage,
  imageAnalysisMetadataValue,
  imageAnalysisProgress,
  imageAnalysisProgressMessage,
  renderAssistantChatRows,
  renderImageAnalyzeButton,
} from "./assistant-progress";
import {
  BoundedAudioChunkPump,
  BoundedPcmCapture,
  beginRecordingStop,
  cancelRecordingAndReset,
  finalizeCapturedAudio,
  LiveCaptionFailureState,
  LivePcmCapture,
  recordingLimitDelay,
  releaseMediaStream,
} from "./audio-capture";
import { applyRecorderProgress, type RecorderOperationState } from "./recorder-progress";

interface RecordingOperation {
  readonly generation: number;
  readonly mediaStream: MediaStream;
  readonly capture: LivePcmCapture;
  pump: BoundedAudioChunkPump | null;
  readonly liveCaptionFailure: LiveCaptionFailureState;
  readonly streamId: string | null;
  readonly startedAt: number;
  readonly pcm: BoundedPcmCapture;
  timerId: number;
  limitId: number;
  stopping: boolean;
}

const api = window.recorderApi;
const root = document.querySelector<HTMLDivElement>("#app");
if (root === null) {
  throw new Error("Missing application root.");
}

root.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">WINDOWS 11 · LOCAL CACHED INFERENCE</p>
        <h1>Smart AI Recorder</h1>
      </div>
      <div class="topbar-status">
        <span class="privacy-pill"><span class="pulse-dot"></span><span id="privacy-state">Endpoint guard pending</span></span>
        <span id="clock" class="clock">00:00</span>
      </div>
    </header>

    <section id="model-rail" class="model-rail" aria-label="Local model readiness" aria-live="polite">
      <article id="nemotron-card" class="model-card" data-model="nemotron">
        <span class="step-number">01</span>
        <div><p>Live draft</p><strong>Nemotron</strong><small id="nemotron-id"></small><small id="nemotron-detail" class="model-detail"></small></div>
        <span id="nemotron-state" class="state-chip"></span>
      </article>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <article id="whisper-card" class="model-card model-card-primary" data-model="whisper">
        <span class="step-number">02</span>
        <div><p>Authoritative final</p><strong>Whisper</strong><small id="whisper-id"></small><small id="whisper-detail" class="model-detail"></small></div>
        <span id="whisper-state" class="state-chip"></span>
      </article>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <article id="summary-card-model" class="model-card" data-model="summary">
        <span class="step-number">03</span>
        <div><p>Post-session</p><strong>Local summary</strong><small id="summary-id"></small><small id="summary-detail" class="model-detail"></small></div>
        <span id="summary-state" class="state-chip"></span>
      </article>
    </section>

    <section id="workspace" class="workspace">
      <aside class="control-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">CAPTURE</p>
            <h2>Record locally</h2>
          </div>
          <span id="recording-indicator" class="recording-indicator">Idle</span>
        </div>

        <div class="consent-card">
          <label>
            <input id="consent" type="checkbox" />
            <span>I have consent to record this audio.</span>
          </label>
          <p>Microphone data stays on this PC and temporary audio is deleted after transcription.</p>
        </div>

        <label class="toggle-row">
          <span>
            <strong>Live English captions</strong>
            <small>Nemotron draft only; Whisper still creates the final.</small>
          </span>
          <input id="live-toggle" type="checkbox" checked />
        </label>

        <button id="prepare-button" class="button button-secondary button-wide">
          Prepare local models
        </button>

        <div class="record-controls">
          <button id="start-button" class="record-button" disabled aria-label="Start recording">
            <span class="record-icon"></span>
            <span id="start-button-label">Start</span>
          </button>
          <button id="stop-button" class="button button-danger" disabled>Stop</button>
        </div>

        <div class="status-block">
          <div><span>Elapsed</span><strong id="elapsed">00:00.0</strong></div>
          <div><span>Prototype limit</span><strong>30 seconds</strong></div>
        </div>

        <button id="import-button" class="button button-ghost button-wide" disabled>
          Open stage fallback WAV
        </button>
        <p class="format-note">Import accepts PCM16LE · 16 kHz · mono WAV through the same Whisper path.</p>
        <div id="status-message" class="status-message" role="status">Prepare the local models to begin.</div>
      </aside>

      <section class="content-panel">
        <div class="transcript-grid">
          <article id="live-card" class="output-card live-card">
            <div class="output-heading">
              <div>
                <p class="eyebrow">DISPLAY ONLY</p>
                <h2>Live draft <span>Nemotron</span></h2>
              </div>
              <span id="first-caption" class="metric-chip">First caption —</span>
            </div>
            <div id="live-draft" class="live-draft empty" role="status" aria-live="polite" aria-busy="false">
              Live hypotheses will replace each other here. They are never summary input.
            </div>
          </article>

          <article id="final-card" class="output-card final-card">
            <div class="output-heading">
              <div>
                <p class="eyebrow">DURABLE AFTER STOP</p>
                <h2>Final transcript <span>Whisper</span></h2>
              </div>
              <span id="transcript-version" class="metric-chip">Version 0</span>
            </div>
            <textarea id="final-transcript" rows="5" placeholder="Whisper final transcript appears here." disabled></textarea>
            <div class="output-actions">
              <span id="whisper-timing" class="inline-metric">Stop → final —</span>
              <button id="save-transcript" class="button button-ghost" disabled>Save correction</button>
            </div>
          </article>
        </div>

        <article id="summary-card" class="output-card summary-card">
          <div class="output-heading">
            <div>
              <p class="eyebrow">AI-GENERATED · EDITABLE</p>
              <h2>Session summary <span>Qwen</span></h2>
            </div>
            <button id="summary-button" class="button button-primary" disabled>Generate summary</button>
          </div>
          <textarea id="summary-output" rows="4" placeholder="A concise local summary will appear only after you submit a final transcript." disabled></textarea>
          <div class="summary-footer">
            <span id="summary-timing">Transcript final → summary —</span>
            <span id="summary-version">No submitted version</span>
          </div>
        </article>
      </section>

      <aside id="assistant-panel" class="assistant-panel" aria-label="Local AI assistant">
        <div class="assistant-heading">
          <div class="assistant-title">
            <p class="eyebrow">OPTIONAL · LOCAL</p>
            <h2>Lesson assistant</h2>
          </div>
          <button
            id="assistant-collapse"
            class="button button-ghost assistant-collapse"
            type="button"
            aria-expanded="true"
            aria-controls="assistant-body"
          >
            Collapse
          </button>
        </div>
        <div id="assistant-body" class="assistant-body">
          <label class="assistant-mode">
            <span>Mode</span>
            <select id="assistant-mode">
              <option value="classroom">Classroom</option>
              <option value="clinic">Clinic · educational only</option>
            </select>
          </label>
          <p id="assistant-safety" class="assistant-safety">
            Classroom explanations use local context and state uncertainty.
          </p>

          <div class="assistant-tabs" role="tablist" aria-label="Assistant tools">
            <button
              id="assistant-chat-tab"
              class="assistant-tab active"
              type="button"
              role="tab"
              aria-selected="true"
              aria-controls="assistant-chat-panel"
            >
              Ask AI
            </button>
            <button
              id="assistant-image-tab"
              class="assistant-tab"
              type="button"
              role="tab"
              aria-selected="false"
              aria-controls="assistant-image-panel"
              tabindex="-1"
            >
              Image
            </button>
          </div>

          <section
            id="assistant-chat-panel"
            class="assistant-tab-panel"
            role="tabpanel"
            aria-labelledby="assistant-chat-tab"
          >
            <div id="assistant-history" class="assistant-history" aria-live="polite">
              <p class="assistant-empty">
                Ask while recording continues. Live draft context is snapshotted only for that request.
              </p>
            </div>
            <div class="assistant-chips" aria-label="Suggested questions">
              <button
                type="button"
                class="assistant-chip"
                data-prompt="What is ODE? Answer in one sentence."
              >
                What is ODE?
              </button>
              <button
                type="button"
                class="assistant-chip"
                data-prompt="Give one practical example."
              >
                Practical example
              </button>
              <button
                type="button"
                class="assistant-chip"
                data-prompt="Explain the selected image in one sentence."
              >
                Explain image
              </button>
            </div>
            <label class="assistant-input-label" for="assistant-input">Question</label>
            <textarea
              id="assistant-input"
              rows="3"
              maxlength="1000"
              placeholder="Ask a concise question about the lesson…"
            ></textarea>
            <div class="assistant-actions">
              <button id="assistant-ask" class="button button-primary" type="button" disabled>
                Ask
              </button>
              <button id="assistant-cancel" class="button button-danger" type="button" disabled>
                Cancel
              </button>
              <button id="assistant-clear" class="button button-ghost" type="button" disabled>
                Clear
              </button>
            </div>
            <div id="assistant-status" class="assistant-status" role="status">
              Optional assistant lane is not prepared.
            </div>
          </section>

          <section
            id="assistant-image-panel"
            class="assistant-tab-panel"
            role="tabpanel"
            aria-labelledby="assistant-image-tab"
            hidden
          >
            <button
              id="image-select"
              class="button button-secondary button-wide"
              type="button"
              disabled
            >
              Choose PNG, JPEG, or WebP
            </button>
            <p class="assistant-limit">
              Main-process picker · 10 MiB · bounded dimensions · no file path exposed
            </p>
            <div id="image-preview" class="image-preview empty">
              <span>No lesson image selected.</span>
            </div>
            <dl id="image-metadata" class="image-metadata"></dl>
            <div class="assistant-actions">
              <button id="image-analyze" class="button button-primary" type="button" disabled>
                Analyze image
              </button>
              <button id="image-remove" class="button button-ghost" type="button" disabled>
                Remove
              </button>
            </div>
            <article id="image-analysis" class="image-analysis" aria-live="polite">
              <p class="assistant-empty">
                Analysis will show visible text/objects, lesson relation, and uncertainty.
              </p>
            </article>
          </section>
        </div>
      </aside>
    </section>

    <section class="trace-panel">
      <div class="trace-heading">
        <div>
          <p class="eyebrow">DEVELOPER TRACE</p>
          <h2>Application ↔ Foundry Local</h2>
        </div>
        <div class="trace-actions">
          <button id="reset-button" class="button button-ghost">Delete / reset</button>
          <button id="trace-toggle" class="button button-ghost" aria-expanded="false">Show trace</button>
        </div>
      </div>
      <div id="trace-content" class="trace-content" hidden></div>
    </section>
  </main>
`;

const elements = {
  modelRail: required("#model-rail"),
  workspace: required("#workspace"),
  clock: required("#clock"),
  privacyState: required("#privacy-state"),
  consent: required<HTMLInputElement>("#consent"),
  liveToggle: required<HTMLInputElement>("#live-toggle"),
  prepare: required<HTMLButtonElement>("#prepare-button"),
  start: required<HTMLButtonElement>("#start-button"),
  startLabel: required("#start-button-label"),
  stop: required<HTMLButtonElement>("#stop-button"),
  import: required<HTMLButtonElement>("#import-button"),
  elapsed: required("#elapsed"),
  status: required("#status-message"),
  recordingIndicator: required("#recording-indicator"),
  liveDraft: required("#live-draft"),
  liveCard: required("#live-card"),
  firstCaption: required("#first-caption"),
  finalTranscript: required<HTMLTextAreaElement>("#final-transcript"),
  finalCard: required("#final-card"),
  transcriptVersion: required("#transcript-version"),
  whisperTiming: required("#whisper-timing"),
  saveTranscript: required<HTMLButtonElement>("#save-transcript"),
  summary: required<HTMLButtonElement>("#summary-button"),
  summaryOutput: required<HTMLTextAreaElement>("#summary-output"),
  summaryCard: required("#summary-card"),
  summaryTiming: required("#summary-timing"),
  summaryVersion: required("#summary-version"),
  reset: required<HTMLButtonElement>("#reset-button"),
  traceToggle: required<HTMLButtonElement>("#trace-toggle"),
  traceContent: required("#trace-content"),
  assistantPanel: required("#assistant-panel"),
  assistantBody: required("#assistant-body"),
  assistantCollapse: required<HTMLButtonElement>("#assistant-collapse"),
  assistantMode: required<HTMLSelectElement>("#assistant-mode"),
  assistantSafety: required("#assistant-safety"),
  assistantChatTab: required<HTMLButtonElement>("#assistant-chat-tab"),
  assistantImageTab: required<HTMLButtonElement>("#assistant-image-tab"),
  assistantChatPanel: required("#assistant-chat-panel"),
  assistantImagePanel: required("#assistant-image-panel"),
  assistantHistory: required("#assistant-history"),
  assistantInput: required<HTMLTextAreaElement>("#assistant-input"),
  assistantAsk: required<HTMLButtonElement>("#assistant-ask"),
  assistantCancel: required<HTMLButtonElement>("#assistant-cancel"),
  assistantClear: required<HTMLButtonElement>("#assistant-clear"),
  assistantStatus: required("#assistant-status"),
  imageSelect: required<HTMLButtonElement>("#image-select"),
  imagePreview: required("#image-preview"),
  imageMetadata: required("#image-metadata"),
  imageAnalyze: required<HTMLButtonElement>("#image-analyze"),
  imageRemove: required<HTMLButtonElement>("#image-remove"),
  imageAnalysis: required("#image-analysis"),
  model: {
    whisper: {
      card: required("#whisper-card"),
      id: required("#whisper-id"),
      detail: required("#whisper-detail"),
      state: required("#whisper-state"),
    },
    nemotron: {
      card: required("#nemotron-card"),
      id: required("#nemotron-id"),
      detail: required("#nemotron-detail"),
      state: required("#nemotron-state"),
    },
    summary: {
      card: required("#summary-card-model"),
      id: required("#summary-id"),
      detail: required("#summary-detail"),
      state: required("#summary-state"),
    },
  },
};

const populatedSummaryCapture =
  new URLSearchParams(window.location.search).get("capture") === "populated-summary";
const [initialRecorderSnapshot, initialAssistantBootstrap] = await Promise.all([
  api.getBootstrap(),
  api.getAssistantBootstrap().catch(() => null),
]);
let snapshot: RecorderSnapshot = initialRecorderSnapshot;
const assistantSessionId = initialAssistantBootstrap?.sessionId ?? null;
let assistantSnapshot: AssistantLaneSnapshot | null = initialAssistantBootstrap?.snapshot ?? null;
let recording: RecordingOperation | null = null;
let operationGeneration = 0;
let prepared = populatedSummaryCapture;
let liveAvailable = populatedSummaryCapture;
let busy = false;
let recorderOperation: RecorderOperationState = { kind: "idle" };
let summaryDraft = "";
let progressDetail = "";
let transcriptEditorDirty = false;
let assistantUiPending = false;
let assistantUiAction: AssistantUiAction = "idle";
let assistantStatusMessage =
  initialAssistantBootstrap === null
    ? "Optional assistant IPC is unavailable; the core recorder remains usable."
    : "Optional assistant lane is ready on demand.";
let assistantStatusTone: "neutral" | "working" | "success" | "warning" | "error" =
  initialAssistantBootstrap === null ? "error" : "neutral";

render(snapshot);
renderAssistant();
if (populatedSummaryCapture) {
  elements.traceToggle.setAttribute("aria-expanded", "true");
  elements.traceToggle.textContent = "Hide trace";
  elements.traceContent.hidden = false;
  setStatus("Deterministic populated summary capture.", "success");
  requestAnimationFrame(() => window.scrollTo(0, 170));
}

api.onProgress((event) => {
  if (event.operation === "prepare") {
    if (recorderOperation.kind !== "prepare") {
      return;
    }
    progressDetail = event.detail;
    snapshot = { ...snapshot, readiness: event.readiness };
    renderReadiness(snapshot);
    setRecorderOperation({
      kind: "prepare",
      stage: event.stage,
      ...(event.role === undefined ? {} : { role: event.role }),
    });
  } else {
    if (recorderOperation.kind !== "import") {
      return;
    }
    progressDetail = event.detail;
    setRecorderOperation({ kind: "import", stage: event.stage });
  }
  setStatus(event.detail, "working");
});
api.onAudioPartial((event) => {
  if (recording?.streamId !== event.streamId) {
    return;
  }
  elements.liveDraft.textContent = event.text;
  elements.liveDraft.classList.remove("empty");
  setRecorderOperation({ kind: "recording" });
  elements.firstCaption.textContent = `First caption ${formatMilliseconds(event.firstPartialMs)}`;
});
api.onAssistantUpdate((event) => {
  if (event.sessionId !== assistantSessionId) {
    return;
  }
  assistantSnapshot = event.snapshot;
  renderAssistant();
});

elements.prepare.addEventListener("click", () => void prepareModels());
elements.start.addEventListener("click", () => void startRecording());
elements.stop.addEventListener("click", () => void stopRecording());
elements.import.addEventListener("click", () => void importWav());
elements.saveTranscript.addEventListener("click", () => void saveTranscript());
elements.summary.addEventListener("click", () => void generateSummary());
elements.reset.addEventListener("click", () => void resetRecorder());
elements.assistantCollapse.addEventListener("click", () => {
  const expanded = elements.assistantCollapse.getAttribute("aria-expanded") === "true";
  elements.assistantCollapse.setAttribute("aria-expanded", String(!expanded));
  elements.assistantCollapse.textContent = expanded ? "Open" : "Collapse";
  elements.assistantBody.hidden = expanded;
  elements.workspace.classList.toggle("assistant-collapsed", expanded);
});
elements.assistantChatTab.addEventListener("click", () => selectAssistantTab("chat"));
elements.assistantImageTab.addEventListener("click", () => selectAssistantTab("image"));
for (const tab of [elements.assistantChatTab, elements.assistantImageTab]) {
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next = tab === elements.assistantChatTab ? "image" : "chat";
    selectAssistantTab(next);
    (next === "chat" ? elements.assistantChatTab : elements.assistantImageTab).focus();
  });
}
for (const chip of document.querySelectorAll<HTMLButtonElement>(".assistant-chip")) {
  chip.addEventListener("click", () => {
    elements.assistantInput.value = chip.dataset.prompt ?? "";
    elements.assistantInput.focus();
    updateControls();
  });
}
elements.assistantMode.addEventListener("change", () => {
  void setAssistantMode();
});
elements.assistantInput.addEventListener("input", updateControls);
elements.assistantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void askAssistant();
  }
});
elements.assistantAsk.addEventListener("click", () => void askAssistant());
elements.assistantCancel.addEventListener("click", () => void cancelAssistant());
elements.assistantClear.addEventListener("click", () => void clearAssistantChat());
elements.imageSelect.addEventListener("click", () => void selectAssistantImage());
elements.imageAnalyze.addEventListener("click", () => void analyzeAssistantImage());
elements.imageRemove.addEventListener("click", () => void removeAssistantImage());
elements.traceToggle.addEventListener("click", () => {
  const expanded = elements.traceToggle.getAttribute("aria-expanded") === "true";
  elements.traceToggle.setAttribute("aria-expanded", String(!expanded));
  elements.traceToggle.textContent = expanded ? "Show trace" : "Hide trace";
  elements.traceContent.hidden = expanded;
});
elements.consent.addEventListener("change", updateControls);
elements.liveToggle.addEventListener("change", updateControls);
elements.finalTranscript.addEventListener("input", () => {
  transcriptEditorDirty = true;
  updateControls();
});
elements.summaryOutput.addEventListener("input", () => {
  summaryDraft = elements.summaryOutput.value;
});

window.addEventListener("beforeunload", () => {
  operationGeneration += 1;
  const active = recording;
  recording = null;
  if (active !== null) {
    window.clearInterval(active.timerId);
    window.clearTimeout(active.limitId);
    active.pump?.cancel();
    active.liveCaptionFailure.clear();
    active.pcm.clear();
    releaseMediaStream(active.mediaStream);
    void active.capture.stop().catch(() => undefined);
    if (active.streamId !== null) {
      void api.cancelLiveStream({ streamId: active.streamId }).catch(() => undefined);
    }
  }
});

async function prepareModels(): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
  setRecorderOperation({ kind: "prepare", stage: "initializing_runtime" });
  updateControls();
  setStatus("Initializing the Foundry Local in-process runtime…", "working");
  try {
    const response = await api.prepare({ enableLiveCaptions: elements.liveToggle.checked });
    if (generation !== operationGeneration) {
      return;
    }
    snapshot = response.snapshot;
    prepared = true;
    liveAvailable = response.liveCaptionsAvailable;
    const recoveryWarning = startupRecoveryWarning(snapshot);
    if (recoveryWarning !== null) {
      setStatus(recoveryWarning, "warning");
    } else if (elements.liveToggle.checked && !liveAvailable) {
      setStatus(
        `Whisper-only fallback is ready. ${
          response.liveCaptionsFailure === null
            ? "Nemotron is unavailable."
            : formatSafeDiagnostic(response.liveCaptionsFailure)
        }`,
        "warning",
      );
    } else {
      setStatus("Local models are ready. Audio remains on this PC.", "success");
    }
  } catch (error) {
    if (generation !== operationGeneration) {
      return;
    }
    snapshot = await api.getBootstrap().catch(() => snapshot);
    prepared = false;
    liveAvailable = false;
    const recoveryWarning = startupRecoveryWarning(snapshot);
    setStatus(
      recoveryWarning === null ? errorMessage(error) : `${errorMessage(error)} ${recoveryWarning}`,
      "error",
    );
  } finally {
    if (generation === operationGeneration) {
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
      renderAssistant();
    }
  }
}

async function startRecording(): Promise<void> {
  if (!prepared || busy || recording !== null || !elements.consent.checked) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
  setRecorderOperation({ kind: "requesting_microphone" });
  updateControls();
  setStatus("Requesting microphone permission…", "working");
  let mediaStream: MediaStream | null = null;
  let liveCapture: LivePcmCapture | null = null;
  let streamId: string | null = null;
  let pump: BoundedAudioChunkPump | null = null;
  const liveCaptionFailure = new LiveCaptionFailureState();
  const pcm = new BoundedPcmCapture();
  try {
    await api.authorizeMicrophone();
    if (generation !== operationGeneration) {
      return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (generation !== operationGeneration) {
      releaseMediaStream(mediaStream);
      return;
    }

    if (elements.liveToggle.checked && liveAvailable) {
      try {
        setRecorderOperation({ kind: "starting_live_captions" });
        const stream = await api.startLiveStream({
          format: AUDIO_FORMAT,
          sampleRate: AUDIO_SAMPLE_RATE,
          channels: AUDIO_CHANNELS,
          maxDurationMs: AUDIO_MAX_DURATION_MS,
        });
        streamId = stream.streamId;
        if (generation !== operationGeneration) {
          void api.cancelLiveStream({ streamId }).catch(() => undefined);
          releaseMediaStream(mediaStream);
          return;
        }
        pump = new BoundedAudioChunkPump(
          (sequence, data) => api.appendLiveChunk({ streamId: stream.streamId, sequence, data }),
          (error) => {
            liveCaptionFailure.record(error);
            pump?.cancel();
            pump = null;
            if (recording?.generation === generation) {
              recording.pump = null;
            }
            setRecorderOperation({ kind: "recording" });
            setStatus(
              `Live captions stopped: ${liveCaptionDiagnostic(error)}. Whisper still records.`,
              "warning",
            );
          },
        );
      } catch (error) {
        liveAvailable = false;
        setRecorderOperation({ kind: "starting_live_captions" });
        setStatus(
          `Nemotron unavailable: ${liveCaptionDiagnostic(error)}. Recording continues for Whisper.`,
          "warning",
        );
      }
    }

    liveCapture = await LivePcmCapture.start(
      mediaStream,
      (chunk) => {
        if (generation !== operationGeneration) {
          return;
        }
        const { accepted, reachedLimit } = pcm.append(chunk);
        try {
          if (accepted.byteLength > 0) {
            pump?.enqueue(accepted);
          }
        } catch (error) {
          liveCaptionFailure.record(error);
          pump?.cancel();
          pump = null;
          if (recording?.generation === generation) {
            recording.pump = null;
          }
          setRecorderOperation({ kind: "recording" });
          setStatus(
            `Live captions stopped: ${liveCaptionDiagnostic(error)}. Whisper still records.`,
            "warning",
          );
        }
        if (reachedLimit) {
          queueMicrotask(() => void stopRecording("limit"));
        }
      },
      (error) => void failActiveRecording(error),
    );
    if (generation !== operationGeneration) {
      releaseMediaStream(mediaStream);
      await liveCapture.stop().catch(() => undefined);
      if (streamId !== null) {
        void api.cancelLiveStream({ streamId }).catch(() => undefined);
      }
      return;
    }
    const operation: RecordingOperation = {
      generation,
      mediaStream,
      capture: liveCapture,
      pump,
      liveCaptionFailure,
      streamId,
      startedAt: liveCapture.startedAt,
      pcm,
      timerId: window.setInterval(updateElapsed, 100),
      limitId: 0,
      stopping: false,
    };
    recording = operation;
    operation.limitId = window.setTimeout(
      () => void stopRecording("limit"),
      recordingLimitDelay(operation.startedAt, performance.now()),
    );
    elements.liveDraft.textContent =
      streamId === null
        ? "Whisper-only recording active. No live draft is being stored."
        : "Listening for the first replaceable Nemotron hypothesis…";
    elements.liveDraft.classList.toggle("empty", streamId === null);
    setRecorderOperation(streamId === null ? { kind: "recording" } : { kind: "recording_waiting_caption" });
    setStatus(
      streamId === null
        ? "Recording locally for Whisper final transcription."
        : "Recording locally with Nemotron live draft.",
      "recording",
    );
  } catch (error) {
    if (streamId !== null) {
      void api.cancelLiveStream({ streamId }).catch(() => undefined);
    }
    releaseMediaStream(mediaStream);
    if (liveCapture !== null) {
      await liveCapture.stop().catch(() => undefined);
    }
    liveCaptionFailure.clear();
    if (generation === operationGeneration) {
      setRecorderOperation({ kind: "idle" });
      setStatus(microphoneError(error), "error");
    }
  } finally {
    if (generation === operationGeneration) {
      busy = false;
      updateControls();
    }
  }
}

async function stopRecording(reason: "manual" | "limit" = "manual"): Promise<void> {
  const active = recording;
  if (active === null || !beginRecordingStop(active)) {
    return;
  }
  busy = true;
  setRecorderOperation({ kind: "finalizing_capture" });
  window.clearInterval(active.timerId);
  window.clearTimeout(active.limitId);
  elements.recordingIndicator.textContent = "Finalizing";
  setStatus(
    reason === "limit"
      ? "The 30-second limit was reached. Finalizing the bounded capture with Whisper…"
      : "Stopping capture and running the bounded audio through Whisper…",
    "working",
  );
  updateControls();
  try {
    const finalized = await finalizeCapturedAudio({
      capture: active.capture,
      mediaStream: active.mediaStream,
      pcm: active.pcm,
      live: {
        pump: active.pump,
        streamId: active.streamId,
        failure: active.liveCaptionFailure.error,
        isCurrent: () => active.generation === operationGeneration,
        finish: async (lastSequence, audioDurationMs) => {
          if (active.streamId === null) {
            return;
          }
          await api.finishLiveStream({
            streamId: active.streamId,
            lastSequence,
            audioDurationMs,
          });
        },
        cancel: async (streamId) => api.cancelLiveStream({ streamId }),
      },
      releaseStream: releaseMediaStream,
    });
    if (active.generation !== operationGeneration) {
      return;
    }
    if (finalized.liveCaptionCleanup !== null) {
      void finalized.liveCaptionCleanup.then((diagnostic) => {
        if (diagnostic !== null) {
          active.liveCaptionFailure.record(diagnostic);
        }
      });
    }
    if (finalized.durationMs < 300) {
      throw new Error("Record at least 0.3 seconds of audio.");
    }
    const payload: AudioCapturePayload = {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: finalized.durationMs,
      data: finalized.pcmBytes.buffer.slice(
        finalized.pcmBytes.byteOffset,
        finalized.pcmBytes.byteOffset + finalized.pcmBytes.byteLength,
      ) as ArrayBuffer,
      liveCaptionFailure: finalized.liveCaptionError,
    };
    setRecorderOperation({ kind: "transcribing" });
    setStatus("Running the bounded capture through the local Whisper model…", "working");
    const response = await api.transcribeCapture(payload);
    if (active.generation !== operationGeneration) {
      return;
    }
    snapshot = response.snapshot;
    summaryDraft = "";
    if (finalized.liveCaptionError === null) {
      setStatus("Whisper final transcript is ready for review.", "success");
    } else {
      setStatus(
        "Whisper final succeeded; live captions failed. See Developer Trace for a bounded diagnostic.",
        "warning",
      );
    }
  } catch (error) {
    if (active.generation !== operationGeneration) {
      return;
    }
    snapshot = await api.getBootstrap().catch(() => snapshot);
    setStatus(errorMessage(error), "error");
  } finally {
    if (active.generation === operationGeneration) {
      recording = null;
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
    }
  }
}

async function importWav(): Promise<void> {
  if (!prepared || busy || recording !== null) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
  setRecorderOperation({ kind: "import", stage: "selecting_file" });
  updateControls();
  setStatus("Waiting for a bounded local WAV selection…", "working");
  try {
    const response = await api.importWav();
    if (generation !== operationGeneration) {
      return;
    }
    if (response === null) {
      setStatus("WAV import cancelled.", "neutral");
      return;
    }
    snapshot = response.snapshot;
    summaryDraft = "";
    setStatus("The selected WAV produced a Whisper final transcript.", "success");
  } catch (error) {
    if (generation !== operationGeneration) {
      return;
    }
    setStatus(errorMessage(error), "error");
  } finally {
    if (generation === operationGeneration) {
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
    }
  }
}

async function saveTranscript(): Promise<void> {
  if (busy || !snapshot.transcript.finalText) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
  setRecorderOperation({ kind: "saving_transcript" });
  updateControls();
  try {
    snapshot = await api.editTranscript({ text: elements.finalTranscript.value });
    if (generation !== operationGeneration) {
      return;
    }
    summaryDraft = "";
    setStatus(`Transcript correction saved as version ${snapshot.transcript.version}.`, "success");
  } catch (error) {
    if (generation !== operationGeneration) {
      return;
    }
    setStatus(errorMessage(error), "error");
  } finally {
    if (generation === operationGeneration) {
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
    }
  }
}

async function generateSummary(): Promise<void> {
  if (busy || !snapshot.transcript.finalText) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
  setRecorderOperation(
    transcriptEditorDirty ? { kind: "summary_saving_transcript" } : { kind: "summary_generating" },
  );
  updateControls();
  setStatus(
    transcriptEditorDirty
      ? "Saving the transcript correction before summary generation…"
      : "Submitting the exact final transcript to the local summary model…",
    "working",
  );
  try {
    if (transcriptEditorDirty) {
      snapshot = await api.editTranscript({ text: elements.finalTranscript.value });
      if (generation !== operationGeneration) {
        return;
      }
      setRecorderOperation({ kind: "summary_generating" });
      setStatus("Generating a local summary from the saved transcript version…", "working");
    }
    const response = await api.generateSummary();
    if (generation !== operationGeneration) {
      return;
    }
    snapshot = response.snapshot;
    summaryDraft = snapshot.transcript.summary?.text ?? "";
    setStatus("Local AI summary is ready and editable.", "success");
  } catch (error) {
    if (generation !== operationGeneration) {
      return;
    }
    setStatus(errorMessage(error), "error");
  } finally {
    if (generation === operationGeneration) {
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
    }
  }
}

async function setAssistantMode(): Promise<void> {
  const sessionId = assistantSessionId;
  if (sessionId === null || assistantSnapshot === null || assistantUiPending) {
    renderAssistant();
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "switching_mode";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Switching mode and cancelling incompatible assistant work…", "working");
  try {
    assistantSnapshot = await api.setAssistantMode({
      sessionId,
      mode: elements.assistantMode.value === "clinic" ? "clinic" : "classroom",
    });
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function askAssistant(): Promise<void> {
  const sessionId = assistantSessionId;
  const question = elements.assistantInput.value.trim();
  if (sessionId === null || assistantSnapshot === null || !question || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "queuing_chat";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Queuing the local assistant request…", "working");
  try {
    const started = await api.askAssistant({ sessionId, question });
    assistantSnapshot = started.snapshot;
    elements.assistantInput.value = "";
    setAssistantStatus("Question queued for local inference. Recording continues.", "working");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function cancelAssistant(): Promise<void> {
  const sessionId = assistantSessionId;
  const requestId = assistantSnapshot?.activeRequestId;
  if (sessionId === null || requestId === null || requestId === undefined || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "cancelling";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Cancelling the active optional request…", "working");
  try {
    assistantSnapshot = await api.cancelAssistant({ sessionId, requestId });
    setAssistantStatus("Cancelling the active optional request.", "working");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function clearAssistantChat(): Promise<void> {
  const sessionId = assistantSessionId;
  if (sessionId === null || assistantSnapshot === null || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "clearing";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Clearing memory-only assistant chat…", "working");
  try {
    assistantSnapshot = await api.clearAssistantChat({ sessionId });
    setAssistantStatus("Memory-only chat history cleared.", "success");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function selectAssistantImage(): Promise<void> {
  const sessionId = assistantSessionId;
  if (sessionId === null || assistantSnapshot === null || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "selecting_image";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Opening the main-process image picker…", "working");
  try {
    const selected = await api.selectAssistantImage({ sessionId });
    if (selected === null) {
      setAssistantStatus("Image selection cancelled.", "neutral");
      return;
    }
    assistantSnapshot = selected;
    setAssistantStatus("Image selected safely. Analyze it when ready.", "success");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function analyzeAssistantImage(): Promise<void> {
  const sessionId = assistantSessionId;
  if (sessionId === null || assistantSnapshot?.image === null || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "queuing_analysis";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Queuing local image analysis…", "working");
  try {
    const started = await api.analyzeAssistantImage({ sessionId });
    assistantSnapshot = started.snapshot;
    setAssistantStatus("Image analysis queued. Audio capture remains independent.", "working");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function removeAssistantImage(): Promise<void> {
  const sessionId = assistantSessionId;
  if (sessionId === null || assistantSnapshot?.image === null || assistantUiPending) {
    return;
  }
  assistantUiPending = true;
  assistantUiAction = "removing_image";
  updateControls();
  renderAssistantControlProgress();
  setAssistantStatus("Removing image bytes and derived analysis…", "working");
  try {
    assistantSnapshot = await api.removeAssistantImage({ sessionId });
    setAssistantStatus("Image bytes, thumbnail, and analysis were removed.", "success");
  } catch (error) {
    setAssistantStatus(errorMessage(error), "error");
  } finally {
    assistantUiPending = false;
    assistantUiAction = "idle";
    renderAssistant();
  }
}

async function resetRecorder(): Promise<void> {
  if (recorderOperation.kind === "resetting") {
    return;
  }
  busy = true;
  setRecorderOperation({ kind: "resetting" });
  operationGeneration += 1;
  const generation = operationGeneration;
  elements.assistantInput.value = "";
  const active = recording;
  recording = null;
  if (active !== null) {
    active.stopping = true;
    window.clearInterval(active.timerId);
    window.clearTimeout(active.limitId);
  }
  updateControls();
  setStatus(
    active === null ? "Deleting recorder state…" : "Cancelling recording and deleting recorder state…",
    "working",
  );
  let cancellationError: SafeDiagnostic | null = null;
  try {
    const reset = await cancelRecordingAndReset(
      active === null
        ? null
        : {
            capture: active.capture,
            mediaStream: active.mediaStream,
            pcm: active.pcm,
            pump: active.pump,
            streamId: active.streamId,
            releaseStream: releaseMediaStream,
          },
      {
        cancelLiveStream: async (streamId) => api.cancelLiveStream({ streamId }),
        reset: () => api.reset(),
      },
    );
    cancellationError = reset.cancellationError;
    if (reset.liveCaptionCleanup !== null) {
      void reset.liveCaptionCleanup.then(() => undefined);
    }
    snapshot = reset.result;
    if (generation !== operationGeneration) {
      return;
    }
    summaryDraft = "";
    elements.consent.checked = false;
    setStatus(
      cancellationError === null
        ? active === null
          ? "Temporary audio and derived in-memory state were deleted."
          : "Recording was cancelled; captured audio was discarded without transcription or summary."
        : `Recording was cancelled and reset completed with a cleanup warning: ${formatSafeDiagnostic(
            cancellationError,
          )}`,
      cancellationError === null ? "success" : "warning",
    );
  } catch (error) {
    if (generation !== operationGeneration) {
      return;
    }
    setStatus(errorMessage(error), "error");
  } finally {
    active?.liveCaptionFailure.clear();
    if (generation === operationGeneration) {
      busy = false;
      setRecorderOperation({ kind: "idle" });
      render(snapshot);
    }
  }
}

async function failActiveRecording(error: unknown): Promise<void> {
  const active = recording;
  if (active === null) {
    return;
  }
  operationGeneration += 1;
  recording = null;
  window.clearInterval(active.timerId);
  window.clearTimeout(active.limitId);
  active.pump?.cancel();
  active.liveCaptionFailure.clear();
  active.pcm.clear();
  releaseMediaStream(active.mediaStream);
  await active.capture.stop().catch(() => undefined);
  if (active.streamId !== null) {
    void api.cancelLiveStream({ streamId: active.streamId }).catch(() => undefined);
  }
  busy = false;
  setRecorderOperation({ kind: "idle" });
  setStatus(errorMessage(error), "error");
  updateControls();
}

function render(next: RecorderSnapshot): void {
  snapshot = next;
  renderReadiness(snapshot);

  const transcript = snapshot.transcript;
  if (recording === null) {
    elements.liveDraft.textContent =
      transcript.liveDraft || "Live hypotheses will replace each other here. They are never summary input.";
    elements.liveDraft.classList.toggle("empty", !transcript.liveDraft);
  }

  elements.finalTranscript.disabled = !transcript.finalText || busy;
  elements.finalTranscript.value = transcript.finalText;
  transcriptEditorDirty = false;
  elements.transcriptVersion.textContent = `Version ${transcript.version}`;
  elements.whisperTiming.textContent = `Stop → final ${formatMilliseconds(
    snapshot.timing.stopToWhisperFinalMs,
  )}`;
  elements.firstCaption.textContent = `First caption ${formatMilliseconds(snapshot.timing.firstCaptionMs)}`;

  if (transcript.summary !== null && !summaryDraft) {
    summaryDraft = transcript.summary.text;
  }
  elements.summaryOutput.disabled = transcript.summary === null || busy;
  elements.summaryOutput.value = summaryDraft;
  elements.summaryTiming.textContent = `Transcript final → summary ${formatMilliseconds(
    snapshot.timing.transcriptFinalToSummaryMs,
  )}`;
  elements.summaryVersion.textContent =
    transcript.summary === null
      ? "No submitted version"
      : `Built from transcript v${transcript.summary.transcriptVersion} · ${transcript.summary.durationMs} ms generation`;

  renderTrace(snapshot.trace, assistantSnapshot?.trace ?? []);
  updateControls();
}

function renderReadiness(next: RecorderSnapshot): void {
  renderModel("whisper", next.readiness.whisper);
  renderModel("nemotron", next.readiness.nemotron);
  renderModel("summary", next.readiness.summary);
  renderPrivacyBoundary(next);
}

function renderAssistant(): void {
  const state = assistantSnapshot;
  const imageProgress = imageAnalysisProgress(state);
  renderImageAnalyzeButton(elements.imageAnalyze, imageProgress);
  renderAssistantControlProgress();
  elements.assistantPanel.setAttribute(
    "aria-busy",
    String(
      assistantUiPending || (state?.pendingOperations.length ?? 0) > 0 || state?.cleanupPending === true,
    ),
  );
  elements.imageAnalysis.setAttribute("aria-busy", String(imageProgress !== null));
  if (state === null) {
    elements.assistantHistory.replaceChildren(
      textElement(
        "p",
        "assistant-empty",
        "The optional assistant is unavailable. Recording, Whisper, and summary remain usable.",
      ),
    );
    elements.imagePreview.replaceChildren(textElement("span", "", "No lesson image selected."));
    elements.imagePreview.classList.add("empty");
    elements.imageMetadata.replaceChildren();
    elements.imageAnalysis.replaceChildren(
      textElement("p", "assistant-empty", "No image analysis is available."),
    );
    renderAssistantStatus();
    renderTrace(snapshot.trace, []);
    updateControls();
    return;
  }

  elements.assistantMode.value = state.mode;
  elements.assistantSafety.textContent =
    state.mode === "clinic"
      ? "Educational and clinician-led only: no diagnosis, urgency, treatment, or interpreter replacement."
      : "Classroom explanations use local context and state uncertainty.";
  elements.assistantHistory.setAttribute(
    "aria-busy",
    String(state.pendingOperations.some(({ kind }) => kind === "chat")),
  );
  if (state.chatMessages.length === 0) {
    elements.assistantHistory.replaceChildren(
      textElement(
        "p",
        "assistant-empty",
        "Ask while recording continues. Live draft context is snapshotted only for that request.",
      ),
    );
  } else {
    elements.assistantHistory.replaceChildren(...renderAssistantChatRows(state));
    elements.assistantHistory.scrollTop = elements.assistantHistory.scrollHeight;
  }

  const image = state.image;
  if (image === null) {
    elements.imagePreview.replaceChildren(textElement("span", "", "No lesson image selected."));
    elements.imagePreview.classList.add("empty");
    elements.imageMetadata.replaceChildren();
  } else {
    const preview = document.createElement("img");
    preview.src = image.thumbnailDataUrl;
    preview.alt = `Preview of ${image.basename}`;
    elements.imagePreview.replaceChildren(preview);
    elements.imagePreview.classList.remove("empty");
    elements.imageMetadata.replaceChildren(
      metadataTerm("File"),
      metadataValue(image.basename),
      metadataTerm("Type"),
      metadataValue(image.mimeType),
      metadataTerm("Size"),
      metadataValue(`${(image.sizeBytes / 1024).toFixed(1)} KiB`),
      metadataTerm("Dimensions"),
      metadataValue(`${image.width} × ${image.height}`),
      metadataTerm("Analysis"),
      imageAnalysisMetadataValue(imageProgress, image.analysisStatus === "ready" ? "Ready" : "Unanalyzed"),
    );
  }

  const analysis = state.imageAnalysis;
  if (analysis === null && imageProgress !== null) {
    elements.imageAnalysis.replaceChildren(imageAnalysisProgressMessage(imageProgress));
  } else if (analysis === null) {
    elements.imageAnalysis.replaceChildren(
      textElement(
        "p",
        "assistant-empty",
        "Analysis will show visible text/objects, lesson relation, and uncertainty.",
      ),
    );
  } else {
    elements.imageAnalysis.replaceChildren(
      analysisLine("Visible text/objects", analysis.visibleTextAndObjects),
      analysisLine("Relation to lesson", analysis.relationToLesson),
      analysisLine("Uncertainty", analysis.uncertainty),
      textElement(
        "small",
        "assistant-context-labels",
        `Image analysis v${analysis.version} · ${analysis.contextLabels
          .map((label) => label.label)
          .join(" · ")}`,
      ),
    );
  }

  if (!prepared && !state.cleanupPending && state.activeOperation === null) {
    assistantStatusMessage = "Prepare local models to enable local chat and image analysis.";
    assistantStatusTone = "neutral";
  } else if (state.cleanupPending) {
    assistantStatusMessage =
      state.cleanupDetail ?? "Optional assistant cleanup is draining; the core recorder remains available.";
    assistantStatusTone = "warning";
  } else if (state.pendingOperations.length > 0) {
    assistantStatusMessage = `${assistantOperationStatusMessage(state) ?? "Optional assistant work is running."} Audio capture continues independently.`;
    assistantStatusTone = "working";
  } else {
    const latest = state.trace.at(-1);
    if (latest?.severity === "error") {
      assistantStatusMessage = latest.detail;
      assistantStatusTone = "error";
    } else if (latest?.phase === "chat-raw") {
      assistantStatusMessage = "Local chat answer is ready.";
      assistantStatusTone = "success";
    } else if (latest?.phase === "image-analysis-raw" && analysis !== null) {
      assistantStatusMessage = `Image analysis v${analysis.version} is ready.`;
      assistantStatusTone = "success";
    } else if (assistantStatusMessage.startsWith("Prepare local models")) {
      assistantStatusMessage = "Optional assistant lane is ready.";
      assistantStatusTone = "neutral";
    }
  }
  if (state.queuedRequests > 0) {
    assistantStatusMessage += ` ${state.queuedRequests} request${
      state.queuedRequests === 1 ? "" : "s"
    } waiting.`;
  }
  renderAssistantStatus();
  renderTrace(snapshot.trace, state.trace);
  updateControls();
}

function renderModel(role: "whisper" | "nemotron" | "summary", readiness: ModelReadiness): void {
  elements.model[role].id.textContent = `${readiness.target.modelId} · ${readiness.target.executionProvider}`;
  elements.model[role].detail.textContent = readiness.detail;
  elements.model[role].detail.title = readiness.detail;
  elements.model[role].state.textContent = stateLabel(readiness.status);
  elements.model[role].state.className = `state-chip state-${readiness.status}`;
  elements.model[role].state.setAttribute("role", "status");
  elements.model[role].card.setAttribute(
    "aria-busy",
    String(
      readiness.status === "checking" ||
        readiness.status === "downloading" ||
        readiness.status === "registering_provider" ||
        readiness.status === "loading",
    ),
  );
}

function renderTrace(trace: readonly TraceEntry[], assistantTrace: readonly AssistantTraceEntry[]): void {
  const combined: TraceEntry[] = [
    ...trace,
    ...assistantTrace.map((entry) => ({
      at: entry.at,
      responsibility: "Foundry Local" as const,
      phase: `assistant:${entry.phase}`,
      detail: entry.detail,
      severity: entry.severity,
    })),
  ];
  elements.traceContent.replaceChildren(
    ...combined
      .slice()
      .sort((left, right) => left.at.localeCompare(right.at))
      .reverse()
      .map((entry) => {
        const row = document.createElement("div");
        row.className = `trace-row trace-${entry.severity}`;
        const responsibility = document.createElement("strong");
        responsibility.textContent = entry.responsibility;
        const phase = document.createElement("span");
        phase.textContent = entry.phase;
        const detail = document.createElement("div");
        detail.className = "trace-detail";
        const detailText = document.createElement("p");
        detailText.textContent = entry.detail;
        detail.append(detailText);
        if (entry.summaryDisplayFormattingApplied !== undefined) {
          const formatting = document.createElement("span");
          formatting.className = "trace-formatting";
          formatting.textContent = entry.summaryDisplayFormattingApplied
            ? "Summary display formatting applied"
            : "Summary display formatting not needed";
          detail.append(formatting);
        }
        const timing = document.createElement("time");
        timing.textContent = `${new Date(entry.at).toLocaleTimeString()}${
          entry.durationMs === undefined ? "" : ` · ${entry.durationMs} ms`
        }`;
        row.append(responsibility, phase, detail, timing);
        return row;
      }),
  );
}

function renderAssistantStatus(): void {
  elements.assistantStatus.textContent = assistantStatusMessage;
  elements.assistantStatus.className = `assistant-status assistant-status-${assistantStatusTone}`;
}

function renderAssistantControlProgress(): void {
  applyAssistantControlProgress(
    {
      mode: elements.assistantMode,
      ask: elements.assistantAsk,
      cancel: elements.assistantCancel,
      clear: elements.assistantClear,
      imageSelect: elements.imageSelect,
      imageAnalyze: elements.imageAnalyze,
      imageRemove: elements.imageRemove,
    },
    assistantUiAction,
  );
}

function setAssistantStatus(
  message: string,
  tone: "neutral" | "working" | "success" | "warning" | "error",
): void {
  assistantStatusMessage = message;
  assistantStatusTone = tone;
  renderAssistantStatus();
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}

function metadataTerm(text: string): HTMLElement {
  return textElement("dt", "", text);
}

function metadataValue(text: string): HTMLElement {
  return textElement("dd", "", text);
}

function analysisLine(label: string, value: string): HTMLElement {
  const line = document.createElement("p");
  line.className = "image-analysis-line";
  const strong = textElement("strong", "", `${label}: `);
  line.append(strong, document.createTextNode(value));
  return line;
}

function updateControls(): void {
  const hasFinal = Boolean(snapshot.transcript.finalText);
  const transcriptChanged = hasFinal && transcriptEditorDirty;
  elements.prepare.disabled = busy || recording !== null;
  elements.start.disabled = !prepared || busy || recording !== null || !elements.consent.checked;
  elements.stop.disabled = recording === null || busy;
  elements.import.disabled = !prepared || busy || recording !== null;
  elements.liveToggle.disabled = busy || recording !== null;
  elements.saveTranscript.disabled = busy || !transcriptChanged;
  elements.summary.disabled = busy || !hasFinal;
  const assistantReady = assistantSessionId !== null && assistantSnapshot !== null;
  const assistantCleanupPending = assistantSnapshot?.cleanupPending === true;
  const assistantQueueFull =
    assistantSnapshot !== null && assistantSnapshot.queuedRequests >= assistantSnapshot.maxQueuedRequests;
  const imageProgress = imageAnalysisProgress(assistantSnapshot);
  elements.assistantMode.disabled = !assistantReady || assistantCleanupPending || assistantUiPending;
  elements.assistantAsk.disabled =
    !assistantReady ||
    !prepared ||
    assistantCleanupPending ||
    assistantUiPending ||
    assistantQueueFull ||
    !elements.assistantInput.value.trim();
  elements.assistantCancel.disabled =
    !assistantReady ||
    assistantCleanupPending ||
    assistantUiPending ||
    assistantSnapshot?.activeRequestId === null;
  elements.assistantClear.disabled =
    !assistantReady ||
    assistantCleanupPending ||
    assistantUiPending ||
    (assistantSnapshot?.chatMessages.length ?? 0) === 0;
  elements.imageSelect.disabled = !assistantReady || assistantCleanupPending || assistantUiPending;
  elements.imageAnalyze.disabled =
    !assistantReady ||
    !prepared ||
    assistantCleanupPending ||
    assistantUiPending ||
    assistantQueueFull ||
    imageProgress !== null ||
    assistantSnapshot?.image === null;
  elements.imageRemove.disabled =
    !assistantReady || assistantCleanupPending || assistantUiPending || assistantSnapshot?.image === null;
  elements.reset.disabled = recorderOperation.kind === "resetting";
  renderRecorderProgress();
  elements.recordingIndicator.classList.toggle("active", recording !== null);
}

function setRecorderOperation(operation: RecorderOperationState): void {
  recorderOperation = operation;
  renderRecorderProgress();
}

function renderRecorderProgress(): void {
  applyRecorderProgress(
    {
      prepare: elements.prepare,
      start: elements.start,
      startLabel: elements.startLabel,
      stop: elements.stop,
      importButton: elements.import,
      saveTranscript: elements.saveTranscript,
      summary: elements.summary,
      reset: elements.reset,
      recordingIndicator: elements.recordingIndicator,
      modelRail: elements.modelRail,
      liveDraft: elements.liveDraft,
      liveCard: elements.liveCard,
      finalTranscript: elements.finalTranscript,
      finalCard: elements.finalCard,
      summaryOutput: elements.summaryOutput,
      summaryCard: elements.summaryCard,
    },
    recorderOperation,
    recording !== null,
  );
}

function selectAssistantTab(tab: "chat" | "image"): void {
  const chatSelected = tab === "chat";
  elements.assistantChatTab.classList.toggle("active", chatSelected);
  elements.assistantChatTab.setAttribute("aria-selected", String(chatSelected));
  elements.assistantChatTab.tabIndex = chatSelected ? 0 : -1;
  elements.assistantImageTab.classList.toggle("active", !chatSelected);
  elements.assistantImageTab.setAttribute("aria-selected", String(!chatSelected));
  elements.assistantImageTab.tabIndex = chatSelected ? -1 : 0;
  elements.assistantChatPanel.hidden = !chatSelected;
  elements.assistantImagePanel.hidden = chatSelected;
}

function updateElapsed(): void {
  if (recording === null) {
    return;
  }
  const elapsed = Math.min(AUDIO_MAX_DURATION_MS, performance.now() - recording.startedAt);
  elements.elapsed.textContent = formatElapsed(elapsed);
  elements.clock.textContent = formatElapsed(elapsed).slice(0, 5);
}

function setStatus(
  message: string,
  tone: "neutral" | "working" | "recording" | "success" | "warning" | "error",
): void {
  elements.status.textContent = message || progressDetail;
  elements.status.className = `status-message status-${tone}`;
  elements.status.setAttribute("aria-busy", String(tone === "working"));
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing renderer element ${selector}.`);
  }
  return element;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatMilliseconds(milliseconds: number | null): string {
  return milliseconds === null ? "—" : `${(milliseconds / 1000).toFixed(2)} s`;
}

function stateLabel(status: ModelReadiness["status"]): string {
  return status.replaceAll("_", " ").toUpperCase();
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Use the WAV fallback or allow microphone access and retry.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one or use the WAV fallback.";
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return formatSafeDiagnostic(toSafeDiagnostic(error, "LOCAL_OPERATION_FAILED"));
}

function liveCaptionDiagnostic(error: unknown): string {
  return formatSafeDiagnostic(toSafeDiagnostic(error, "OPTIONAL_LIVE_FAILED"));
}

function renderPrivacyBoundary(next: RecorderSnapshot): void {
  const readiness = next.readiness;
  elements.privacyState.textContent = readiness.cleanup.required
    ? readiness.cleanup.state === "draining"
      ? "Native cleanup draining"
      : "Cleanup required"
    : readiness.inProcessModeValidated
      ? "In-process boundary validated"
      : readiness.embeddedWebServiceRunning || readiness.embeddedWebServiceUrls.length > 0
        ? "Endpoint guard failed"
        : "Endpoint guard pending";
}

function startupRecoveryWarning(next: RecorderSnapshot): string | null {
  const recovery = next.readiness.audioRecovery;
  if (recovery.retained === 0) {
    return null;
  }
  const noun = recovery.retained === 1 ? "file was" : "files were";
  return `${recovery.retained} locked temporary audio ${noun} retained in the app-owned temp directory. ${recovery.retryGuidance}`;
}
