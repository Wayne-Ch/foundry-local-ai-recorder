import type { ImportProgressStage, PrepareProgressStage } from "../shared/contracts";

export type RecorderOperationState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "prepare";
      readonly stage: PrepareProgressStage;
      readonly role?: "whisper" | "nemotron" | "summary";
    }
  | { readonly kind: "requesting_microphone" }
  | { readonly kind: "starting_live_captions" }
  | { readonly kind: "recording_waiting_caption" }
  | { readonly kind: "recording" }
  | { readonly kind: "finalizing_capture" }
  | { readonly kind: "transcribing" }
  | { readonly kind: "import"; readonly stage: ImportProgressStage }
  | { readonly kind: "saving_transcript" }
  | { readonly kind: "summary_saving_transcript" }
  | { readonly kind: "summary_generating" }
  | { readonly kind: "resetting" };

export interface RecorderProgressPresentation {
  readonly prepareLabel: string;
  readonly startLabel: string;
  readonly stopLabel: string;
  readonly importLabel: string;
  readonly saveTranscriptLabel: string;
  readonly summaryLabel: string;
  readonly resetLabel: string;
  readonly indicatorLabel: string;
  readonly modelRailBusy: boolean;
  readonly liveDraftBusy: boolean;
  readonly finalTranscriptBusy: boolean;
  readonly summaryBusy: boolean;
  readonly importBusy: boolean;
}

export interface RecorderProgressElements {
  readonly prepare: HTMLButtonElement;
  readonly start: HTMLButtonElement;
  readonly startLabel: HTMLElement;
  readonly stop: HTMLButtonElement;
  readonly importButton: HTMLButtonElement;
  readonly saveTranscript: HTMLButtonElement;
  readonly summary: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  readonly recordingIndicator: HTMLElement;
  readonly modelRail: HTMLElement;
  readonly liveDraft: HTMLElement;
  readonly liveCard: HTMLElement;
  readonly finalTranscript: HTMLElement;
  readonly finalCard: HTMLElement;
  readonly summaryOutput: HTMLElement;
  readonly summaryCard: HTMLElement;
}

const IDLE_PRESENTATION: RecorderProgressPresentation = {
  prepareLabel: "Prepare local models",
  startLabel: "Start",
  stopLabel: "Stop",
  importLabel: "Open stage fallback WAV",
  saveTranscriptLabel: "Save correction",
  summaryLabel: "Generate summary",
  resetLabel: "Delete / reset",
  indicatorLabel: "Idle",
  modelRailBusy: false,
  liveDraftBusy: false,
  finalTranscriptBusy: false,
  summaryBusy: false,
  importBusy: false,
};

export function recorderProgressPresentation(state: RecorderOperationState): RecorderProgressPresentation {
  switch (state.kind) {
    case "idle":
      return IDLE_PRESENTATION;
    case "prepare":
      return {
        ...IDLE_PRESENTATION,
        prepareLabel: prepareLabel(state),
        indicatorLabel: "Preparing models",
        modelRailBusy: true,
      };
    case "requesting_microphone":
      return {
        ...IDLE_PRESENTATION,
        startLabel: "Requesting microphone…",
        indicatorLabel: "Requesting microphone",
      };
    case "starting_live_captions":
      return {
        ...IDLE_PRESENTATION,
        startLabel: "Starting local models…",
        indicatorLabel: "Starting recording",
        liveDraftBusy: true,
      };
    case "recording_waiting_caption":
      return {
        ...IDLE_PRESENTATION,
        indicatorLabel: "Recording · waiting for caption",
        liveDraftBusy: true,
      };
    case "recording":
      return {
        ...IDLE_PRESENTATION,
        indicatorLabel: "Recording",
      };
    case "finalizing_capture":
      return {
        ...IDLE_PRESENTATION,
        stopLabel: "Finalizing capture…",
        indicatorLabel: "Finalizing capture",
        liveDraftBusy: true,
        finalTranscriptBusy: true,
      };
    case "transcribing":
      return {
        ...IDLE_PRESENTATION,
        stopLabel: "Transcribing…",
        indicatorLabel: "Transcribing with Whisper",
        finalTranscriptBusy: true,
      };
    case "import":
      return {
        ...IDLE_PRESENTATION,
        importLabel: importLabel(state.stage),
        indicatorLabel: importIndicator(state.stage),
        finalTranscriptBusy: state.stage === "transcribing",
        importBusy: true,
      };
    case "saving_transcript":
      return {
        ...IDLE_PRESENTATION,
        saveTranscriptLabel: "Saving correction…",
        indicatorLabel: "Saving transcript",
        finalTranscriptBusy: true,
      };
    case "summary_saving_transcript":
      return {
        ...IDLE_PRESENTATION,
        summaryLabel: "Saving correction…",
        indicatorLabel: "Saving transcript",
        finalTranscriptBusy: true,
        summaryBusy: true,
      };
    case "summary_generating":
      return {
        ...IDLE_PRESENTATION,
        summaryLabel: "Generating summary…",
        indicatorLabel: "Generating summary",
        summaryBusy: true,
      };
    case "resetting":
      return {
        ...IDLE_PRESENTATION,
        resetLabel: "Cancelling / resetting…",
        indicatorLabel: "Cancelling and unloading",
        modelRailBusy: true,
        liveDraftBusy: true,
        finalTranscriptBusy: true,
        summaryBusy: true,
      };
  }
}

