export type AssistantImageBytePurpose =
  | "selected-image"
  | "selected-inference-image"
  | "assistant-operation"
  | "native-request"
  | "picker-file"
  | "validated-image"
  | "encoded-inference-image"
  | "prepared-inference-image";

export interface AssistantImageByteLifecycle {
  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array;
  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void;
}

export function copyToDetachedUint8Array(source: Uint8Array): Uint8Array {
  return Uint8Array.from(source);
}

export const secureAssistantImageByteLifecycle: AssistantImageByteLifecycle = {
  copy: (source) => copyToDetachedUint8Array(source),
  release: (bytes) => bytes.fill(0),
};
