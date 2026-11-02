export type AssistantImageBytePurpose =
  | "selected-image"
  | "assistant-operation"
  | "native-request"
  | "picker-file"
  | "validated-image";

export interface AssistantImageByteLifecycle {
  copy(source: Uint8Array, purpose: AssistantImageBytePurpose): Uint8Array;
  release(bytes: Uint8Array, purpose: AssistantImageBytePurpose): void;
}

export const secureAssistantImageByteLifecycle: AssistantImageByteLifecycle = {
  copy: (source) => source.slice(),
  release: (bytes) => bytes.fill(0),
};
