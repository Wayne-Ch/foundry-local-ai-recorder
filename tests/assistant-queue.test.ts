import { describe, expect, it } from "vitest";
import { AssistantCancelledError, AssistantOperationQueue } from "../src/assistant/assistant-queue";

describe("assistant operation queue", () => {
  it("serializes requests and enforces a bounded waiting queue", async () => {
    const queue = new AssistantOperationQueue(1);
    let release = () => {};
    const first = queue.enqueue("session-1", "chat", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "first";
    });
    await Promise.resolve();
    const second = queue.enqueue("session-1", "chat", async () => "second");

    expect(() => queue.enqueue("session-1", "chat", async () => "third")).toThrow("queue is full");
    release();
    await expect(first.result).resolves.toBe("first");
    await expect(second.result).resolves.toBe("second");
  });

  it("cancels active and queued work when the renderer session is revoked", async () => {
    const queue = new AssistantOperationQueue(2);
    const active = queue.enqueue("session-1", "chat", async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
          once: true,
        });
      });
      return "unreachable";
    });
    const queued = queue.enqueue("session-1", "image_analysis", async () => "unreachable");

    queue.cancelOwner("session-1");

    await expect(active.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(queued.result).rejects.toBeInstanceOf(AssistantCancelledError);
    expect(queue.activeRequestId).toBeNull();
    expect(queue.queuedRequests).toBe(0);
  });

  it("invalidates stale generations on reset", async () => {
    const queue = new AssistantOperationQueue();
    const request = queue.enqueue("session-1", "chat", async (signal) => {
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
    const chat = queue.enqueue("session-1", "chat", async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AssistantCancelledError()), {
          once: true,
        });
      });
      return "unreachable";
    });
    const image = queue.enqueue("session-1", "image_analysis", async () => "image");

    queue.cancelKind("chat");

    await expect(chat.result).rejects.toBeInstanceOf(AssistantCancelledError);
    await expect(image.result).resolves.toBe("image");
  });
});
