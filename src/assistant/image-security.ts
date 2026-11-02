import path from "node:path";
import { copyToDetachedUint8Array } from "./image-byte-lifecycle";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8_192;
export const MAX_IMAGE_PIXELS = 24_000_000;

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageValidationInput {
  readonly basename: string;
  readonly declaredMimeType: string;
  readonly bytes: Uint8Array;
}

export interface ValidatedImage {
  readonly basename: string;
  readonly mimeType: SupportedImageMimeType;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

const MIME_BY_EXTENSION = new Map<string, SupportedImageMimeType>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

export function declaredImageMimeType(basename: string): SupportedImageMimeType {
  const extension = path.extname(basename).toLowerCase();
  const mimeType = MIME_BY_EXTENSION.get(extension);
  if (mimeType === undefined) {
    throw new Error("Select a PNG, JPEG, or WebP image. SVG, HTML, PDF, and Office files are rejected.");
  }
  return mimeType;
}

export function validateImage(input: ImageValidationInput): ValidatedImage {
  const basename = sanitizeImageBasename(input.basename);
  const expectedMimeType = declaredImageMimeType(basename);
  if (input.declaredMimeType !== expectedMimeType) {
    throw new Error("The selected image extension and declared media type do not match.");
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("The selected image is empty.");
  }
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("The selected image exceeds the 10 MiB limit.");
  }

  const detected = detectImage(input.bytes);
  if (detected.mimeType !== expectedMimeType) {
    throw new Error("The selected image extension does not match its file signature.");
  }
  if (
    detected.width <= 0 ||
    detected.height <= 0 ||
    detected.width > MAX_IMAGE_DIMENSION ||
    detected.height > MAX_IMAGE_DIMENSION ||
    detected.width * detected.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `Image dimensions must be at most ${MAX_IMAGE_DIMENSION} px per side and ${MAX_IMAGE_PIXELS.toLocaleString("en-US")} total pixels.`,
    );
  }

  return {
    basename,
    mimeType: detected.mimeType,
    sizeBytes: input.bytes.byteLength,
    width: detected.width,
    height: detected.height,
    bytes: copyToDetachedUint8Array(input.bytes),
  };
}

export function sanitizeImageBasename(value: string): string {
  const basename = stripControlCharacters(path.win32.basename(path.posix.basename(value))).trim();
  if (!basename) {
    throw new Error("The selected image name is invalid.");
  }

  function stripControlCharacters(value: string): string {
    return [...value]
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 0x1f && codePoint !== 0x7f;
      })
      .join("");
  }
  return basename.slice(0, 180);
}

function detectImage(bytes: Uint8Array): {
  readonly mimeType: SupportedImageMimeType;
  readonly width: number;
  readonly height: number;
} {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", ...pngDimensions(bytes) };
  }
  if (hasPrefix(bytes, [0xff, 0xd8])) {
    return { mimeType: "image/jpeg", ...jpegDimensions(bytes) };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { mimeType: "image/webp", ...webpDimensions(bytes) };
  }
  throw new Error("The selected file does not have a supported PNG, JPEG, or WebP signature.");
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  if (bytes.byteLength < 24 || ascii(bytes, 12, 16) !== "IHDR") {
    throw new Error("The PNG header is incomplete or invalid.");
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  };
}

function jpegDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  let offset = 2;
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.byteLength) {
      break;
    }
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error("The JPEG segment table is invalid.");
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) {
        throw new Error("The JPEG frame header is incomplete.");
      }
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error("The JPEG does not contain a supported frame header.");
}

function webpDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  if (bytes.byteLength < 20) {
    throw new Error("The WebP header is incomplete.");
  }
  const riffLength = readUint32LittleEndian(bytes, 4) + 8;
  if (riffLength > bytes.byteLength) {
    throw new Error("The WebP RIFF length exceeds the selected file.");
  }

  let offset = 12;
  while (offset + 8 <= riffLength) {
    const chunkType = ascii(bytes, offset, offset + 4);
    const chunkLength = readUint32LittleEndian(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkLength > riffLength) {
      throw new Error("The WebP chunk table is invalid.");
    }
    if (chunkType === "VP8X") {
      if (chunkLength < 10) {
        throw new Error("The WebP VP8X header is incomplete.");
      }
      return {
        width: 1 + readUint24LittleEndian(bytes, dataOffset + 4),
        height: 1 + readUint24LittleEndian(bytes, dataOffset + 7),
      };
    }
    if (chunkType === "VP8L") {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) {
        throw new Error("The WebP VP8L header is invalid.");
      }
      const b1 = requiredByte(bytes, dataOffset + 1);
      const b2 = requiredByte(bytes, dataOffset + 2);
      const b3 = requiredByte(bytes, dataOffset + 3);
      const b4 = requiredByte(bytes, dataOffset + 4);
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
    if (chunkType === "VP8 ") {
      if (
        chunkLength < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        throw new Error("The WebP VP8 frame header is invalid.");
      }
      return {
        width: readUint16LittleEndian(bytes, dataOffset + 6) & 0x3fff,
        height: readUint16LittleEndian(bytes, dataOffset + 8) & 0x3fff,
      };
    }
    offset = dataOffset + chunkLength + (chunkLength % 2);
  }
  throw new Error("The WebP does not contain a supported image frame.");
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (end > bytes.byteLength) {
    return "";
  }
  return String.fromCharCode(...bytes.subarray(start, end));
}

function requiredByte(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new Error("The image header is incomplete.");
  }
  return value;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (requiredByte(bytes, offset) << 8) | requiredByte(bytes, offset + 1);
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return requiredByte(bytes, offset) | (requiredByte(bytes, offset + 1) << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    requiredByte(bytes, offset) |
    (requiredByte(bytes, offset + 1) << 8) |
    (requiredByte(bytes, offset + 2) << 16)
  );
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    requiredByte(bytes, offset) * 0x1000000 +
    (requiredByte(bytes, offset + 1) << 16) +
    (requiredByte(bytes, offset + 2) << 8) +
    requiredByte(bytes, offset + 3)
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    requiredByte(bytes, offset) +
    (requiredByte(bytes, offset + 1) << 8) +
    (requiredByte(bytes, offset + 2) << 16) +
    requiredByte(bytes, offset + 3) * 0x1000000
  );
}
