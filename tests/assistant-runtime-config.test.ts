import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_EXECUTION_PROVIDER,
  resolveAssistantRuntimeTarget,
} from "../src/foundry/assistant-runtime-config";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";

describe("assistant runtime config", () => {
  it("uses the built-in Qwen CPU candidate only as an exact runtime target", () => {
    expect(resolveAssistantRuntimeTarget({})).toEqual({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      deviceType: DeviceType.CPU,
      executionProvider: ASSISTANT_EXECUTION_PROVIDER,
      source: "built_in_candidate",
      stageValidated: false,
    });
  });

  it("requires a complete exact override", () => {
    expect(() =>
      resolveAssistantRuntimeTarget({
        SMART_RECORDER_VISION_MODEL_ID: "custom:1",
      }),
    ).toThrow("must be set together");
  });

  it("accepts a complete GPU override without treating it as stage validated", () => {
    expect(
      resolveAssistantRuntimeTarget({
        SMART_RECORDER_VISION_MODEL_ID: "custom-vision-gpu:1",
        SMART_RECORDER_VISION_EXECUTION_PROVIDER: "WebGPUExecutionProvider",
        SMART_RECORDER_VISION_DEVICE_TYPE: "GPU",
      }),
    ).toEqual({
      modelId: "custom-vision-gpu:1",
      deviceType: DeviceType.GPU,
      executionProvider: "WebGPUExecutionProvider",
      source: "environment_override",
      stageValidated: false,
    });
  });
});
