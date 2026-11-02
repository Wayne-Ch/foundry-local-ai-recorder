import { DeviceType } from "foundry-local-sdk";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "./optional-vision-chat-runtime";
import { canonicalExecutionProvider, RuntimeConfigurationError } from "./runtime-config";

export const ASSISTANT_EXECUTION_PROVIDER = "WebGPUExecutionProvider";

export interface AssistantRuntimeTarget {
  readonly modelId: string;
  readonly deviceType: DeviceType;
  readonly executionProvider: string;
  readonly source: "built_in_candidate" | "environment_override";
  readonly stageValidated: false;
}

export function resolveAssistantRuntimeTarget(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AssistantRuntimeTarget {
  const modelId = environment.SMART_RECORDER_VISION_MODEL_ID?.trim();
  const provider = environment.SMART_RECORDER_VISION_EXECUTION_PROVIDER?.trim();
  const device = environment.SMART_RECORDER_VISION_DEVICE_TYPE?.trim();
  const configured = [modelId, provider, device].filter(Boolean).length;
  if (configured !== 0 && configured !== 3) {
    throw new RuntimeConfigurationError(
      "SMART_RECORDER_VISION_MODEL_ID, SMART_RECORDER_VISION_EXECUTION_PROVIDER, and SMART_RECORDER_VISION_DEVICE_TYPE must be set together.",
    );
  }
  if (modelId?.includes(" ") || provider?.includes(" ") || device?.includes(" ")) {
    throw new RuntimeConfigurationError("The vision/chat runtime override contains invalid whitespace.");
  }

  const resolvedModelId = modelId || QWEN_VISION_CHAT_CANDIDATE_MODEL_ID;
  const resolvedProvider = canonicalExecutionProvider(provider || ASSISTANT_EXECUTION_PROVIDER);
  const resolvedDevice = parseDeviceType(device || "GPU");
  return {
    modelId: resolvedModelId,
    deviceType: resolvedDevice,
    executionProvider: resolvedProvider,
    source: modelId ? "environment_override" : "built_in_candidate",
    stageValidated: false,
  };
}

function parseDeviceType(value: string): DeviceType {
  switch (value.toUpperCase()) {
    case "CPU":
      return DeviceType.CPU;
    case "GPU":
      return DeviceType.GPU;
    case "NPU":
      return DeviceType.NPU;
    default:
      throw new RuntimeConfigurationError("SMART_RECORDER_VISION_DEVICE_TYPE must be CPU, GPU, or NPU.");
  }
}
