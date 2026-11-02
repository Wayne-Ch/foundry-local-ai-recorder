import { describe, expect, it } from "vitest";
import { buildAssistantContext } from "../src/assistant/assistant-context";
import { AssistantMemoryState } from "../src/assistant/assistant-state";
import type { TranscriptSnapshot } from "../src/transcript/transcript-store";

describe("assistant context and memory", () => {
  it("uses a final transcript before a live draft and labels versions", () => {
    const context = buildAssistantContext(
      transcript({
        liveDraft: "replaceable text",
        liveSequence: 4,
        finalText: "authoritative text",
        version: 2,
        summary: {
          text: "summary text",
          transcriptVersion: 2,
          generatedAt: "2026-01-01T00:00:00.000Z",
          modelId: "summary",
          durationMs: 1,
          promptTokens: 1,
          completionTokens: 1,
        },
      }),
      null,
    );

    expect(context.transcript).toMatchObject({
      kind: "final_transcript",
      text: "authoritative text",
      version: 2,
      ephemeral: false,
    });
    expect(context.labels.map((label) => label.label)).toEqual(["final transcript v2", "summary v2"]);
  });

  it("keeps live draft text ephemeral and stores only its label in chat history", () => {
    const state = new AssistantMemoryState();
    const context = buildAssistantContext(
      transcript({ liveDraft: "private live snapshot", liveSequence: 7 }),
      null,
    );

    state.appendUserMessage("request-1", "What is ODE?", context);
    const serialized = JSON.stringify(state.snapshot());

    expect(serialized).toContain("live draft snapshot (may change)");
    expect(serialized).not.toContain("private live snapshot");
  });

  it("rejects stale image analysis after image or transcript context changes", () => {
    const state = new AssistantMemoryState();
    state.selectImage({
      basename: "ode.png",
      mimeType: "image/png",
      sizeBytes: 123,
      width: 640,
      height: 480,
      thumbnailDataUrl: "data:image/png;base64,abc",
    });
    const contextV1 = buildAssistantContext(transcript({ finalText: "v1", version: 1 }), null);
    const token = state.beginOperation("request-1", "image_analysis", contextV1);
    const contextV2 = buildAssistantContext(transcript({ finalText: "v2", version: 2 }), null);

    expect(
      state.applyImageAnalysis(
        token,
        contextV2,
        {
          visibleTextAndObjects: "ODE",
          relationToLesson: "equation",
          uncertainty: "none",
        },
        "vision-model",
      ),
    ).toBe(false);
    expect(state.snapshot().imageAnalysis).toBeNull();
  });

  it("stores image context versions without retaining an ephemeral live draft", () => {
    const state = new AssistantMemoryState();
    state.selectImage({
      basename: "ode.png",
      mimeType: "image/png",
      sizeBytes: 123,
      width: 640,
      height: 480,
      thumbnailDataUrl: "data:image/png;base64,abc",
    });
    const context = buildAssistantContext(
      transcript({ liveDraft: "ephemeral lesson words", liveSequence: 4 }),
      null,
    );
    const token = state.beginOperation("request-1", "image_analysis", context);

    expect(
      state.applyImageAnalysis(
        token,
        context,
        {
          visibleTextAndObjects: "ODE",
          relationToLesson: "equation",
          uncertainty: "none",
        },
        "vision-model",
      ),
    ).toBe(true);
    const serialized = JSON.stringify(state.snapshot().imageAnalysis);
    expect(serialized).toContain("live draft snapshot (may change)");
    expect(serialized).not.toContain("ephemeral lesson words");
  });

  it("clears image, analysis, chat, and mode on reset", () => {
    const state = new AssistantMemoryState();
    state.setMode("clinic");
    state.selectImage({
      basename: "xray.webp",
      mimeType: "image/webp",
      sizeBytes: 100,
      width: 10,
      height: 10,
      thumbnailDataUrl: "data:image/webp;base64,abc",
    });
    state.appendUserMessage("request-1", "Explain this.", buildAssistantContext(transcript({}), null));

    state.reset();

    expect(state.snapshot()).toMatchObject({
      mode: "classroom",
      image: null,
      imageAnalysis: null,
      chatMessages: [],
    });
  });
});

function transcript(overrides: Partial<TranscriptSnapshot>): TranscriptSnapshot {
  return {
    liveDraft: "",
    liveSequence: -1,
    liveStreamId: null,
    finalText: "",
    version: 0,
    submittedVersion: null,
    summary: null,
    ...overrides,
  };
}
