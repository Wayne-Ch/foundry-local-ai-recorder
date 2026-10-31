import type { RequestPreflightResult, Response } from "foundry-local-sdk";
import { describe, expect, it } from "vitest";
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
  resolveRuntimeTargets,
  SUMMARY_EXECUTION_PROVIDER,
  SUMMARY_MODEL_ID,
} from "../src/foundry/runtime-config";
import { RecorderController, type RecorderRuntime } from "../src/main/recorder-controller";
import {
  createPopulatedSummaryCaptureSnapshot,
  POPULATED_SUMMARY_CAPTURE_FORMATTED,
  POPULATED_SUMMARY_CAPTURE_RAW,
} from "../src/main/ui-capture-fixture";
import type { RuntimeReadiness } from "../src/shared/contracts";
import { formatSafeDiagnostic, toSafeDiagnostic } from "../src/shared/safe-diagnostic";
import { formatSummaryForDisplay } from "../src/summary/summary-format";

const targets = resolveRuntimeTargets({});

class FakeRuntime implements RecorderRuntime {
  readonly cleanupCompletion: Promise<void> | null = null;
  readonly readiness: RuntimeReadiness = {
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
    whisper: modelReadiness("whisper", WHISPER_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    nemotron: modelReadiness("nemotron", NEMOTRON_AUDIO_MODEL_ID, AUDIO_EXECUTION_PROVIDER),
    summary: modelReadiness("summary", SUMMARY_MODEL_ID, SUMMARY_EXECUTION_PROVIDER),
  };
  summaryInput = "";
  lastCapture: ValidatedAudioCapture | null = null;

  constructor(
    readonly finalTranscript = "Whisper authoritative final transcript.",
    readonly transcriptionError: Error | null = null,
    readonly summaryText = "Overview.\n\n- Key point.",
  ) {}

  async prepare(): Promise<PrepareRuntimeResult> {
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
        alias: "qwen3-0.6b",
        deviceType: "GPU",
        executionProvider: SUMMARY_EXECUTION_PROVIDER,
        fileSizeMb: 600,
      },
      preflight: preflight(),
      response: response(this.summaryText),
    };
  }

  async reset(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

describe("RecorderController", () => {
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
    const raw = String.raw`Keep C:\times\reports and \cdot literal. The solution is expressed as $ y(t) = c \\cdot e^{-2t}} $, where $ c $ is the initial constant.`;
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
      String.raw`Keep C:\times\reports and \cdot literal. The solution is expressed as y(t) = c · e^(−2t), where c is the initial constant.`,
    );
    expect(summary.snapshot.trace.find((entry) => entry.phase === "summary-raw")).toMatchObject({
      detail: raw,
      summaryDisplayFormattingApplied: true,
    });
  });

  it("builds deterministic populated-summary UI evidence from the exact raw and formatted pair", () => {
    const snapshot = createPopulatedSummaryCaptureSnapshot(
      new RecorderController(new FakeRuntime()).bootstrap(),
    );

    expect(formatSummaryForDisplay(POPULATED_SUMMARY_CAPTURE_RAW)).toEqual({
      text: POPULATED_SUMMARY_CAPTURE_FORMATTED,
      formattingApplied: true,
    });
    expect(snapshot.transcript.finalText).toContain("Today we derived");
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
    const raw = String.raw`It describes $ y' = -2y $ and $ y(t) = c \cdot e^{-2t}} $.`;
    const runtime = new FakeRuntime("Imported Whisper final.", null, raw);
    const controller = new RecorderController(runtime);
    const wav = encodePcm16Wav(new Uint8Array(32_000));

    await controller.transcribeImportedWav("fixture.wav", wav);
    const summary = await controller.generateSummary();

    expect(runtime.summaryInput).toBe("Imported Whisper final.");
    expect(summary.snapshot.transcript.summary?.text).toBe("It describes y′ = −2y and y(t) = c · e^(−2t).");
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
  role: keyof typeof targets,
  id: string,
  executionProvider: string,
): RuntimeReadiness[typeof role] {
  return {
    target: targets[role],
    model: {
      role,
      id,
      alias: id.split(":")[0] ?? id,
      deviceType: role === "summary" ? "GPU" : "CPU",
      executionProvider,
      fileSizeMb: 100,
    },
    status: "ready",
    detail: "ready",
    cached: true,
    loaded: true,
  };
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
    outputReserveTokens: 260,
    requiredTokens: 310,
    contextLimitTokens: 4_096,
    fits: true,
    deficitTokens: 0,
  };
}

function response(text = "Overview.\n\n- Key point."): Response {
  return {
    output: [{ type: "text", text }],
    finishReason: "stop",
    usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
  };
}
