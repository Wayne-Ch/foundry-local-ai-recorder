import { describe, expect, it } from "vitest";
import {
  AUDIO_EXECUTION_PROVIDER,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import {
  type RuntimeTarget,
  resolveRuntimeTargets,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";
import {
  coreModelsReady,
  modelReadinessPresentation,
  preparedModelCount,
} from "../src/renderer/model-readiness";
import type { ModelReadiness, RuntimeReadiness } from "../src/shared/contracts";

const targets = resolveRuntimeTargets({});

describe("model readiness presentation", () => {
  it("reports complete readiness only for the exact built-in standard stack", () => {
    const readiness = standardReadiness();

    expect(coreModelsReady(readiness)).toBe(true);
    expect(preparedModelCount(readiness)).toBe(3);
    expect(modelReadinessPresentation(readiness.whisper)).toEqual({
      label: "READY",
      status: "ready",
    });
  });

  it.each(["whisper", "nemotron", "summary"] as const)(
    "never presents an environment %s override as standard READY",
    (role) => {
      const readiness = standardReadiness();
      const overridden = {
        ...readiness,
        [role]: {
          ...readiness[role],
          target: {
            ...readiness[role].target,
            source: "environment_override",
          },
        },
      } satisfies Pick<RuntimeReadiness, "whisper" | "nemotron" | "summary">;

      expect(modelReadinessPresentation(overridden[role])).toEqual({
        label: "CONFIG ERROR",
        status: "error",
      });
      expect(preparedModelCount(overridden)).toBe(2);
      if (role !== "nemotron") {
        expect(coreModelsReady(overridden)).toBe(false);
      }
    },
  );
});

function standardReadiness(): Pick<RuntimeReadiness, "whisper" | "nemotron" | "summary"> {
  return {
    whisper: readyModel(targets.whisper, WHISPER_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    nemotron: readyModel(targets.nemotron, NEMOTRON_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    summary: readyModel(targets.summary, SUMMARY_MODEL_ID, SUMMARY_EXECUTION_PROVIDER),
  };
}

function readyModel(target: RuntimeTarget, id: string, executionProvider: string): ModelReadiness {
  return {
    target,
    model: {
      role: target.role,
      id,
      alias: id.split(":")[0] ?? id,
      deviceType: "CPU",
      executionProvider,
      fileSizeMb: 100,
    },
    status: "ready",
    detail: "ready",
    cached: true,
    loaded: true,
  };
}
