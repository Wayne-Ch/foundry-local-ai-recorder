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

  it("rejects a different shared summary and assistant model", () => {
    expect(() =>
      resolveRuntimeTargets({
        SMART_RECORDER_SUMMARY_MODEL_ID: "another-model:1",
        SMART_RECORDER_SUMMARY_EXECUTION_PROVIDER: "CPUExecutionProvider",
      }),
    ).toThrow("shared summary and assistant model");
  });

  it("accepts an explicit exact shared-model override", () => {
    const targets = resolveRuntimeTargets({
      SMART_RECORDER_SUMMARY_MODEL_ID: SUMMARY_MODEL_ID,
      SMART_RECORDER_SUMMARY_EXECUTION_PROVIDER: SUMMARY_EXECUTION_PROVIDER,
    });
    expect(targets.summary).toMatchObject({
      modelId: SUMMARY_MODEL_ID,
      executionProvider: SUMMARY_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: true,
    });
  });
});
