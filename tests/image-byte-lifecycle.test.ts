import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { secureAssistantImageByteLifecycle } from "../src/assistant/image-byte-lifecycle";

describe("secure assistant image byte lifecycle", () => {
  it("creates a detached plain Uint8Array from a Node Buffer", () => {
    const source = Buffer.from([1, 2, 3]);
    const copied = secureAssistantImageByteLifecycle.copy(source, "selected-image");

    expect(Buffer.isBuffer(copied)).toBe(false);
    expect(copied.constructor).toBe(Uint8Array);
    expect(copied.buffer).not.toBe(source.buffer);

    source.fill(0);
    expect(copied).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("zeroing a detached copy does not mutate its Buffer source", () => {
    const source = Buffer.from([4, 5, 6]);
    const copied = secureAssistantImageByteLifecycle.copy(source, "assistant-operation");

    secureAssistantImageByteLifecycle.release(copied, "assistant-operation");

    expect(copied).toEqual(new Uint8Array([0, 0, 0]));
    expect(source).toEqual(Buffer.from([4, 5, 6]));
  });
});
