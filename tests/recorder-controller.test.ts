import type { RequestPreflightResult, Response } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import { encodePcm16Wav } from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioPartialTranscriptEvent,
  type AudioTranscriptionResult,
  NEMOTRON_AUDIO_MODEL_ID,
  type ValidatedAudioCapture,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import type { PrepareRuntimeResult, SummaryGenerationResult } from "../src/foundry/foundry-runtime";
import {
  type RuntimeTargets,
  resolveRuntimeTargets,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";
import type { RecorderOperationJournal, RecorderOperationJournalEvent } from "../src/main/operation-journal";
import { RecorderController, type RecorderRuntime } from "../src/main/recorder-controller";
import {
  createPopulatedSummaryCaptureSnapshot,
  POPULATED_SUMMARY_CAPTURE_FORMATTED,
  POPULATED_SUMMARY_CAPTURE_RAW,
} from "../src/main/ui-capture-fixture";
import type { PrepareProgressEvent, RuntimeReadiness } from "../src/shared/contracts";
import { formatSafeDiagnostic, toSafeDiagnostic } from "../src/shared/safe-diagnostic";
import { formatSummaryPresentation } from "../src/summary/summary-format";

const targets = resolveRuntimeTargets({});

class FakeRuntime implements RecorderRuntime {
  readonly readiness: RuntimeReadiness;
  summaryInput = "";
  summaryFinishReason = "stop";
  lastCapture: ValidatedAudioCapture | null = null;

  constructor(
    readonly finalTranscript = "Whisper authoritative final transcript.",
    readonly transcriptionError: Error | null = null,
    readonly summaryText = summaryJson("Overview.", [
      "First fact.",
      "Second fact.",
      "Third fact.",
      "Fourth fact.",
    ]),
    runtimeTargets: RuntimeTargets = targets,
  ) {
    this.readiness = runtimeReadiness(runtimeTargets);
  }

  get cleanupCompletion(): Promise<void> | null {
    return null;
  }

  async prepare(
    _enableLiveCaptions: boolean,
    onProgress?: (event: PrepareProgressEvent) => void,
  ): Promise<PrepareRuntimeResult> {
    for (const role of ["whisper", "nemotron", "summary"] as const) {
      onProgress?.({
        operation: "prepare",
        phase: `${role}:checking_catalog`,
        stage: "checking_catalog",
        role,
        detail: `Checking the exact ${role} model in the public catalog.`,
        readiness: this.readiness,
      });
    }
    return {
      readiness: this.readiness,
      liveCaptionsAvailable: true,
      liveCaptionsFailure: null,
    };
  }

  async startLiveStream(onPartial: (event: AudioPartialTranscriptEvent) => void): Promise<{
    readonly streamId: string;
    readonly model: AudioTranscriptionResult["model"];
    readonly mode: "nemotron_streaming";
  }> {
    onPartial({
      streamId: "11111111-1111-4111-8111-111111111111",
      sequence: 0,
      text: "live partial must never summarize",
      firstPartialMs: 220,
      model: audioIdentity(NEMOTRON_AUDIO_MODEL_ID, true),
      mode: "nemotron_streaming",
      externalEndpointUsed: false,
    });
    return {
      streamId: "11111111-1111-4111-8111-111111111111",
      model: audioIdentity(NEMOTRON_AUDIO_MODEL_ID, true),
      mode: "nemotron_streaming",
    };
  }

  appendLiveChunk() {
    return { acceptedSequence: 0, totalBytes: 3_200 };
  }

  async finishLiveStream(): Promise<AudioTranscriptionResult> {
    return transcription(
      "Nemotron terminal must never summarize.",
      NEMOTRON_AUDIO_MODEL_ID,
      "nemotron_streaming",
      "live_stream_final",
    );
  }

  async cancelLiveStream(): Promise<void> {}

  async transcribeCapture(capture: ValidatedAudioCapture): Promise<AudioTranscriptionResult> {
    this.lastCapture = capture;
    if (this.transcriptionError !== null) {
      throw this.transcriptionError;
    }
    return transcription(this.finalTranscript, WHISPER_AUDIO_MODEL_ID, "whisper_file", "whisper_file_final");
  }

  async summarize(transcript: string): Promise<SummaryGenerationResult> {
    this.summaryInput = transcript;
    return {
      text: this.summaryText,
      durationMs: 800,
      model: {
        role: "summary",
        id: SUMMARY_MODEL_ID,
        alias: "qwen3.5-0.8b",
        deviceType: "GPU",
        executionProvider: SUMMARY_EXECUTION_PROVIDER,
        fileSizeMb: 600,
      },
      preflight: preflight(),
      finishReason: this.summaryFinishReason,
      response: response(this.summaryText, this.summaryFinishReason),
    };
  }

  async reset(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

describe("RecorderController", () => {
  it("writes secret-safe correlated Prepare lifecycle events", async () => {
    const events: RecorderOperationJournalEvent[] = [];
    const journal: RecorderOperationJournal = {
      record: (event) => events.push(event),
      flush: async () => {},
    };
    const controller = new RecorderController(new FakeRuntime(), journal);

    await controller.prepare({ enableLiveCaptions: true });

    const start = events.find((event) => event.operation === "prepare" && event.status === "start");
    const complete = events.find((event) => event.operation === "prepare" && event.status === "complete");
    expect(start).toMatchObject({
      generation: 0,
      enableLiveCaptions: true,
    });
    expect(complete).toMatchObject({
      correlationId: start?.correlationId,
      generation: 0,
    });
    expect(
      events.find(
        (event) =>
          event.operation === "prepare" && event.status === "progress" && event.modelRole === "summary",
      ),
    ).toMatchObject({
      modelRole: "summary",
      modelSource: "built_in_default",
      modelId: SUMMARY_MODEL_ID,
    });
    expect(JSON.stringify(events)).not.toContain("C:\\models");
  });

  it.each([
    ["URL", "https://user:password@example.invalid/model?token=fake-secret"],
    ["Windows path", "C:\\Users\\private-user\\models\\private-model.onnx"],
    ["credential", "fake-user:fake-password@example.invalid/model"],
    ["token", "token_fake_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  ])("never persists a raw %s-shaped model override", async (_label, modelId) => {
    const events: RecorderOperationJournalEvent[] = [];
    const targetsWithOverride = resolveRuntimeTargets({
      ENHANCED_AI_RECORDER_WHISPER_MODEL_ID: modelId,
      ENHANCED_AI_RECORDER_WHISPER_EXECUTION_PROVIDER: AUDIO_EXECUTION_PROVIDER,
    });
    const controller = new RecorderController(
      new FakeRuntime(undefined, undefined, undefined, targetsWithOverride),
      {
        record: (event) => events.push(event),
        flush: async () => {},
      },
    );

    await controller.prepare({ enableLiveCaptions: false });

    const progress = events.find(
      (event) =>
        event.operation === "prepare" && event.status === "progress" && event.modelRole === "whisper",
    );
    expect(progress).toMatchObject({
      modelRole: "whisper",
      modelSource: "environment_override",
      modelRef: expect.stringMatching(/^override:whisper:[a-f0-9]{12}$/),
    });
    expect(progress).not.toHaveProperty("modelId");
    expect(JSON.stringify(events)).not.toContain(modelId);
  });

  it("persists the Reset terminal event before Shutdown can complete", async () => {
    class ResetRaceRuntime extends FakeRuntime {
      readonly resetGate = deferred<void>();
      readonly shutdownGate = deferred<void>();

      override get cleanupCompletion(): Promise<void> {
        return this.resetGate.promise;
      }

      override reset(): Promise<void> {
        return this.resetGate.promise;
      }

      override shutdown(): Promise<void> {
        return this.shutdownGate.promise;
      }
    }

    const runtime = new ResetRaceRuntime();
    const persisted: RecorderOperationJournalEvent[] = [];
    let tail = Promise.resolve();
    const controller = new RecorderController(runtime, {
      record(event) {
        tail = tail.then(() => {
          persisted.push(event);
        });
      },
      flush: () => tail,
    });

    const reset = controller.reset();
    const shutdown = controller.shutdown();
    runtime.shutdownGate.resolve();
    let shutdownSettled = false;
    void shutdown.then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    runtime.resetGate.resolve();
    await reset;
    await shutdown;

    expect(
      persisted
        .filter((event) => event.operation === "reset" || event.operation === "shutdown")
        .map((event) => `${event.operation}:${event.status}`),
    ).toEqual(["reset:start", "shutdown:start", "reset:complete", "shutdown:complete"]);
  });

  it("journals a failed Reset without emitting an unhandled cleanup rejection", async () => {
    class RejectingResetRuntime extends FakeRuntime {
      readonly resetGate = deferred<void>();

      override get cleanupCompletion(): Promise<void> {
        return this.resetGate.promise;
      }

      override reset(): Promise<void> {
        return this.resetGate.promise;
      }
    }

    const runtime = new RejectingResetRuntime();
    const persisted: RecorderOperationJournalEvent[] = [];
    let tail = Promise.resolve();
    let flushCount = 0;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const controller = new RecorderController(runtime, {
        record(event) {
          tail = tail.then(() => {
            persisted.push(event);
          });
        },
        async flush() {
          await tail;
          flushCount += 1;
        },
      });
      const failure = new Error("Reset cleanup failed.");

      const reset = controller.reset();
      expect(controller.reset()).toBe(reset);
      runtime.resetGate.reject(failure);

      await expect(reset).rejects.toBe(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(
        persisted
          .filter((event) => event.operation === "reset")
          .map((event) => `${event.operation}:${event.status}`),
      ).toEqual(["reset:start", "reset:fail"]);
      expect(persisted.find((event) => event.operation === "reset" && event.status === "fail")).toMatchObject(
        {
          diagnostic: {
            code: "LOCAL_OPERATION_FAILED",
            name: "Error",
          },
        },
      );
      expect(flushCount).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("rejects an imported WAV selected before Reset", async () => {
    const controller = new RecorderController(new FakeRuntime());
    const token = controller.captureOperationToken();
    await controller.reset();

    await expect(
      controller.transcribeImportedWav("fixture.wav", encodePcm16Wav(new Uint8Array(3_200)), token),
    ).rejects.toThrow("cancelled");
  });

  it("summarizes the exact Whisper final and excludes all Nemotron text", async () => {
    const runtime = new FakeRuntime();
    const controller = new RecorderController(runtime);
    await controller.prepare({ enableLiveCaptions: true });
    await controller.startLiveStream(
      {
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        maxDurationMs: AUDIO_MAX_DURATION_MS,
      },
      () => {},
    );
    expect(controller.bootstrap().transcript.liveDraft).toContain("live partial");

    await controller.finishLiveStream({
      streamId: "11111111-1111-4111-8111-111111111111",
      lastSequence: 0,
      audioDurationMs: 1_000,
    });
    await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
    });
    const summary = await controller.generateSummary();

    expect(runtime.summaryInput).toBe("Whisper authoritative final transcript.");
    expect(runtime.summaryInput).not.toContain("live partial");
    expect(runtime.summaryInput).not.toContain("Nemotron terminal");
    expect(summary.summaryInput).toBe(runtime.summaryInput);
    expect(summary.snapshot.transcript.summary?.transcriptVersion).toBe(1);
  });

  it("stores formatted summary text and preserves the exact raw Qwen response in trace evidence", async () => {
    const raw = summaryJson(String.raw`Keep C:\times\reports and \cdot literal.`, [
      String.raw`The solution is expressed as $ y(t) = c \\cdot e^{-2t}} $, where $ c $ is the initial constant.`,
      "The equation remains first order.",
      "The behavior is exponential decay.",
      "The initial condition determines the constant.",
    ]);
    const runtime = new FakeRuntime("Whisper authoritative final transcript.", null, raw);
    const controller = new RecorderController(runtime);

    await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
    });
    const summary = await controller.generateSummary();

    expect(summary.snapshot.transcript.summary?.text).toBe(
      [
        String.raw`Keep C:\times\reports and \cdot literal.`,
        "• The solution is expressed as y(t) = c · e^(−2t), where c is the initial constant.",
        "• The equation remains first order.",
        "• The behavior is exponential decay.",
        "• The initial condition determines the constant.",
      ].join("\n"),
    );
    expect(summary.snapshot.trace.find((entry) => entry.phase === "summary-raw")).toMatchObject({
      detail: raw,
      summaryDisplayFormattingApplied: true,
    });
  });

  it.each([
    {
      name: "malformed output",
      raw: "Only one summary line.",
      expectedError: "invalid structured output",
      finishReason: "stop" as const,
    },
    ...[1, 2, 3, 5].map((detailCount) => ({
      name: `${detailCount}-detail output`,
      raw: summaryJson(
        "Project Atlas records explicit facts.",
        Array.from({ length: detailCount }, (_value, index) => `Detail ${index + 1}.`),
      ),
      expectedError: "invalid structured output",
      finishReason: "stop" as const,
    })),
    {
      name: "canonically duplicated detail",
      raw: summaryJson("Project Atlas records explicit facts.", [
        "The target remains 250 milliseconds.",
        "Maya Chen owns the follow-up.",
        "THE TARGET REMAINS 250 MILLISECONDS!",
        "The next review is November 12.",
      ]),
      expectedError: "repeated an overview or detail fact",
      finishReason: "stop" as const,
    },
    {
      name: "incomplete final bullet",
      raw: summaryJson("Project Atlas records the cache observation.", [
        "The target remains 250 milliseconds.",
        "Maya Chen owns the follow-up.",
        "The next review is November 12.",
        "The cache change was",
      ]),
      expectedError: "incomplete line",
      finishReason: "stop" as const,
    },
    ...["length", "none", "toolCalls", "error"].map((finishReason) => ({
      name: `${finishReason}-finished output`,
      raw: summaryJson("Project Atlas records the cache observation.", [
        "The target remains 250 milliseconds.",
        "Maya Chen owns the follow-up.",
        "The next review is November 12.",
        "The local model cache is enabled.",
      ]),
      expectedError: `ended with ${finishReason}`,
      finishReason,
    })),
    {
      name: "unknown-finished output",
      raw: summaryJson("Project Atlas records the cache observation.", [
        "The target remains 250 milliseconds.",
        "Maya Chen owns the follow-up.",
        "The next review is November 12.",
        "The local model cache is enabled.",
      ]),
      expectedError: "ended with unknown",
      finishReason: "private-path-C:\\Users\\someone\\secret",
    },
  ])("traces raw $name but stores no summary", async ({ raw, expectedError, finishReason }) => {
    const runtime = new FakeRuntime("Whisper authoritative final transcript.", null, raw);
    runtime.summaryFinishReason = finishReason;
    const controller = new RecorderController(runtime);
    await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
    });

    await expect(controller.generateSummary()).rejects.toThrow(expectedError);
    const snapshot = controller.bootstrap();
    expect(snapshot.transcript.summary).toBeNull();
    expect(snapshot.trace.find((entry) => entry.phase === "summary-raw")).toMatchObject({
      detail: raw,
    });
    expect(snapshot.trace.some((entry) => entry.phase === "summary-final" && entry.severity === "info")).toBe(
      false,
    );
  });

  it("builds deterministic populated-summary UI evidence from the exact raw and formatted pair", () => {
    const snapshot = createPopulatedSummaryCaptureSnapshot(
      new RecorderController(new FakeRuntime()).bootstrap(),
    );

    expect(formatSummaryPresentation(POPULATED_SUMMARY_CAPTURE_RAW)).toEqual({
      text: POPULATED_SUMMARY_CAPTURE_FORMATTED,
      formattingApplied: true,
    });
    expect(snapshot.transcript.finalText).toContain("ordinary differential equation");
    expect(snapshot.transcript.summary?.text).toBe(POPULATED_SUMMARY_CAPTURE_FORMATTED);
    expect(snapshot.transcript.summary?.text).toContain("y′ = −2y");
    expect(snapshot.transcript.summary?.text).toContain("e^(−2t)");
    expect(snapshot.trace).toEqual([
      expect.objectContaining({
        phase: "summary-raw",
        detail: POPULATED_SUMMARY_CAPTURE_RAW,
        summaryDisplayFormattingApplied: true,
      }),
    ]);
  });

  it("uses the same summary formatter after imported WAV transcription", async () => {
    const raw = summaryJson("It describes $ y' = -2y $.", [
      String.raw`The solution is $ y(t) = c \cdot e^{-2t}} $.`,
      "The equation is first order.",
      "The behavior is decay.",
      "The constant is c.",
    ]);
    const runtime = new FakeRuntime("Imported Whisper final.", null, raw);
    const controller = new RecorderController(runtime);
    const wav = encodePcm16Wav(new Uint8Array(32_000));
    const stages: string[] = [];

    await controller.transcribeImportedWav("fixture.wav", wav, controller.captureOperationToken(), (stage) =>
      stages.push(stage),
    );
    const summary = await controller.generateSummary();

    expect(stages).toEqual(["decoding_audio", "transcribing"]);
    expect(runtime.summaryInput).toBe("Imported Whisper final.");
    expect(summary.snapshot.transcript.summary?.text).toBe(
      [
        "It describes y′ = −2y.",
        "• The solution is y(t) = c · e^(−2t).",
        "• The equation is first order.",
        "• The behavior is decay.",
        "• The constant is c.",
      ].join("\n"),
    );
  });

  it("invalidates the summary when the final transcript is corrected", async () => {
    const runtime = new FakeRuntime();
    const controller = new RecorderController(runtime);
    await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
    });
    await controller.generateSummary();
    const edited = controller.editTranscript("Corrected authoritative final.");
    expect(edited.transcript.version).toBe(2);
    expect(edited.transcript.summary).toBeNull();
  });

  it("preserves an exact Whisper transcript through controller summary submission", async () => {
    const exact = "  Line one.\r\nLine  two — café 東京!\n\nPunctuation: “yes?”  ";
    const runtime = new FakeRuntime(exact);
    const controller = new RecorderController(runtime);

    const final = await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
    });
    const summary = await controller.generateSummary();

    expect(final.result.transcript).toBe(exact);
    expect(final.snapshot.transcript.finalText).toBe(exact);
    expect(runtime.summaryInput).toBe(exact);
    expect(summary.summaryInput).toBe(exact);
  });

  it("retains a warning trace when Whisper succeeds after live captions fail", async () => {
    const runtime = new FakeRuntime();
    const controller = new RecorderController(runtime);

    const final = await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
      liveCaptionFailure: toSafeDiagnostic("chunk IPC failed", "OPTIONAL_LIVE_FAILED"),
    });

    expect(final.snapshot.transcript.finalText).toBe("Whisper authoritative final transcript.");
    expect(final.snapshot.trace).toContainEqual(
      expect.objectContaining({
        phase: "live-caption-warning",
        severity: "warning",
        detail:
          "Whisper final succeeded; Optional live captions failed; Whisper audio remains authoritative. [OPTIONAL_LIVE_FAILED/UnknownError; details omitted]",
      }),
    );

    const reset = await controller.reset();
    expect(reset.trace.some((entry) => entry.phase === "live-caption-warning")).toBe(false);
  });

  it("retains both live-caption and Whisper failures in the developer trace", async () => {
    const rawWhisperError =
      "Whisper failed at C:\\Users\\Jane Doe\\private recording.wav and /home/Jane Doe/private.wav";
    const runtime = new FakeRuntime("unused", new Error(rawWhisperError));
    const controller = new RecorderController(runtime);

    await expect(
      controller.transcribeCapture({
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        durationMs: 1_000,
        data: new ArrayBuffer(32_000),
        liveCaptionFailure: toSafeDiagnostic("chunk IPC failed", "OPTIONAL_LIVE_FAILED"),
      }),
    ).rejects.toThrow(rawWhisperError);

    const trace = controller.bootstrap().trace;
    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "live-caption-warning",
          severity: "warning",
          detail:
            "Whisper final failed after Optional live captions failed; Whisper audio remains authoritative. [OPTIONAL_LIVE_FAILED/UnknownError; details omitted]",
        }),
        expect.objectContaining({
          phase: "whisper-final",
          severity: "error",
          detail: "A local recorder operation failed. [LOCAL_OPERATION_FAILED/Error; details omitted]",
        }),
      ]),
    );
    expect(JSON.stringify(trace)).not.toContain("Jane Doe");
    expect(JSON.stringify(trace)).not.toContain("private recording.wav");
    expect(JSON.stringify(trace)).not.toContain("/home/");
  });

  it.each([
    ["short arbitrary detail", "chunk IPC failed"],
    ["very long", "x".repeat(100_000)],
    ["spaced Windows path", "音声🔥 failed at C:\\Users\\Jane Doe\\private recording.wav token=super-secret"],
    ["quoted UNC path", '"\\\\workstation 01\\private share\\private recording.wav",'],
    ["spaced POSIX path", "'/home/Jane Doe/private recording.wav';"],
  ])("keeps valid Whisper audio authoritative with a %s diagnostic", async (_label, rawDiagnostic) => {
    const runtime = new FakeRuntime();
    const controller = new RecorderController(runtime);
    const diagnostic = toSafeDiagnostic(rawDiagnostic, "OPTIONAL_LIVE_FAILED");

    const final = await controller.transcribeCapture({
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: 1_000,
      data: new ArrayBuffer(32_000),
      liveCaptionFailure: diagnostic,
    });

    const retained = runtime.lastCapture?.liveCaptionFailure ?? null;
    const warning = final.snapshot.trace.find((entry) => entry.phase === "live-caption-warning");
    expect(final.snapshot.transcript.finalText).toBe("Whisper authoritative final transcript.");
    expect(retained).toEqual(diagnostic);
    expect(warning?.severity).toBe("warning");
    expect(warning?.detail).toContain(formatSafeDiagnostic(diagnostic));
    expect(warning?.detail).not.toContain("Jane Doe");
    expect(warning?.detail).not.toContain("private recording.wav");
    expect(warning?.detail).not.toContain("workstation 01");
    expect(warning?.detail).not.toContain("private share");
    expect(warning?.detail).not.toContain("super-secret");
    expect(warning?.detail).not.toContain(rawDiagnostic);
  });
});

