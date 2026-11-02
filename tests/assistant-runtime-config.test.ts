import { DeviceType } from "foundry-local-sdk";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_EXECUTION_PROVIDER,
  resolveAssistantRuntimeTarget,
} from "../src/foundry/assistant-runtime-config";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "../src/foundry/optional-vision-chat-runtime";

describe("assistant runtime config", () => {
  it("uses the built-in Qwen GPU candidate only as an exact runtime target", () => {
    expect(resolveAssistantRuntimeTarget({})).toEqual({
      modelId: QWEN_VISION_CHAT_CANDIDATE_MODEL_ID,
      deviceType: DeviceType.GPU,
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

  it("accepts a complete CPU override without treating it as stage validated", () => {
    expect(
      resolveAssistantRuntimeTarget({
        SMART_RECORDER_VISION_MODEL_ID: "custom-vision-cpu:1",
        SMART_RECORDER_VISION_EXECUTION_PROVIDER: "CPUExecutionProvider",
        SMART_RECORDER_VISION_DEVICE_TYPE: "CPU",
      }),
    ).toEqual({
      modelId: "custom-vision-cpu:1",
      deviceType: DeviceType.CPU,
      executionProvider: "CPUExecutionProvider",
      source: "environment_override",
      stageValidated: false,
    });
  });
});
