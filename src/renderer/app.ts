import "../renderer/styles.css";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
} from "../audio/audio-types";
import type { ModelReadiness, RecorderSnapshot, TraceEntry } from "../shared/contracts";
import { formatSafeDiagnostic, type SafeDiagnostic, toSafeDiagnostic } from "../shared/safe-diagnostic";
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

    <section class="model-rail" aria-label="Local model readiness">
      <article class="model-card" data-model="nemotron">
        <span class="step-number">01</span>
        <div><p>Live draft</p><strong>Nemotron</strong><small id="nemotron-id"></small></div>
        <span id="nemotron-state" class="state-chip"></span>
      </article>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <article class="model-card model-card-primary" data-model="whisper">
        <span class="step-number">02</span>
        <div><p>Authoritative final</p><strong>Whisper</strong><small id="whisper-id"></small></div>
        <span id="whisper-state" class="state-chip"></span>
      </article>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <article class="model-card" data-model="summary">
        <span class="step-number">03</span>
        <div><p>Post-session</p><strong>Local summary</strong><small id="summary-id"></small></div>
        <span id="summary-state" class="state-chip"></span>
      </article>
    </section>

    <section class="workspace">
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
            <span>Start</span>
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
          <article class="output-card live-card">
            <div class="output-heading">
              <div>
                <p class="eyebrow">DISPLAY ONLY</p>
                <h2>Live draft <span>Nemotron</span></h2>
              </div>
              <span id="first-caption" class="metric-chip">First caption —</span>
            </div>
            <div id="live-draft" class="live-draft empty">
              Live hypotheses will replace each other here. They are never summary input.
            </div>
          </article>

          <article class="output-card final-card">
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

        <article class="output-card summary-card">
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
  clock: required("#clock"),
  privacyState: required("#privacy-state"),
  consent: required<HTMLInputElement>("#consent"),
  liveToggle: required<HTMLInputElement>("#live-toggle"),
  prepare: required<HTMLButtonElement>("#prepare-button"),
  start: required<HTMLButtonElement>("#start-button"),
  stop: required<HTMLButtonElement>("#stop-button"),
  import: required<HTMLButtonElement>("#import-button"),
  elapsed: required("#elapsed"),
  status: required("#status-message"),
  recordingIndicator: required("#recording-indicator"),
  liveDraft: required("#live-draft"),
  firstCaption: required("#first-caption"),
  finalTranscript: required<HTMLTextAreaElement>("#final-transcript"),
  transcriptVersion: required("#transcript-version"),
  whisperTiming: required("#whisper-timing"),
  saveTranscript: required<HTMLButtonElement>("#save-transcript"),
  summary: required<HTMLButtonElement>("#summary-button"),
  summaryOutput: required<HTMLTextAreaElement>("#summary-output"),
  summaryTiming: required("#summary-timing"),
  summaryVersion: required("#summary-version"),
  reset: required<HTMLButtonElement>("#reset-button"),
  traceToggle: required<HTMLButtonElement>("#trace-toggle"),
  traceContent: required("#trace-content"),
  model: {
    whisper: {
      id: required("#whisper-id"),
      state: required("#whisper-state"),
    },
    nemotron: {
      id: required("#nemotron-id"),
      state: required("#nemotron-state"),
    },
    summary: {
      id: required("#summary-id"),
      state: required("#summary-state"),
    },
  },
};

const populatedSummaryCapture =
  new URLSearchParams(window.location.search).get("capture") === "populated-summary";
let snapshot: RecorderSnapshot = await api.getBootstrap();
let recording: RecordingOperation | null = null;
let operationGeneration = 0;
let prepared = populatedSummaryCapture;
let liveAvailable = populatedSummaryCapture;
let busy = false;
let resetting = false;
let summaryDraft = "";
let progressDetail = "";
let transcriptEditorDirty = false;

render(snapshot);
if (populatedSummaryCapture) {
  elements.traceToggle.setAttribute("aria-expanded", "true");
  elements.traceToggle.textContent = "Hide trace";
  elements.traceContent.hidden = false;
  setStatus("Deterministic populated summary capture.", "success");
  requestAnimationFrame(() => window.scrollTo(0, 170));
}

api.onProgress((event) => {
  progressDetail = event.detail;
  setStatus(event.detail, "working");
});
api.onAudioPartial((event) => {
  if (recording?.streamId !== event.streamId) {
    return;
  }
  elements.liveDraft.textContent = event.text;
  elements.liveDraft.classList.remove("empty");
  elements.firstCaption.textContent = `First caption ${formatMilliseconds(event.firstPartialMs)}`;
});

elements.prepare.addEventListener("click", () => void prepareModels());
elements.start.addEventListener("click", () => void startRecording());
elements.stop.addEventListener("click", () => void stopRecording());
elements.import.addEventListener("click", () => void importWav());
elements.saveTranscript.addEventListener("click", () => void saveTranscript());
elements.summary.addEventListener("click", () => void generateSummary());
elements.reset.addEventListener("click", () => void resetRecorder());
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
  updateControls();
  setStatus("Preparing Whisper and Qwen locally…", "working");
  try {
    const response = await api.prepare({ enableLiveCaptions: elements.liveToggle.checked });
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
    snapshot = await api.getBootstrap().catch(() => snapshot);
    prepared = false;
    liveAvailable = false;
    const recoveryWarning = startupRecoveryWarning(snapshot);
    setStatus(
      recoveryWarning === null ? errorMessage(error) : `${errorMessage(error)} ${recoveryWarning}`,
      "error",
    );
  } finally {
    busy = false;
    render(snapshot);
  }
}