function modelReadiness(
  runtimeTargets: RuntimeTargets,
  role: keyof typeof targets,
  id: string,
  executionProvider: string,
): RuntimeReadiness[typeof role] {
  return {
    target: runtimeTargets[role],
    model: {
      role,
      id,
      alias: id.split(":")[0] ?? id,
      deviceType: runtimeTargets[role].deviceType,
      executionProvider,
      fileSizeMb: 100,
    },
    status: "ready",
    detail: "ready",
    cached: true,
    loaded: true,
  };
}

function runtimeReadiness(runtimeTargets: RuntimeTargets): RuntimeReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    externalEndpointUsed: false,
    inProcessModeValidated: true,
    embeddedWebServiceRunning: false,
    embeddedWebServiceUrls: [],
    cleanup: {
      state: "none",
      required: false,
      completionPending: false,
      detail: "No deferred runtime cleanup is pending.",
    },
    nonessentialTelemetryDisabled: true,
    modelCachePath: "C:\\models",
    audioRecovery: {
      discovered: 0,
      removed: 0,
      retained: 0,
      pathPolicy: "App-owned temporary audio directory; exact paths are not exposed.",
      retryGuidance:
        "Close applications using retained files, then use Delete / reset or restart to retry cleanup.",
    },
    whisper: modelReadiness(runtimeTargets, "whisper", WHISPER_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    nemotron: modelReadiness(runtimeTargets, "nemotron", NEMOTRON_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    summary: modelReadiness(runtimeTargets, "summary", SUMMARY_MODEL_ID, SUMMARY_EXECUTION_PROVIDER),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (error?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function audioIdentity(id: string, streaming: boolean): AudioTranscriptionResult["model"] {
  return {
    alias: id.split(":")[0] ?? id,
    id,
    deviceType: "CPU",
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    fileSizeMb: 100,
    language: "en",
    inputMode: streaming ? "streaming PCM ItemQueue" : "temporary PCM WAV file URI",
  };
}

function transcription(
  transcriptText: string,
  id: string,
  mode: AudioTranscriptionResult["mode"],
  transcriptSource: AudioTranscriptionResult["transcriptSource"],
): AudioTranscriptionResult {
  return {
    transcript: transcriptText,
    transcriptionMs: 500,
    audioDurationMs: 1_000,
    model: audioIdentity(id, mode === "nemotron_streaming"),
    mode,
    transcriptSource,
    firstPartialMs: mode === "nemotron_streaming" ? 220 : null,
    finalizationMs: 100,
    externalEndpointUsed: false,
  };
}

function preflight(): RequestPreflightResult {
  return {
    promptTokens: 50,
    outputReserveTokens: 512,
    requiredTokens: 562,
    contextLimitTokens: 4_096,
    fits: true,
    deficitTokens: 0,
  };
}

function response(
  text = ["Overview.", "• First fact.", "• Second fact.", "• Third fact.", "• Fourth fact."].join("\n"),
  finishReason: string = "stop",
): Response {
  return {
    output: [{ type: "text", text }],
    finishReason: finishReason as Response["finishReason"],
    usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
  };
}

function summaryJson(overview: string, details: readonly string[]): string {
  return JSON.stringify({ overview, details });
}
