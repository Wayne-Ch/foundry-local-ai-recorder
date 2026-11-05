import { stat as statFile } from "node:fs/promises";
import path from "node:path";
import type { AssistantLaneSnapshot } from "../assistant/assistant-types";
import {
  type AssistantImageByteLifecycle,
  secureAssistantImageByteLifecycle,
} from "../assistant/image-byte-lifecycle";
import type { PreparedAssistantInferenceImage } from "../assistant/image-inference";
import {
  declaredImageMimeType,
  MAX_IMAGE_BYTES,
  type ValidatedImage,
  validateImage,
} from "../assistant/image-security";

export interface AssistantImagePickerDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

export interface AssistantImagePickerDependencies {
  readonly showDialog: () => Promise<AssistantImagePickerDialogResult>;
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly createThumbnail: (image: ValidatedImage) => Promise<string>;
  readonly createInferenceImage: (image: ValidatedImage) => Promise<PreparedAssistantInferenceImage>;
  readonly stat?: (filePath: string) => Promise<{ readonly size: number }>;
  readonly imageByteLifecycle?: AssistantImageByteLifecycle;
}

export interface AssistantImagePickerGuard {
  assertCurrent(): void;
  commit(
    image: ValidatedImage,
    thumbnailDataUrl: string,
    inferenceImage: PreparedAssistantInferenceImage,
  ): AssistantLaneSnapshot;
}

export async function pickAssistantImage(
  dependencies: AssistantImagePickerDependencies,
  guard: AssistantImagePickerGuard,
): Promise<AssistantLaneSnapshot | null> {
  const imageByteLifecycle = dependencies.imageByteLifecycle ?? secureAssistantImageByteLifecycle;
  const result = await dependencies.showDialog();
  guard.assertCurrent();
  const filePath = result.filePaths[0];
  if (result.canceled || filePath === undefined) {
    return null;
  }

  let fileBytes: Uint8Array | null = null;
  let validatedBytes: Uint8Array | null = null;
  let inferenceBytes: Uint8Array | null = null;
  try {
    const file = await (dependencies.stat ?? statFile)(filePath);
    guard.assertCurrent();
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new Error("The selected image must be between 1 byte and 10 MiB.");
    }

    fileBytes = await dependencies.readFile(filePath);
    guard.assertCurrent();
    const basename = path.basename(filePath);
    const validated = validateImage({
      basename,
      declaredMimeType: declaredImageMimeType(basename),
      bytes: fileBytes,
    });
    validatedBytes = validated.bytes;
    guard.assertCurrent();

    const thumbnailDataUrl = await dependencies.createThumbnail(validated);
    guard.assertCurrent();
    const inferenceImage = await dependencies.createInferenceImage(validated);
    inferenceBytes = inferenceImage.bytes;
    guard.assertCurrent();
    return guard.commit(validated, thumbnailDataUrl, inferenceImage);
  } finally {
    if (fileBytes !== null) {
      imageByteLifecycle.release(fileBytes, "picker-file");
    }
    if (validatedBytes !== null) {
      imageByteLifecycle.release(validatedBytes, "validated-image");
    }
    if (inferenceBytes !== null) {
      imageByteLifecycle.release(inferenceBytes, "prepared-inference-image");
    }
  }
}
