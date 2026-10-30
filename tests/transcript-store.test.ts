import { describe, expect, it } from "vitest";
import { TranscriptStore } from "../src/transcript/transcript-store";

describe("TranscriptStore", () => {
  it("keeps live partials replaceable and outside durable final state", () => {
    const store = new TranscriptStore();
    store.startLiveDraft("stream-a");
    expect(store.applyLivePartial("stream-a", 0, "A differential")).toBe(true);
    expect(store.applyLivePartial("stream-a", 1, "A differential equation")).toBe(true);
    expect(store.applyLivePartial("stream-a", 0, "stale")).toBe(false);
    expect(store.snapshot).toMatchObject({
      liveDraft: "A differential equation",
      finalText: "",
      version: 0,
      summary: null,
    });
  });

  it("accepts only a Whisper final as versioned summary input", () => {
    const store = new TranscriptStore();
    store.startLiveDraft("stream-a");
    store.applyLivePartial("stream-a", 0, "draft hypothesis");
    store.setWhisperFinal("The final transcript from Whisper.");
    expect(store.submitForSummary()).toEqual({
      text: "The final transcript from Whisper.",
      version: 1,
    });
    expect(store.snapshot.liveDraft).toBe("");
  });

  it("preserves the exact Whisper text through durable and submitted snapshots", () => {
    const store = new TranscriptStore();
    const exact = "  First line.\r\nSecond  line — café 東京!\n\nSymbols: ∑, →, “quoted”.  ";

    const snapshot = store.setWhisperFinal(exact);
    const submitted = store.submitForSummary();

    expect(snapshot.finalText).toBe(exact);
    expect(submitted.text).toBe(exact);
    expect(store.snapshot.finalText).toBe(exact);
  });

  it("preserves exact user corrections instead of collapsing their whitespace", () => {
    const store = new TranscriptStore();
    store.setWhisperFinal("Original");
    const correction = "Corrected line one.\n  Indented line two.  ";

    const snapshot = store.editFinal(correction);

    expect(snapshot.finalText).toBe(correction);
    expect(store.submitForSummary().text).toBe(correction);
  });

  it("invalidates a prior summary when the final transcript is corrected", () => {
    const store = new TranscriptStore();
    store.setWhisperFinal("Initial final.");
    const submitted = store.submitForSummary();
    store.applySummary({
      text: "Initial summary.",
      transcriptVersion: submitted.version,
      generatedAt: "2026-10-29T00:00:00.000Z",
      modelId: "qwen3-0.6b-generic-gpu:2",
      durationMs: 1200,
      promptTokens: 50,
      completionTokens: 20,
    });
    expect(store.snapshot.summary?.text).toBe("Initial summary.");

    const edited = store.editFinal("Corrected final.");
    expect(edited.version).toBe(2);
    expect(edited.summary).toBeNull();
    expect(edited.submittedVersion).toBeNull();
  });

  it("rejects a stale summary after the transcript changes during generation", () => {
    const store = new TranscriptStore();
    store.setWhisperFinal("Version one.");
    const submitted = store.submitForSummary();
    store.editFinal("Version two.");
    expect(() =>
      store.applySummary({
        text: "Stale summary.",
        transcriptVersion: submitted.version,
        generatedAt: "2026-10-29T00:00:00.000Z",
        modelId: "qwen3-0.6b-generic-gpu:2",
        durationMs: 100,
        promptTokens: 10,
        completionTokens: 5,
      }),
    ).toThrow("changed");
  });
});
