import { describe, expect, it } from "vitest";
import { AssistantCancelledError, AssistantOperationQueue } from "../src/assistant/assistant-queue";
import type { AssistantOperationKind, AssistantOperationToken } from "../src/assistant/assistant-types";

describe("assistant operation queue", () => {
  it("reports exact queued and active request identities", async () => {
    const queue = new AssistantOperationQueue(2);
    let release = () => {};
    const firstToken = token("chat");
    const first = queue.enqueue("session-1", firstToken, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "first";
    });

    expect(queue.pendingOperations).toEqual([
      { requestId: firstToken.requestId, kind: "chat", status: "queued" },
    ]);
    await Promise.resolve();
    const secondToken = token("image_analysis", {
      dependsOnImage: true,
      requiresImageBytes: true,
    });
    const second = queue.enqueue("session-1", secondToken, async () => "second");

    expect(queue.pendingOperations).toEqual([
      { requestId: firstToken.requestId, kind: "chat", status: "active" },
      { requestId: secondToken.requestId, kind: "image_analysis", status: "queued" },
    ]);
    release();
    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
    expect(queue.pendingOperations).toEqual([]);
  });

  it("removes cancelled request identities immediately", async () => {
    const queue = new AssistantOperationQueue();
    let release = () => {};
    const operationToken = token("chat");
    const request = queue.enqueue("session-1", operationToken, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "unreachable";
    });
    await Promise.resolve();

    expect(queue.cancel(operationToken.requestId)).toBe(true);
    expect(queue.pendingOperations).toEqual([]);
    release();
    await expect(request.result).rejects.toBeInstanceOf(AssistantCancelledError);
  });

  it("serializes requests and enforces a bounded waiting queue", async () => {
    const queue = new AssistantOperationQueue(1);
    let release = () => {};
    const first = queue.enqueue("session-1", token("chat"), async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "first";
    });
    await Promise.resolve();
    const second = queue.enqueue("session-1", token("chat"), async () => "second");

    expect(() => queue.enqueue("session-1", token("chat"), async () => "third")).toThrow("queue is full");
    release();
    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
  });

  it("cancels active and queued work when the renderer session is revoked", async () => {
    const queue = new AssistantOperationQueue(2);
    const active = queue.enqueue("session-1", token("chat"), async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
          once: true,
        });
      });
      return "unreachable";
    });
    const queued = queue.enqueue(
      "session-1",
      token("image_analysis", { dependsOnImage: true, requiresImageBytes: true }),
      async () => "unreachable",
    );

    queue.cancelOwner("session-1");

    await expect(active.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(queued.result).rejects.toBeInstanceOf(AssistantCancelledError);
    expect(queue.activeRequestId).toBeNull();
    expect(queue.queuedRequests).toBe(0);
  });

  it("invalidates stale generations on reset", async () => {
    const queue = new AssistantOperationQueue();
    const request = queue.enqueue("session-1", token("chat"), async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
          once: true,
        });
      });
      return "unreachable";
    });

    queue.reset();

    await expect(request.result).rejects.toBeInstanceOf(AssistantCancelledError);
  });

  it("cancels only chat work when chat history is cleared", async () => {
    const queue = new AssistantOperationQueue(2);
    const chat = queue.enqueue("session-1", token("chat"), async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
          once: true,
        });
      });
      return "unreachable";
    });
    const image = queue.enqueue(
      "session-1",
      token("image_analysis", { dependsOnImage: true, requiresImageBytes: true }),
      async () => "image",
    );

    queue.cancelKind("chat");

    await expect(chat.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(image.result).resolves.toBe("image");
  });

  it("cancels only image-dependent active and pending work", async () => {
    const queue = new AssistantOperationQueue(3);
    const active = queue.enqueue(
      "session-1",
      token("chat", { dependsOnImage: true, requiresImageBytes: true }),
      async (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
            once: true,
          });
        }),
    );
    const text = queue.enqueue("session-1", token("chat"), async () => "text");
    const image = queue.enqueue(
      "session-1",
      token("image_analysis", { dependsOnImage: true, requiresImageBytes: true }),
      async () => "image",
    );

    expect(queue.cancelImageDependent()).toBe(true);

    await expect(active.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(image.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(text.result).resolves.toBe("text");
  });
});

let requestSequence = 0;

function token(
  kind: AssistantOperationKind,
  overrides: Partial<AssistantOperationToken> = {},
): AssistantOperationToken {
  requestSequence += 1;
  return {
    requestId: `request-${requestSequence}`,
    generation: 0,
    laneGeneration: 0,
    kind,
    mode: "classroom",
    dependsOnImage: false,
    requiresImageBytes: false,
    imageId: null,
    imageVersion: null,
    contextFingerprint: "context",
    context: {
      transcript: {
        kind: "none",
        text: "",
        version: null,
        liveSequence: null,
        ephemeral: false,
      },
      transcriptFingerprint: "transcript-context",
      summaryText: null,
      summaryVersion: null,
      imageAnalysisText: null,
      imageAnalysisVersion: null,
      labels: [{ kind: "none", label: "none", version: null, ephemeral: false }],
      fingerprint: "context",
    },
    ...overrides,
  };
}
