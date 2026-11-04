import { describe, expect, it } from "vitest";
import { buildAssistantContext } from "../src/assistant/assistant-context";
import { AssistantMemoryState } from "../src/assistant/assistant-state";
import { assistantOperationStatusMessage } from "../src/renderer/assistant-progress";
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

    const token = state.createOperationToken("request-1", "chat", context, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });
    state.appendUserMessage(token, "What is ODE?");
    const serialized = JSON.stringify(state.snapshot());

    expect(serialized).toContain("live draft snapshot (may change)");
    expect(serialized).not.toContain("private live snapshot");
  });

  it("keeps an active inference phase across queue-less state reads", () => {
    const state = new AssistantMemoryState();
    const context = buildAssistantContext(transcript({ finalText: "lesson", version: 1 }), null);
    const token = state.createOperationToken("request-running", "chat", context, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });
    state.setOperationPhase(token, "running_inference");
    const queue = {
      activeRequestId: token.requestId,
      activeOperation: token.kind,
      pendingOperations: [
        {
          requestId: token.requestId,
          kind: token.kind,
          status: "active",
          phase: "initializing_runtime",
        },
      ],
      queuedRequests: 0,
      maxQueuedRequests: 3,
    } as const;

    expect(state.snapshot(queue).pendingOperations[0]?.phase).toBe("running_inference");
    state.snapshot();
    const afterRead = state.snapshot(queue);

    expect(afterRead.pendingOperations[0]?.phase).toBe("running_inference");
    expect(assistantOperationStatusMessage(afterRead)).toBe("Thinking locally…");
  });

  it("captures immutable chat context, labels both roles, and filters history by snapshot", () => {
    const state = new AssistantMemoryState();
    const liveContext = buildAssistantContext(
      transcript({ liveDraft: "ask-time live words", liveSequence: 7 }),
      null,
    );
    const liveToken = state.createOperationToken("request-live", "chat", liveContext, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });

    expect(liveToken.context).not.toBe(liveContext);
    expect(liveToken.context.labels).not.toBe(liveContext.labels);
    expect(Object.isFrozen(liveToken.context)).toBe(true);
    expect(Object.isFrozen(liveToken.context.transcript)).toBe(true);
    expect(Object.isFrozen(liveToken.context.labels)).toBe(true);

    state.appendUserMessage(liveToken, "Question from live context");
    expect(state.applyChatAnswer(liveToken, "Answer from live context")).toBe(true);

    const finalContext = buildAssistantContext(
      transcript({ finalText: "authoritative final words", version: 3 }),
      null,
    );
    const finalToken = state.createOperationToken("request-final", "chat", finalContext, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });
    state.appendUserMessage(finalToken, "Question from final context");
    expect(state.applyChatAnswer(finalToken, "Answer from final context")).toBe(true);

    expect(state.chatHistoryFor(finalToken).map((message) => message.requestId)).toEqual([
      "request-final",
      "request-final",
    ]);
    expect(
      state
        .snapshot()
        .chatMessages.filter((message) => message.requestId === "request-live")
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([["live draft snapshot (may change)"], ["live draft snapshot (may change)"]]);
    expect(
      state
        .snapshot()
        .chatMessages.filter((message) => message.requestId === "request-final")
        .map((message) => message.contextLabels.map((label) => label.label)),
    ).toEqual([["final transcript v3"], ["final transcript v3"]]);
  });

  it("keeps application-owned display additions out of model chat history", () => {
    const state = new AssistantMemoryState();
    const context = buildAssistantContext(transcript({}), null);
    const token = state.createOperationToken("request-1", "chat", context, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });
    const modelAnswer = "Raw local answer.";
    const visibleAnswer = `${modelAnswer}\n\nTreating-clinician handoff.`;

    state.appendUserMessage(token, "Question");
    expect(state.applyChatAnswer(token, visibleAnswer, modelAnswer)).toBe(true);

    expect(state.snapshot().chatMessages.at(-1)?.text).toBe(visibleAnswer);
    expect(state.chatHistoryFor(token).at(-1)?.text).toBe(modelAnswer);
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
    const token = state.createOperationToken("request-1", "image_analysis", contextV1, {
      dependsOnImage: true,
      requiresImageBytes: true,
    });
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
    const token = state.createOperationToken("request-1", "image_analysis", context, {
      dependsOnImage: true,
      requiresImageBytes: true,
    });

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
    const context = buildAssistantContext(transcript({}), null);
    const token = state.createOperationToken("request-1", "chat", context, {
      dependsOnImage: false,
      requiresImageBytes: false,
    });
    state.appendUserMessage(token, "Explain this.");

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
