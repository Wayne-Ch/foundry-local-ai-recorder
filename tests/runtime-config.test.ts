import { describe, expect, it } from "vitest";
import {
  RuntimeConfigurationError,
  resolveRuntimeTargets,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";

describe("runtime configuration", () => {
  it("uses the exact validated defaults", () => {
    const targets = resolveRuntimeTargets({});
    expect(targets.summary).toMatchObject({
      modelId: SUMMARY_MODEL_ID,
      executionProvider: SUMMARY_EXECUTION_PROVIDER,
      stageValidated: true,
      source: "built_in_default",
    });
    expect(targets.whisper.stageValidated).toBe(true);
    expect(targets.nemotron.stageValidated).toBe(true);
  });

  it("requires model and provider overrides together", () => {
    expect(() => resolveRuntimeTargets({ SMART_RECORDER_SUMMARY_MODEL_ID: "another-model:1" })).toThrow(
      RuntimeConfigurationError,
    );
  });

  it("labels explicit overrides as unvalidated without silently replacing them", () => {
    const targets = resolveRuntimeTargets({
      SMART_RECORDER_SUMMARY_MODEL_ID: "another-model:1",
      SMART_RECORDER_SUMMARY_EXECUTION_PROVIDER: "CPUExecutionProvider",
    });
    expect(targets.summary).toMatchObject({
      modelId: "another-model:1",
      executionProvider: "CPUExecutionProvider",
      source: "environment_override",
      stageValidated: false,
    });
  });
});
