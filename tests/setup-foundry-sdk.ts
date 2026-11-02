import { vi } from "vitest";

vi.mock("foundry-local-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("foundry-local-sdk")>();

  class TestRequest {
    readonly items: unknown[] = [];
    options: unknown;
    cancelled = false;

    addItem(item: unknown): this {
      this.items.push(item);
      return this;
    }

    setOptions(options: unknown): this {
      this.options = options;
      return this;
    }

    get itemCount(): number {
      return this.items.length;
    }

    getItem(index: number): unknown {
      const item = this.items[index];
      if (item === undefined) {
        throw new RangeError(`No request item at ${index}.`);
      }
      return item;
    }

    cancel(): void {
      this.cancelled = true;
    }
  }

  class TestItemQueue {
    readonly items: unknown[] = [];
    finished = false;
    disposed = false;

    get size(): number {
      return this.items.length;
    }

    push(item: unknown): void {
      if (this.finished || this.disposed) {
        throw new Error("The test item queue is closed.");
      }
      this.items.push(item);
    }

    markFinished(): void {
      this.finished = true;
    }

    dispose(): void {
      this.disposed = true;
      this.items.length = 0;
    }
  }

  const Item = {
    audioDescriptor: (format: string, sampleRate: number, channels: number) => ({
      type: "audioDescriptor",
      format,
      sampleRate,
      channels,
    }),
    audioFromUri: (uri: string) => ({ type: "audio", uri }),
    bytes: (data: Uint8Array) => ({ type: "bytes", data }),
    imageFromData: (format: string, data: Uint8Array) => ({
      type: "image",
      format,
      data,
    }),
    imageFromUri: (uri: string, format?: string) => ({
      type: "image",
      uri,
      ...(format === undefined ? {} : { format }),
    }),
    systemMessage: (content: string) => ({
      type: "message",
      role: "system",
      content,
    }),
    text: (text: string) => ({ type: "text", text }),
    userMessage: (content: string | readonly unknown[]) =>
      typeof content === "string"
        ? { type: "message", role: "user", content }
        : { type: "message", role: "user", content, parts: content },
  };

  return {
    ...actual,
    Item,
    ItemQueue: TestItemQueue,
    Request: TestRequest,
  };
});
