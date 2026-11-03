import { describe, expect, it } from "vitest";
import type { AssistantLaneSnapshot, AssistantPendingOperation } from "../src/assistant/assistant-types";
import { assistantOperationStatusMessage, imageAnalysisProgress } from "../src/renderer/assistant-progress";

describe("assistant progress presentation", () => {
  it("distinguishes queued and active image analysis without losing the analyzing label", () => {
    expect(imageAnalysisProgress(snapshot(operation("queued")))).toEqual({
      requestId: "image-request",
      status: "queued",
      phase: "queued",
      buttonLabel: "Analyzing… (queued)",
      metadataLabel: "Analyzing (queued)",
      detailLabel: "Image analysis is queued locally…",
    });
    expect(imageAnalysisProgress(snapshot(operation("active")))).toEqual({
      requestId: "image-request",
      status: "active",
      phase: "running_inference",
      buttonLabel: "Analyzing…",
      metadataLabel: "Analyzing",
      detailLabel: "Analyzing image locally…",
    });
  });

  it("removes image progress when no matching operation remains", () => {
    expect(imageAnalysisProgress(snapshot())).toBeNull();
    expect(
      imageAnalysisProgress(
        snapshot({
          requestId: "chat-request",
          kind: "chat",
          status: "active",
          phase: "running_inference",
        }),
      ),
    ).toBeNull();
  });

  it("distinguishes lazy model loading from active chat and image inference", () => {
    expect(
      assistantOperationStatusMessage(
        snapshot({
          requestId: "chat-request",
          kind: "chat",
          status: "active",
          phase: "loading_model",
        }),
      ),
    ).toBe("Loading the local assistant model…");
    expect(
      imageAnalysisProgress(
        snapshot({
          requestId: "image-request",
          kind: "image_analysis",
          status: "active",
          phase: "loading_model",
        }),
      ),
    ).toMatchObject({
      buttonLabel: "Loading model…",
      metadataLabel: "Loading model",
      detailLabel: "Loading the local assistant model…",
    });
  });

  it("labels image-dependent Explain work without misrepresenting queued or active inference", () => {
    const operation: AssistantPendingOperation = {
      requestId: "explain-image",
      kind: "chat",
      status: "active",
      phase: "running_inference",
    };
    const state: AssistantLaneSnapshot = {
      ...snapshot(operation),
      chatMessages: [
        {
          id: "question",
          requestId: operation.requestId,
          role: "user",
          text: "Explain the selected image.",
          mode: "classroom",
          contextFingerprint: "context",
          dependsOnImage: true,
          imageId: "image",
          imageVersion: 1,
          contextLabels: [{ kind: "none", label: "none", version: null, ephemeral: false }],
          createdAt: "2026-11-03T00:00:00.000Z",
        },
      ],
    };

    expect(assistantOperationStatusMessage(state)).toBe("Thinking about the selected image…");
  });
});

function operation(status: AssistantPendingOperation["status"]): AssistantPendingOperation {
  return {
    requestId: "image-request",
    kind: "image_analysis",
    status,
    phase: status === "queued" ? "queued" : "running_inference",
  };
}

function snapshot(operation?: AssistantPendingOperation): AssistantLaneSnapshot {
  return {
    generation: 0,
    mode: "classroom",
    image: null,
    imageAnalysis: null,
    chatMessages: [],
    activeRequestId: operation?.status === "active" ? operation.requestId : null,
    activeOperation: operation?.status === "active" ? operation.kind : null,
    pendingOperations: operation === undefined ? [] : [operation],
    queuedRequests: operation?.status === "queued" ? 1 : 0,
    maxQueuedRequests: 3,
    cleanupPending: false,
    cleanupDetail: null,
    trace: [],
  };
}
