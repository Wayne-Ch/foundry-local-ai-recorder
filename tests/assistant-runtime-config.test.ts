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

  it("accepts only a complete override that preserves the exact CPU assistant slot", () => {
    expect(
      resolveAssistantRuntimeTarget({
        SMART_RECORDER_VISION_MODEL_ID: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
        SMART_RECORDER_VISION_EXECUTION_PROVIDER: ASSISTANT_EXECUTION_PROVIDER,
        SMART_RECORDER_VISION_DEVICE_TYPE: "CPU",
      }),
    ).toEqual({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      deviceType: DeviceType.CPU,
      executionProvider: ASSISTANT_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: false,
    });
    expect(() =>
      resolveAssistantRuntimeTarget({
        SMART_RECORDER_VISION_MODEL_ID: "custom-vision-gpu:1",
        SMART_RECORDER_VISION_EXECUTION_PROVIDER: "WebGPUExecutionProvider",
        SMART_RECORDER_VISION_DEVICE_TYPE: "GPU",
      }),
    ).toThrow("must use");
  });
});
