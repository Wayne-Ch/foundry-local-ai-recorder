import { describe, expect, it } from "vitest";
import { buildAssistantContext, buildImageAnalysisContext } from "../src/assistant/assistant-context";
import {
  assistantSystemPrompt,
  chatUserPrompt,
  IMAGE_LESSON_TOPIC_MAX_CHARS,
  imageAnalysisPrompt,
  imageLessonTopicExcerpt,
} from "../src/assistant/assistant-prompts";

const PROBLEMATIC_TRANSCRIPT =
  "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.";
const BOUNDED_PROBLEMATIC_TOPIC =
  "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables.";

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
      buildImageAnalysisContext({
        liveDraft: "",
        liveSequence: -1,
        liveStreamId: null,
        finalText: "",
        version: 0,
        submittedVersion: null,
        summary: null,
      }),
    );

    expect(prompt).toContain("Visible text/objects:");
    expect(prompt).toContain("Relation to lesson:");
    expect(prompt).toContain("Uncertainty:");
    expect(prompt).toContain("Put a newline after line 1 and line 2");
    expect(prompt).toContain("Never place two headings on the same line");
    expect(prompt).toContain("at most 3 concise observations");
    expect(prompt).toContain("Do not repeat any phrase");
    expect(prompt).toContain("Stop after line 3");
  });

  it("uses the exact bounded topic for the problematic transcript while fingerprinting its full text", () => {
    const context = buildImageAnalysisContext({
      liveDraft: "",
      liveSequence: -1,
      liveStreamId: null,
      finalText: PROBLEMATIC_TRANSCRIPT,
      version: 4,
      submittedVersion: null,
      summary: null,
    });
    const tailCorrectedTranscript = PROBLEMATIC_TRANSCRIPT.replace(
      "If y of 0 equals 3, then c equals 3.",
      "If y of 0 equals 4, then c equals 4.",
    );
    const correctedContext = buildImageAnalysisContext({
      liveDraft: "",
      liveSequence: -1,
      liveStreamId: null,
      finalText: tailCorrectedTranscript,
      version: 4,
      submittedVersion: null,
      summary: null,
    });
    const prompt = imageAnalysisPrompt(context);

    expect(imageLessonTopicExcerpt(PROBLEMATIC_TRANSCRIPT)).toBe(BOUNDED_PROBLEMATIC_TOPIC);
    expect(imageLessonTopicExcerpt(tailCorrectedTranscript)).toBe(BOUNDED_PROBLEMATIC_TOPIC);
    expect(BOUNDED_PROBLEMATIC_TOPIC.length).toBeLessThanOrEqual(IMAGE_LESSON_TOPIC_MAX_CHARS);
    expect(prompt).toBe(
      [
        "Analyze the attached image as a lesson aid.",
        "Use only visible image evidence and the bounded lesson topic below.",
        `LESSON TOPIC (first complete sentences, maximum ${IMAGE_LESSON_TOPIC_MAX_CHARS} characters)`,
        BOUNDED_PROBLEMATIC_TOPIC,
        "Return exactly three lines and no other text. Put a newline after line 1 and line 2. Never place two headings on the same line.",
        "Line 1 must begin exactly: Visible text/objects:",
        "Line 2 must begin exactly: Relation to lesson:",
        "Line 3 must begin exactly: Uncertainty:",
        "Use at most 3 concise observations, at most 2 lesson connections, and one uncertainty statement.",
        "Do not repeat any phrase. Stop after line 3.",
      ].join("\n"),
    );
    expect(context.transcript.text).toBe(PROBLEMATIC_TRANSCRIPT);
    expect(correctedContext.fingerprint).not.toBe(context.fingerprint);
  });

  it("falls back to a deterministic word boundary when no complete sentence fits", () => {
    const transcript = `${"lesson ".repeat(30)}tail`;
    const excerpt = imageLessonTopicExcerpt(transcript);

    expect(excerpt.length).toBeLessThanOrEqual(IMAGE_LESSON_TOPIC_MAX_CHARS);
    expect(transcript.startsWith(excerpt)).toBe(true);
    expect(transcript[excerpt.length]).toBe(" ");
  });

  it("keeps image safety only in the system message and omits unrelated context placeholders", () => {
    const systemPrompt = assistantSystemPrompt("clinic");
    const prompt = imageAnalysisPrompt(
      buildImageAnalysisContext({
        liveDraft: "",
        liveSequence: -1,
        liveStreamId: null,
        finalText: "The lesson compares a differential equation with its decay graph.",
        version: 1,
        submittedVersion: null,
        summary: null,
      }),
    );

    expect(systemPrompt).toContain("concise local classroom assistant");
    expect(systemPrompt).toContain("must not diagnose");
    expect(prompt).not.toContain("concise local classroom assistant");
    expect(prompt).not.toContain("must not diagnose");
    expect(prompt).not.toContain("No summary context.");
    expect(prompt).not.toContain("No image analysis context.");
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
