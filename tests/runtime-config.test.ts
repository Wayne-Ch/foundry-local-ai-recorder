import { describe, expect, it } from "vitest";
import {
  AUDIO_EXECUTION_PROVIDER,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import {
  RuntimeConfigurationError,
  resolveRuntimeTargets,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";

describe("runtime configuration", () => {
  it("uses the exact validated defaults", () => {
    const targets = resolveRuntimeTargets({});
    expect(targets.whisper).toMatchObject({
      modelId: WHISPER_AUDIO_MODEL_ID,
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      stageValidated: true,
      source: "built_in_default",
    });
    expect(targets.nemotron).toMatchObject({
      modelId: NEMOTRON_AUDIO_MODEL_ID,
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      stageValidated: true,
      source: "built_in_default",
    });
    expect(targets.summary).toMatchObject({
      modelId: SUMMARY_MODEL_ID,
      executionProvider: SUMMARY_EXECUTION_PROVIDER,
      stageValidated: true,
      source: "built_in_default",
    });
  });

  it("requires model and provider overrides together", () => {
    expect(() => resolveRuntimeTargets({ AI_RECORDER_SUMMARY_MODEL_ID: "another-model:1" })).toThrow(
      RuntimeConfigurationError,
    );
  });

  it.each([
    {
      role: "whisper",
      environment: {
        AI_RECORDER_WHISPER_MODEL_ID: "another-whisper:1",
        AI_RECORDER_WHISPER_EXECUTION_PROVIDER: AUDIO_EXECUTION_PROVIDER,
      },
      expectedModel: WHISPER_AUDIO_MODEL_ID,
    },
    {
      role: "whisper",
      environment: {
        AI_RECORDER_WHISPER_MODEL_ID: WHISPER_AUDIO_MODEL_ID,
        AI_RECORDER_WHISPER_EXECUTION_PROVIDER: "DmlExecutionProvider",
      },
      expectedModel: WHISPER_AUDIO_MODEL_ID,
    },
    {
      role: "nemotron",
      environment: {
        AI_RECORDER_NEMOTRON_MODEL_ID: "another-nemotron:1",
        AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER: AUDIO_EXECUTION_PROVIDER,
      },
      expectedModel: NEMOTRON_AUDIO_MODEL_ID,
    },
    {
      role: "nemotron",
      environment: {
        AI_RECORDER_NEMOTRON_MODEL_ID: NEMOTRON_AUDIO_MODEL_ID,
        AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER: "DmlExecutionProvider",
      },
      expectedModel: NEMOTRON_AUDIO_MODEL_ID,
    },
    {
      role: "summary",
      environment: {
        AI_RECORDER_SUMMARY_MODEL_ID: "another-model:1",
        AI_RECORDER_SUMMARY_EXECUTION_PROVIDER: SUMMARY_EXECUTION_PROVIDER,
      },
      expectedModel: SUMMARY_MODEL_ID,
    },
    {
      role: "summary",
      environment: {
        AI_RECORDER_SUMMARY_MODEL_ID: SUMMARY_MODEL_ID,
        AI_RECORDER_SUMMARY_EXECUTION_PROVIDER: "DmlExecutionProvider",
      },
      expectedModel: SUMMARY_MODEL_ID,
    },
  ])("rejects a non-standard $role model or provider pair", ({ role, environment, expectedModel }) => {
    expect(() => resolveRuntimeTargets(environment)).toThrow(
      `The standard ${role} model must use ${expectedModel} with ${AUDIO_EXECUTION_PROVIDER}.`,
    );
  });

  it("accepts only explicit exact model/provider pairs", () => {
    const targets = resolveRuntimeTargets({
      AI_RECORDER_WHISPER_MODEL_ID: WHISPER_AUDIO_MODEL_ID,
      AI_RECORDER_WHISPER_EXECUTION_PROVIDER: AUDIO_EXECUTION_PROVIDER,
      AI_RECORDER_NEMOTRON_MODEL_ID: NEMOTRON_AUDIO_MODEL_ID,
      AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER: AUDIO_EXECUTION_PROVIDER,
      AI_RECORDER_SUMMARY_MODEL_ID: SUMMARY_MODEL_ID,
      AI_RECORDER_SUMMARY_EXECUTION_PROVIDER: SUMMARY_EXECUTION_PROVIDER,
    });
    expect(targets.whisper).toMatchObject({
      modelId: WHISPER_AUDIO_MODEL_ID,
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: true,
    });
    expect(targets.nemotron).toMatchObject({
      modelId: NEMOTRON_AUDIO_MODEL_ID,
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: true,
    });
    expect(targets.summary).toMatchObject({
      modelId: SUMMARY_MODEL_ID,
      executionProvider: SUMMARY_EXECUTION_PROVIDER,
      source: "environment_override",
      stageValidated: true,
    });
  });
});
