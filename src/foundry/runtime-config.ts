import { DeviceType } from "foundry-local-sdk";
import {
  AUDIO_EXECUTION_PROVIDER,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../audio/audio-types";
import { QWEN_VISION_CHAT_CANDIDATE_MODEL_ID } from "./optional-vision-chat-runtime";

export const SUMMARY_MODEL_ID = QWEN_VISION_CHAT_CANDIDATE_MODEL_ID;
export const SUMMARY_DEVICE_TYPE = DeviceType.GPU;
export const SUMMARY_EXECUTION_PROVIDER = "WebGPUExecutionProvider";
const CANONICAL_WEBGPU_EXECUTION_PROVIDER = SUMMARY_EXECUTION_PROVIDER;

export type ModelRole = "whisper" | "nemotron" | "summary";

export interface RuntimeTarget {
  readonly role: ModelRole;
  readonly modelId: string;
  readonly deviceType: DeviceType;
  readonly executionProvider: string;
  readonly source: "built_in_default" | "environment_override";
  readonly stageValidated: boolean;
}

export interface RuntimeTargets {
  readonly whisper: RuntimeTarget;
  readonly nemotron: RuntimeTarget;
  readonly summary: RuntimeTarget;
}

const targetDefinitions = {
  whisper: {
    modelId: WHISPER_AUDIO_MODEL_ID,
    deviceType: DeviceType.CPU,
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    modelVariable: "ENHANCED_AI_RECORDER_WHISPER_MODEL_ID",
    providerVariable: "ENHANCED_AI_RECORDER_WHISPER_EXECUTION_PROVIDER",
  },
  nemotron: {
    modelId: NEMOTRON_AUDIO_MODEL_ID,
    deviceType: DeviceType.CPU,
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    modelVariable: "ENHANCED_AI_RECORDER_NEMOTRON_MODEL_ID",
    providerVariable: "ENHANCED_AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER",
  },
  summary: {
    modelId: SUMMARY_MODEL_ID,
    deviceType: SUMMARY_DEVICE_TYPE,
    executionProvider: SUMMARY_EXECUTION_PROVIDER,
    modelVariable: "ENHANCED_AI_RECORDER_SUMMARY_MODEL_ID",
    providerVariable: "ENHANCED_AI_RECORDER_SUMMARY_EXECUTION_PROVIDER",
  },
} as const;

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

export function canonicalExecutionProvider(name: string): string {
  const trimmed = name.trim();
  return trimmed === "WebGpuExecutionProvider" || trimmed === "WebGPUExecutionProvider"
    ? CANONICAL_WEBGPU_EXECUTION_PROVIDER
    : trimmed;
}

export function resolveRuntimeTargets(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeTargets {
  return {
    whisper: resolveTarget("whisper", environment),
    nemotron: resolveTarget("nemotron", environment),
    summary: resolveTarget("summary", environment),
  };
}

function resolveTarget(
  role: keyof typeof targetDefinitions,
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeTarget {
  const definition = targetDefinitions[role];
  const modelId = environment[definition.modelVariable]?.trim();
  const provider = environment[definition.providerVariable]?.trim();
  if ((modelId && !provider) || (!modelId && provider)) {
    throw new RuntimeConfigurationError(
      `${definition.modelVariable} and ${definition.providerVariable} must be set together.`,
    );
  }
  if (modelId?.includes(" ") || provider?.includes(" ")) {
    throw new RuntimeConfigurationError(`The ${role} runtime override contains invalid whitespace.`);
  }
  const resolvedModelId = modelId || definition.modelId;
  const resolvedProvider = canonicalExecutionProvider(provider || definition.executionProvider);
  if (
    role === "summary" &&
    (resolvedModelId !== SUMMARY_MODEL_ID || resolvedProvider !== SUMMARY_EXECUTION_PROVIDER)
  ) {
    throw new RuntimeConfigurationError(
      `The shared summary and assistant model must use ${SUMMARY_MODEL_ID} with ${SUMMARY_EXECUTION_PROVIDER}.`,
    );
  }
  return {
    role,
    modelId: resolvedModelId,
    deviceType: definition.deviceType,
    executionProvider: resolvedProvider,
    source: modelId ? "environment_override" : "built_in_default",
    stageValidated:
      resolvedModelId === definition.modelId &&
      resolvedProvider === canonicalExecutionProvider(definition.executionProvider),
  };
}
