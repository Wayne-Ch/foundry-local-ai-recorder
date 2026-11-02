import { describe, expect, it } from "vitest";
import { buildAssistantContext } from "../src/assistant/assistant-context";
import {
  assistantSystemPrompt,
  chatUserPrompt,
  imageAnalysisPrompt,
} from "../src/assistant/assistant-prompts";

describe("assistant prompts", () => {
  it("makes clinic mode explicitly non-diagnostic and clinician-led", () => {
    const prompt = assistantSystemPrompt("clinic");

    expect(prompt).toContain("clinician-led");
    expect(prompt).toContain("must not diagnose");
    expect(prompt).toContain("assess urgency");
    expect(prompt).toContain("recommend treatment");
    expect(prompt).toContain("qualified interpreter");
  });

  it("requests a structured concise image note", () => {
    const prompt = imageAnalysisPrompt(
      "classroom",
      buildAssistantContext(
        {
          liveDraft: "",
          liveSequence: -1,
          liveStreamId: null,
          finalText: "",
          version: 0,
          submittedVersion: null,
          summary: null,
        },
        null,
      ),
    );

    expect(prompt).toContain("Visible text/objects:");
    expect(prompt).toContain("Relation to lesson:");
    expect(prompt).toContain("Uncertainty:");
  });

  it("preserves a one-sentence user constraint without claiming citations", () => {
    const prompt = chatUserPrompt(
      "What is ODE? Answer in one sentence.",
      buildAssistantContext(
        {
          liveDraft: "",
          liveSequence: -1,
          liveStreamId: null,
          finalText: "We introduced ordinary differential equations.",
          version: 1,
          submittedVersion: null,
          summary: null,
        },
        null,
      ),
    );

    expect(prompt).toContain("Answer in one sentence.");
    expect(prompt).not.toContain("citation");
  });
});
