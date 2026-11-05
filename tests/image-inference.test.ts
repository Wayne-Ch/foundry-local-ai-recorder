import { describe, expect, it, vi } from "vitest";
import type {
  AssistantImageByteLifecycle,
  AssistantImageBytePurpose,
} from "../src/assistant/image-byte-lifecycle";
import {
  assistantInferenceImageDimensions,
  MAX_ASSISTANT_INFERENCE_IMAGE_EDGE,
  prepareAssistantInferenceImage,
} from "../src/assistant/image-inference";
import type { ValidatedImage } from "../src/assistant/image-security";

describe("assistant inference image preprocessing", () => {
  it.each([
    [1_280, 720, 384, 216],
    [720, 1_280, 216, 384],
    [384, 216, 384, 216],
    [200, 100, 200, 100],
    [1, 8_192, 1, 384],
  ])("bounds %sx%s to %sx%s without upscaling", (width, height, expectedWidth, expectedHeight) => {
    expect(assistantInferenceImageDimensions(width, height)).toEqual({
      width: expectedWidth,
      height: expectedHeight,
    });
  });

  it("creates a separately owned validated PNG and zeroes the encoder output", () => {
    const source = image(1_280, 720);
    const encoded = pngHeader(384, 216);
    const lifecycle = new TrackingImageByteLifecycle();
    const transcode = vi.fn(() => ({
      decodedWidth: 1_280,
      decodedHeight: 720,
      width: 384,
      height: 216,
      bytes: encoded,
    }));

    const prepared = prepareAssistantInferenceImage(source, transcode, lifecycle);

    expect(transcode).toHaveBeenCalledWith(source.bytes, { width: 384, height: 216 });
    expect(prepared).toMatchObject({
      mimeType: "image/png",
      format: "png",
      width: 384,
      height: 216,
      sizeBytes: 24,
    });
    expect(prepared.bytes).not.toBe(encoded);
    expect(prepared.bytes).toEqual(pngHeader(384, 216));
    expect(encoded.every((value) => value === 0)).toBe(true);
    expect(source.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(Math.max(prepared.width, prepared.height)).toBe(MAX_ASSISTANT_INFERENCE_IMAGE_EDGE);
    expect(lifecycle.releaseCount(encoded, "encoded-inference-image")).toBe(1);
  });

  it("keeps a smaller image at its original dimensions while still producing PNG inference bytes", () => {
    const source = image(320, 180);
    const transcode = vi.fn((_bytes, target) => ({
      decodedWidth: 320,
      decodedHeight: 180,
      width: target.width,
      height: target.height,
      bytes: pngHeader(target.width, target.height),
    }));

    const prepared = prepareAssistantInferenceImage(source, transcode);

    expect(transcode).toHaveBeenCalledWith(source.bytes, { width: 320, height: 180 });
    expect(prepared).toMatchObject({ width: 320, height: 180, format: "png" });
  });

  it("rejects decoded-dimension spoofing and zeroes the encoded copy", () => {
    const encoded = pngHeader(384, 216);
    const lifecycle = new TrackingImageByteLifecycle();

    expect(() =>
      prepareAssistantInferenceImage(
        image(1_280, 720),
        () => ({
          decodedWidth: 1_279,
          decodedHeight: 720,
          width: 384,
          height: 216,
          bytes: encoded,
        }),
        lifecycle,
      ),
    ).toThrow("decoded image dimensions");

    expect(encoded.every((value) => value === 0)).toBe(true);
    expect(lifecycle.releaseCount(encoded, "encoded-inference-image")).toBe(1);
  });

  it("rejects a PNG whose encoded header does not match the bounded target and cleans every copy", () => {
    const encoded = pngHeader(383, 216);
    const lifecycle = new TrackingImageByteLifecycle();

    expect(() =>
      prepareAssistantInferenceImage(
        image(1_280, 720),
        () => ({
          decodedWidth: 1_280,
          decodedHeight: 720,
          width: 384,
          height: 216,
          bytes: encoded,
        }),
        lifecycle,
      ),
    ).toThrow("bounded PNG validation");

    expect(encoded.every((value) => value === 0)).toBe(true);
    expect(lifecycle.purposes()).toEqual(["encoded-inference-image", "prepared-inference-image"]);
  });
});

function image(width: number, height: number): ValidatedImage {
  return {
    basename: "lesson.png",
    mimeType: "image/png",
    sizeBytes: 3,
    width,
    height,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BigEndian(bytes, 16, width);
  writeUint32BigEndian(bytes, 20, height);
  return bytes;
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

class TrackingImageByteLifecycle implements AssistantImageByteLifecycle {
  readonly #releases: Array<{
    readonly bytes: Uint8Array;
    readonly purpose: AssistantImageBytePurpose;
  }> = [];

  copy(source: Uint8Array): Uint8Array {
    return Uint8Array.from(source);
  }

  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void {
    this.#releases.push({ bytes, purpose });
    bytes.fill(0);
  }

  releaseCount(bytes: Uint8Array, purpose: AssistantImageBytePurpose): number {
    return this.#releases.filter((release) => release.bytes === bytes && release.purpose === purpose).length;
  }

  purposes(): readonly AssistantImageBytePurpose[] {
    return this.#releases.map(({ purpose }) => purpose);
  }
}
