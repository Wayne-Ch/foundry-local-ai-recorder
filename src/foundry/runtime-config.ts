import {
  AUDIO_EXECUTION_PROVIDER,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../audio/audio-types";

export const SUMMARY_MODEL_ID = "qwen3-0.6b-generic-gpu:2";
export const SUMMARY_EXECUTION_PROVIDER = "WebGPUExecutionProvider";

export type ModelRole = "whisper" | "nemotron" | "summary";

export interface RuntimeTarget {
  readonly role: ModelRole;
  readonly modelId: string;
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
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    modelVariable: "SMART_RECORDER_WHISPER_MODEL_ID",
    providerVariable: "SMART_RECORDER_WHISPER_EXECUTION_PROVIDER",
  },
  nemotron: {
    modelId: NEMOTRON_AUDIO_MODEL_ID,
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    modelVariable: "SMART_RECORDER_NEMOTRON_MODEL_ID",
    providerVariable: "SMART_RECORDER_NEMOTRON_EXECUTION_PROVIDER",
  },
  summary: {
    modelId: SUMMARY_MODEL_ID,
    executionProvider: SUMMARY_EXECUTION_PROVIDER,
    modelVariable: "SMART_RECORDER_SUMMARY_MODEL_ID",
    providerVariable: "SMART_RECORDER_SUMMARY_EXECUTION_PROVIDER",
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
    ? SUMMARY_EXECUTION_PROVIDER
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
  return {
    role,
    modelId: resolvedModelId,
    executionProvider: resolvedProvider,
    source: modelId ? "environment_override" : "built_in_default",
    stageValidated:
      resolvedModelId === definition.modelId &&
      resolvedProvider === canonicalExecutionProvider(definition.executionProvider),
  };
}
