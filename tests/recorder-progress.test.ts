import { describe, expect, it } from "vitest";
import { type RecorderOperationState, recorderProgressPresentation } from "../src/renderer/recorder-progress";

describe("recorder progress presentation", () => {
  it.each([
    [{ kind: "prepare", stage: "initializing_runtime" }, "Initializing local runtime…", "Preparing models"],
    [
      { kind: "prepare", stage: "registering_provider", role: "summary" },
      "Registering summary provider…",
      "Preparing models",
    ],
    [{ kind: "requesting_microphone" }, "Prepare local models", "Requesting microphone"],
    [{ kind: "starting_live_captions" }, "Prepare local models", "Starting recording"],
    [{ kind: "recording_waiting_caption" }, "Prepare local models", "Recording · waiting for caption"],
    [{ kind: "finalizing_capture" }, "Prepare local models", "Finalizing capture"],
    [{ kind: "transcribing" }, "Prepare local models", "Transcribing with Whisper"],
    [{ kind: "import", stage: "selecting_file" }, "Prepare local models", "Selecting WAV"],
    [{ kind: "import", stage: "decoding_audio" }, "Prepare local models", "Decoding WAV"],
    [{ kind: "import", stage: "transcribing" }, "Prepare local models", "Transcribing with Whisper"],
    [{ kind: "saving_transcript" }, "Prepare local models", "Saving transcript"],
    [{ kind: "summary_saving_transcript" }, "Prepare local models", "Saving transcript"],
    [{ kind: "summary_generating" }, "Prepare local models", "Generating summary"],
    [{ kind: "resetting" }, "Prepare local models", "Cancelling and unloading"],
  ] satisfies ReadonlyArray<readonly [RecorderOperationState, string, string]>)(
    "maps %o to visible controls",
    (state, prepareLabel, indicatorLabel) => {
      const presentation = recorderProgressPresentation(state);

      expect(presentation.prepareLabel).toBe(prepareLabel);
      expect(presentation.indicatorLabel).toBe(indicatorLabel);
    },
  );

  it("marks the exact busy regions for Whisper, summary, live caption, and reset waits", () => {
    expect(recorderProgressPresentation({ kind: "recording_waiting_caption" })).toMatchObject({
      liveDraftBusy: true,
      finalTranscriptBusy: false,
    });
    expect(recorderProgressPresentation({ kind: "transcribing" })).toMatchObject({
      finalTranscriptBusy: true,
      summaryBusy: false,
    });
    expect(recorderProgressPresentation({ kind: "summary_generating" })).toMatchObject({
      summaryBusy: true,
      finalTranscriptBusy: false,
    });
    expect(recorderProgressPresentation({ kind: "resetting" })).toMatchObject({
      modelRailBusy: true,
      liveDraftBusy: true,
      finalTranscriptBusy: true,
      summaryBusy: true,
    });
  });
});
