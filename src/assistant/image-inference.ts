import { type AssistantImageByteLifecycle, secureAssistantImageByteLifecycle } from "./image-byte-lifecycle";
import { type ValidatedImage, validateImage } from "./image-security";

export const MAX_ASSISTANT_INFERENCE_IMAGE_EDGE = 384;

export interface AssistantInferenceImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface AssistantImagePngTranscodeResult {
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export type AssistantImagePngTranscoder = (
  source: Uint8Array,
  target: AssistantInferenceImageDimensions,
) => AssistantImagePngTranscodeResult;

export interface PreparedAssistantInferenceImage extends AssistantInferenceImageDimensions {
  readonly mimeType: "image/png";
  readonly format: "png";
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

export function assistantInferenceImageDimensions(
  width: number,
  height: number,
): AssistantInferenceImageDimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Assistant inference image dimensions must be positive integers.");
  }
  const scale = Math.min(
    1,
    MAX_ASSISTANT_INFERENCE_IMAGE_EDGE / width,
    MAX_ASSISTANT_INFERENCE_IMAGE_EDGE / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function prepareAssistantInferenceImage(
  image: ValidatedImage,
  transcodeToPng: AssistantImagePngTranscoder,
  imageByteLifecycle: AssistantImageByteLifecycle = secureAssistantImageByteLifecycle,
): PreparedAssistantInferenceImage {
  const target = assistantInferenceImageDimensions(image.width, image.height);
  const transcoded = transcodeToPng(image.bytes, target);
  if (transcoded.bytes.buffer === image.bytes.buffer) {
    throw new Error("The inference PNG encoder must return separately owned bytes.");
  }

  let encodedBytes: Uint8Array | null = transcoded.bytes;
  let validatedBytes: Uint8Array | null = null;
  let completed = false;
  try {
    if (transcoded.decodedWidth !== image.width || transcoded.decodedHeight !== image.height) {
      throw new Error("The decoded image dimensions do not match the validated source header.");
    }
    if (transcoded.width !== target.width || transcoded.height !== target.height) {
      throw new Error("The inference PNG dimensions do not match the bounded resize target.");
    }
    if (encodedBytes.byteLength === 0) {
      throw new Error("The inference PNG encoder returned no bytes.");
    }

    const validated = validateImage({
      basename: "assistant-inference.png",
      declaredMimeType: "image/png",
      bytes: encodedBytes,
    });
    validatedBytes = validated.bytes;
    if (
      validated.mimeType !== "image/png" ||
      validated.width !== target.width ||
      validated.height !== target.height ||
      Math.max(validated.width, validated.height) > MAX_ASSISTANT_INFERENCE_IMAGE_EDGE
    ) {
      throw new Error("The encoded inference image failed the bounded PNG validation.");
    }

    completed = true;
    return {
      mimeType: "image/png",
      format: "png",
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      bytes: validated.bytes,
    };
  } finally {
    if (encodedBytes !== null) {
      imageByteLifecycle.release(encodedBytes, "encoded-inference-image");
      encodedBytes = null;
    }
    if (!completed && validatedBytes !== null) {
      imageByteLifecycle.release(validatedBytes, "prepared-inference-image");
    }
  }
}