async function startRecording(): Promise<void> {
  if (!prepared || busy || recording !== null || !elements.consent.checked) {
    return;
  }
  busy = true;
  operationGeneration += 1;
  const generation = operationGeneration;
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
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    if (elements.liveToggle.checked && liveAvailable) {
      try {
        const stream = await api.startLiveStream({
          format: AUDIO_FORMAT,
          sampleRate: AUDIO_SAMPLE_RATE,
          channels: AUDIO_CHANNELS,
          maxDurationMs: AUDIO_MAX_DURATION_MS,
        });
        streamId = stream.streamId;
        pump = new BoundedAudioChunkPump(
          (sequence, data) => api.appendLiveChunk({ streamId: stream.streamId, sequence, data }),
          (error) => {
            liveCaptionFailure.record(error);
            pump?.cancel();
            pump = null;
            if (recording?.generation === generation) {
              recording.pump = null;
            }
            setStatus(
              `Live captions stopped: ${liveCaptionDiagnostic(error)}. Whisper still records.`,
              "warning",
            );
          },
        );
      } catch (error) {
        liveAvailable = false;
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
    setStatus(microphoneError(error), "error");
  } finally {
    busy = false;
    updateControls();
  }
}

async function stopRecording(reason: "manual" | "limit" = "manual"): Promise<void> {
  const active = recording;
  if (active === null || !beginRecordingStop(active)) {
    return;
  }
  busy = true;
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
    const response = await api.transcribeCapture(payload);
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
    snapshot = await api.getBootstrap().catch(() => snapshot);
    setStatus(errorMessage(error), "error");
  } finally {
    recording = null;
    busy = false;
    render(snapshot);
  }
}

async function importWav(): Promise<void> {
  if (!prepared || busy || recording !== null) {
    return;
  }
  busy = true;
  updateControls();
  setStatus("Opening a local WAV through the Whisper pipeline…", "working");
  try {
    const response = await api.importWav();
    if (response === null) {
      setStatus("WAV import cancelled.", "neutral");
      return;
    }
    snapshot = response.snapshot;
    summaryDraft = "";
    setStatus("The selected WAV produced a Whisper final transcript.", "success");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    busy = false;
    render(snapshot);
  }
}

async function saveTranscript(): Promise<void> {
  if (busy || !snapshot.transcript.finalText) {
    return;
  }
  busy = true;
  updateControls();
  try {
    snapshot = await api.editTranscript({ text: elements.finalTranscript.value });
    summaryDraft = "";
    setStatus(`Transcript correction saved as version ${snapshot.transcript.version}.`, "success");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    busy = false;
    render(snapshot);
  }
}

async function generateSummary(): Promise<void> {
  if (busy || !snapshot.transcript.finalText) {
    return;
  }
  busy = true;
  updateControls();
  setStatus("Submitting the exact final transcript to the local summary model…", "working");
  try {
    if (transcriptEditorDirty) {
      snapshot = await api.editTranscript({ text: elements.finalTranscript.value });
    }
    const response = await api.generateSummary();
    snapshot = response.snapshot;
    summaryDraft = snapshot.transcript.summary?.text ?? "";
    setStatus("Local AI summary is ready and editable.", "success");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    busy = false;
    render(snapshot);
  }
}

async function resetRecorder(): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  resetting = true;
  operationGeneration += 1;
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
    setStatus(errorMessage(error), "error");
  } finally {
    active?.liveCaptionFailure.clear();
    resetting = false;
    busy = false;
    render(snapshot);
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
  setStatus(errorMessage(error), "error");
  updateControls();
}

function render(next: RecorderSnapshot): void {
  snapshot = next;
  renderModel("whisper", snapshot.readiness.whisper);
  renderModel("nemotron", snapshot.readiness.nemotron);
  renderModel("summary", snapshot.readiness.summary);
  renderPrivacyBoundary(snapshot);

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

  renderTrace(snapshot.trace);
  updateControls();
}

function renderModel(role: "whisper" | "nemotron" | "summary", readiness: ModelReadiness): void {
  elements.model[role].id.textContent = `${readiness.target.modelId} · ${readiness.target.executionProvider}`;
  elements.model[role].state.textContent = stateLabel(readiness.status);
  elements.model[role].state.className = `state-chip state-${readiness.status}`;
}

function renderTrace(trace: readonly TraceEntry[]): void {
  elements.traceContent.replaceChildren(
    ...trace
      .slice()
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
  elements.reset.disabled = busy;
  elements.reset.textContent = resetting
    ? "Cancelling / resetting…"
    : recording === null
      ? "Delete / reset"
      : "Cancel / reset";
  elements.recordingIndicator.textContent = resetting
    ? "Cancelling"
    : recording === null
      ? busy
        ? "Working"
        : "Idle"
      : recording.stopping
        ? "Finalizing"
        : "Recording";
  elements.recordingIndicator.classList.toggle("active", recording !== null);
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
