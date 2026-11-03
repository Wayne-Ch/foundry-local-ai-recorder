import { describe, expect, it } from "vitest";
import type { AssistantLaneSnapshot, AssistantPendingOperation } from "../src/assistant/assistant-types";
import { imageAnalysisProgress } from "../src/renderer/assistant-progress";

describe("assistant progress presentation", () => {
  it("distinguishes queued and active image analysis without losing the analyzing label", () => {
    expect(imageAnalysisProgress(snapshot(operation("queued")))).toEqual({
      requestId: "image-request",
      status: "queued",
      buttonLabel: "Analyzing… (queued)",
      metadataLabel: "Analyzing (queued)",
      detailLabel: "Image analysis is queued locally…",
    });
    expect(imageAnalysisProgress(snapshot(operation("active")))).toEqual({
      requestId: "image-request",
      status: "active",
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
        }),
      ),
    ).toBeNull();
  });
});

function operation(status: AssistantPendingOperation["status"]): AssistantPendingOperation {
  return {
    requestId: "image-request",
    kind: "image_analysis",
    status,
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
