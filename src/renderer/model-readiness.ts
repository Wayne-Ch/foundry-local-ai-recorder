import { isStandardRuntimeTarget } from "../foundry/runtime-config";
import type { ModelReadiness, RuntimeReadiness } from "../shared/contracts";

type ModelReadinessSet = Pick<RuntimeReadiness, "whisper" | "nemotron" | "summary">;

export interface ModelReadinessPresentation {
  readonly label: string;
  readonly status: ModelReadiness["status"];
}

export function modelReadinessPresentation(readiness: ModelReadiness): ModelReadinessPresentation {
  if (readiness.status === "ready" && !isStandardModelReady(readiness)) {
    return {
      label: "CONFIG ERROR",
      status: "error",
    };
  }
  return {
    label: stateLabel(readiness.status),
    status: readiness.status,
  };
}

export function coreModelsReady(readiness: ModelReadinessSet): boolean {
  return isStandardModelReady(readiness.whisper) && isStandardModelReady(readiness.summary);
}

export function preparedModelCount(readiness: ModelReadinessSet): number {
  return [readiness.whisper, readiness.nemotron, readiness.summary].filter(isStandardModelReady).length;
}

function isStandardModelReady(readiness: ModelReadiness): boolean {
  return (
    readiness.status === "ready" &&
    readiness.target.source === "built_in_default" &&
    isStandardRuntimeTarget(readiness.target) &&
    readiness.model?.id === readiness.target.modelId &&
    readiness.model.executionProvider === readiness.target.executionProvider
  );
}

function stateLabel(status: ModelReadiness["status"]): string {
  return status.replaceAll("_", " ").toUpperCase();
}
