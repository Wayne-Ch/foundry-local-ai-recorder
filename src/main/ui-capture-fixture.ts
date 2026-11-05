import type { ModelReadiness, RecorderSnapshot } from "../shared/contracts";

export const POPULATED_SUMMARY_CAPTURE_RAW =
  "The lesson defines an ordinary differential equation as relating a function to its derivatives. It derives $ y' = -2y $. It separates the variables. It uses $ e^{-2t}} $ for exponential decay. The initial condition determines c.";

export const POPULATED_SUMMARY_CAPTURE_FORMATTED =
  "The lesson defines an ordinary differential equation as relating a function to its derivatives.\n• It derives y′ = −2y.\n• It separates the variables.\n• It uses e^(−2t) for exponential decay.\n• The initial condition determines c.";

export function createPopulatedSummaryCaptureSnapshot(base: RecorderSnapshot): RecorderSnapshot {
  return {
    ...base,
    readiness: {
      ...base.readiness,
      externalEndpointUsed: false,
      inProcessModeValidated: true,
      embeddedWebServiceRunning: false,
      embeddedWebServiceUrls: [],
      cleanup: {
        state: "none",
        required: false,
        completionPending: false,
        detail: "No cleanup is pending.",
      },
      whisper: readyForCapture(base.readiness.whisper),
      nemotron: readyForCapture(base.readiness.nemotron),
      summary: readyForCapture(base.readiness.summary),
    },
    transcript: {
      liveDraft: "",
      liveSequence: -1,
      liveStreamId: null,
      finalText:
        "An ordinary differential equation relates a function to its derivatives. The lesson derives y' = -2y, separates the variables, uses e^{-2t} for exponential decay, and determines c from the initial condition.",
      version: 1,
      submittedVersion: 1,
      summary: {
        text: POPULATED_SUMMARY_CAPTURE_FORMATTED,
        transcriptVersion: 1,
        generatedAt: "2026-10-30T20:00:00.000Z",
        modelId: base.readiness.summary.target.modelId,
        durationMs: 742,
        promptTokens: 71,
        completionTokens: 28,
      },
    },
    trace: [
      {
        at: "2026-10-30T20:00:00.000Z",
        responsibility: "Foundry Local",
        phase: "summary-raw",
        detail: POPULATED_SUMMARY_CAPTURE_RAW,
        severity: "info",
        summaryDisplayFormattingApplied: true,
      },
    ],
    timing: {
      firstCaptionMs: 318,
      stopToWhisperFinalMs: 1_184,
      transcriptFinalToSummaryMs: 742,
    },
  };
}

function readyForCapture(readiness: ModelReadiness): ModelReadiness {
  return {
    ...readiness,
    status: "ready",
    detail: "Deterministic populated-summary capture fixture.",
    cached: true,
    loaded: true,
  };
}
