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
    expect(() => resolveRuntimeTargets({ AI_RECORDER_SUMMARY_MODEL_ID: "another-model:1" })).toThrow(
      RuntimeConfigurationError,
    );
  });

  it("rejects a different standard summary model", () => {
    expect(() =>
      resolveRuntimeTargets({
        AI_RECORDER_SUMMARY_MODEL_ID: "another-model:1",
        AI_RECORDER_SUMMARY_EXECUTION_PROVIDER: "CPUExecutionProvider",
      }),
    ).toThrow(`The standard summary model must use ${SUMMARY_MODEL_ID}`);
  });

  it("accepts an explicit exact summary pair", () => {
    const targets = resolveRuntimeTargets({
      AI_RECORDER_SUMMARY_MODEL_ID: SUMMARY_MODEL_ID,
      AI_RECORDER_SUMMARY_EXECUTION_PROVIDER: SUMMARY_EXECUTION_PROVIDER,
    });
    expect(targets.summary).toMatchObject({
      modelId: SUMMARY_MODEL_ID,
      executionProvider: SUMMARY_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: true,
    });
  });
});