export function applyRecorderProgress(
  elements: RecorderProgressElements,
  state: RecorderOperationState,
  recordingActive: boolean,
): void {
  const presentation = recorderProgressPresentation(state);
  elements.prepare.textContent = presentation.prepareLabel;
  elements.startLabel.textContent = presentation.startLabel;
  elements.stop.textContent = presentation.stopLabel;
  elements.importButton.textContent = presentation.importLabel;
  elements.saveTranscript.textContent = presentation.saveTranscriptLabel;
  elements.summary.textContent = presentation.summaryLabel;
  elements.reset.textContent =
    state.kind === "idle" && recordingActive ? "Cancel / reset" : presentation.resetLabel;
  elements.recordingIndicator.textContent = presentation.indicatorLabel;
  elements.modelRail.setAttribute("aria-busy", String(presentation.modelRailBusy));
  elements.liveDraft.setAttribute("aria-busy", String(presentation.liveDraftBusy));
  elements.liveCard.setAttribute("aria-busy", String(presentation.liveDraftBusy));
  elements.finalTranscript.setAttribute("aria-busy", String(presentation.finalTranscriptBusy));
  elements.finalCard.setAttribute("aria-busy", String(presentation.finalTranscriptBusy));
  elements.summaryOutput.setAttribute("aria-busy", String(presentation.summaryBusy));
  elements.summaryCard.setAttribute("aria-busy", String(presentation.summaryBusy));
  elements.importButton.setAttribute("aria-busy", String(presentation.importBusy));
  elements.prepare.setAttribute("aria-busy", String(presentation.modelRailBusy));
  elements.start.setAttribute(
    "aria-busy",
    String(state.kind === "requesting_microphone" || state.kind === "starting_live_captions"),
  );
  elements.stop.setAttribute(
    "aria-busy",
    String(state.kind === "finalizing_capture" || state.kind === "transcribing"),
  );
  elements.saveTranscript.setAttribute("aria-busy", String(state.kind === "saving_transcript"));
  elements.summary.setAttribute(
    "aria-busy",
    String(state.kind === "summary_saving_transcript" || state.kind === "summary_generating"),
  );
  elements.reset.setAttribute("aria-busy", String(state.kind === "resetting"));
}

function prepareLabel(state: Extract<RecorderOperationState, { readonly kind: "prepare" }>): string {
  if (state.role !== undefined) {
    const role = state.role === "summary" ? "summary" : state.role;
    switch (state.stage) {
      case "downloading_model":
        return `Downloading ${role}…`;
      case "registering_provider":
        return `Registering ${role} provider…`;
      case "loading_model":
        return `Loading ${role}…`;
      default:
        return `Preparing ${role}…`;
    }
  }
  return state.stage === "validating_endpoint" ? "Validating local runtime…" : "Initializing local runtime…";
}

function importLabel(stage: ImportProgressStage): string {
  switch (stage) {
    case "selecting_file":
      return "Choose a WAV…";
    case "reading_file":
      return "Reading WAV…";
    case "decoding_audio":
      return "Decoding WAV…";
    case "transcribing":
      return "Transcribing WAV…";
  }
}

function importIndicator(stage: ImportProgressStage): string {
  switch (stage) {
    case "selecting_file":
      return "Selecting WAV";
    case "reading_file":
      return "Reading WAV";
    case "decoding_audio":
      return "Decoding WAV";
    case "transcribing":
      return "Transcribing with Whisper";
  }
}
