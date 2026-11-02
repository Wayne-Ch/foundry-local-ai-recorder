import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "../src/assistant/image-security";

describe("image security", () => {
  it("accepts a bounded PNG only when extension, media type, and signature agree", () => {
    const image = validateImage({
      basename: "lesson.png",
      declaredMimeType: "image/png",
      bytes: pngHeader(1_280, 720),
    });

    expect(image).toMatchObject({
      basename: "lesson.png",
      mimeType: "image/png",
      width: 1_280,
      height: 720,
    });
  });

  it("accepts bounded JPEG and WebP headers only with matching declarations", () => {
    expect(
      validateImage({
        basename: "lesson.jpeg",
        declaredMimeType: "image/jpeg",
        bytes: jpegHeader(1_024, 768),
      }),
    ).toMatchObject({ mimeType: "image/jpeg", width: 1_024, height: 768 });
    expect(
      validateImage({
        basename: "lesson.webp",
        declaredMimeType: "image/webp",
        bytes: webpHeader(800, 600),
      }),
    ).toMatchObject({ mimeType: "image/webp", width: 800, height: 600 });
  });

  it("validates the generated ODE slide fixture", async () => {
    const bytes = await readFile(path.resolve("fixtures", "ode-slide.png"));

    expect(
      validateImage({
        basename: "ode-slide.png",
        declaredMimeType: "image/png",
        bytes,
      }),
    ).toMatchObject({
      mimeType: "image/png",
      width: 1_280,
      height: 720,
    });
  });

  it("returns detached plain Uint8Array bytes from a Node readFile-like Buffer", () => {
    const source = Buffer.from(pngHeader(640, 480));
    const expected = Uint8Array.from(source);
    const image = validateImage({
      basename: "lesson.png",
      declaredMimeType: "image/png",
      bytes: source,
    });

    expect(Buffer.isBuffer(image.bytes)).toBe(false);
    expect(image.bytes.constructor).toBe(Uint8Array);
    expect(image.bytes.buffer).not.toBe(source.buffer);

    source.fill(0);
    expect(image.bytes).toEqual(expected);
  });

  it.each(["lesson.svg", "lesson.html", "lesson.pdf", "lesson.pptx"])(
    "rejects unsupported active/document content: %s",
    (basename) => {
      expect(() =>
        validateImage({
          basename,
          declaredMimeType: "application/octet-stream",
          bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67]),
        }),
      ).toThrow("PNG, JPEG, or WebP");
    },
  );

  it("rejects extension/signature mismatches", () => {
    expect(() =>
      validateImage({
        basename: "spoofed.jpg",
        declaredMimeType: "image/jpeg",
        bytes: pngHeader(640, 480),
      }),
    ).toThrow("does not match its file signature");
  });

  it("rejects files above 10 MiB before parsing", () => {
    expect(() =>
      validateImage({
        basename: "large.png",
        declaredMimeType: "image/png",
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
      }),
    ).toThrow("10 MiB");
  });

  it("rejects dimension and total-pixel bombs", () => {
    expect(() =>
      validateImage({
        basename: "wide.png",
        declaredMimeType: "image/png",
        bytes: pngHeader(8_193, 1),
      }),
    ).toThrow("dimensions");
    expect(() =>
      validateImage({
        basename: "pixels.png",
        declaredMimeType: "image/png",
        bytes: pngHeader(6_000, 6_000),
      }),
    ).toThrow("dimensions");
  });

  it("sanitizes the renderer-visible basename and never retains a path", () => {
    const image = validateImage({
      basename: "C:\\private\\lecture\u0000.png",
      declaredMimeType: "image/png",
      bytes: pngHeader(32, 32),
    });

    expect(image.basename).toBe("lecture.png");
    expect(image).not.toHaveProperty("path");
  });
});

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

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes[7] = (height >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  bytes[11] = 3;
  return bytes;
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  writeUint32LittleEndian(bytes, 4, bytes.byteLength - 8);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  writeUint32LittleEndian(bytes, 16, 10);
  writeUint24LittleEndian(bytes, 24, width - 1);
  writeUint24LittleEndian(bytes, 27, height - 1);
  return bytes;
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint24LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}
