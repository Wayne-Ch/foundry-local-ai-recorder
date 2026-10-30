import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyPartialTranscriptEvent,
  audioDurationMsFromPcmBytes,
  createTranscriptDraftUpdate,
  encodePcm16Wav,
  extractPcm16FromWav,
  LIVE_CAPTION_DIAGNOSTIC_MAX_BYTES,
  LIVE_CAPTION_DIAGNOSTIC_TRUNCATION_MARKER,
  reduceAudioRecorderState,
  StreamingTranscriptAccumulator,
  sanitizeLiveCaptionFailure,
  validateAudioCapturePayload,
  validateAudioStreamCancel,
  validateAudioStreamChunk,
  validateAudioStreamFinish,
  validateAudioStreamStart,
  validatePrepareAudioRequest,
} from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_SAMPLE_RATE,
  AUDIO_STREAM_CHUNK_BYTES,
  AUDIO_STREAM_MAX_CHUNKS,
  AUDIO_STREAM_MAX_QUEUED_CHUNKS,
  type AudioCapturePayload,
  type AudioPartialTranscriptEvent,
  type AudioReadiness,
  type AudioRecorderState,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import {
  type AudioRecorderOperation,
  type AudioRecorderOperationRef,
  audioModeDisplay,
  BoundedAudioChunkPump,
  BoundedPcmCapture,
  beginRecordingStop,
  cancelRecordingAndReset,
  cleanupRecorderOperation,
  clipPcm16ToMaxBytes,
  finalizeCapturedAudio,
  LiveCaptionFailureState,
  recordingLimitDelay,
  releaseMediaStream,
  resampleChannelsToPcm16,
  StreamingPcm16Resampler,
  shouldOfferWhisperFallback,
} from "../src/renderer/audio-capture";

const STREAM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_STREAM_ID = "22222222-2222-4222-8222-222222222222";

function validPayload(durationMs = 1000): AudioCapturePayload {
  return {
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs,
    data: new ArrayBuffer((AUDIO_SAMPLE_RATE * durationMs * 2) / 1000),
  };
}

function audioReadiness(overrides: Partial<AudioReadiness> = {}): AudioReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    model: {
      alias: NEMOTRON_AUDIO_MODEL_ALIAS,
      id: NEMOTRON_AUDIO_MODEL_ID,
      deviceType: "CPU",
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      fileSizeMb: 696,
      language: "en",
      inputMode: "streaming PCM ItemQueue",
    },
    preferredModelId: NEMOTRON_AUDIO_MODEL_ID,
    fallbackModelId: WHISPER_AUDIO_MODEL_ID,
    activeMode: "nemotron_streaming",
    fallbackAvailable: true,
    fallbackReason: null,
    modelCached: true,
    localAudioReady: true,
    externalEndpointUsed: false,
    maxDurationMs: AUDIO_MAX_DURATION_MS,
    inputFormat: "PCM16LE · 16 kHz · mono",
    status: "ready",
    detail: "Ready.",
    lastTranscriptionMs: null,
    ...overrides,
  };
}

describe("audio IPC validation", () => {
  it("accepts bounded PCM16LE 16 kHz mono input", () => {
    const result = validateAudioCapturePayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pcmBytes.byteLength).toBe(32_000);
      expect(result.value.durationMs).toBe(1000);
      expect(result.value.liveCaptionFailure).toBeNull();
    }
  });

  it("sanitizes live-caption failure metadata without invalidating valid audio", () => {
    expect(
      validateAudioCapturePayload({
        ...validPayload(),
        liveCaptionFailure: "chunk IPC failed",
      }),
    ).toMatchObject({
      ok: true,
      value: { liveCaptionFailure: "chunk IPC failed" },
    });
    expect(
      validateAudioCapturePayload({
        ...validPayload(),
        liveCaptionFailure: " ".repeat(2),
      }),
    ).toMatchObject({
      ok: true,
      value: { liveCaptionFailure: "Live captions failed without safe diagnostic details." },
    });
  });

  it.each([999, 1_000])("preserves a %i-byte live-caption diagnostic", (length) => {
    const diagnostic = "x".repeat(length);
    expect(sanitizeLiveCaptionFailure(diagnostic)).toBe(diagnostic);
  });

  it.each([1_001, 100_000])("truncates a %i-byte live-caption diagnostic with a marker", (length) => {
    const diagnostic = sanitizeLiveCaptionFailure("x".repeat(length));
    expect(diagnostic).not.toBeNull();
    expect(new TextEncoder().encode(diagnostic ?? "").byteLength).toBeLessThanOrEqual(
      LIVE_CAPTION_DIAGNOSTIC_MAX_BYTES,
    );
    expect(diagnostic?.endsWith(LIVE_CAPTION_DIAGNOSTIC_TRUNCATION_MARKER)).toBe(true);
    expect(
      validateAudioCapturePayload({ ...validPayload(), liveCaptionFailure: "x".repeat(length) }).ok,
    ).toBe(true);
  });

  it("redacts path and credential-like Unicode diagnostics without splitting characters", () => {
    const diagnostic = sanitizeLiveCaptionFailure(
      `音声🔥 failed at C:\\Users\\person\\private.wav token=super-secret ${"東京".repeat(1_000)}`,
    );
    expect(diagnostic).not.toContain("C:\\Users\\person\\private.wav");
    expect(diagnostic).not.toContain("super-secret");
    expect(diagnostic).toContain("[path redacted]");
    expect(diagnostic).toContain("token=[redacted]");
    expect(diagnostic?.endsWith(LIVE_CAPTION_DIAGNOSTIC_TRUNCATION_MARKER)).toBe(true);
    expect(diagnostic?.includes("\uFFFD")).toBe(false);
    expect(new TextEncoder().encode(diagnostic ?? "").byteLength).toBeLessThanOrEqual(
      LIVE_CAPTION_DIAGNOSTIC_MAX_BYTES,
    );
  });

  it.each([
    [{ ...validPayload(), format: "wav" }, "UNSUPPORTED_FORMAT"],
    [{ ...validPayload(), sampleRate: 48_000 }, "UNSUPPORTED_SAMPLE_RATE"],
    [{ ...validPayload(), channels: 2 }, "UNSUPPORTED_CHANNEL_COUNT"],
    [{ ...validPayload(), durationMs: 100 }, "DURATION_OUT_OF_RANGE"],
    [
      {
        ...validPayload(AUDIO_MAX_DURATION_MS),
        data: new ArrayBuffer(AUDIO_MAX_PCM_BYTES + 2),
      },
      "PAYLOAD_TOO_LARGE",
    ],
    [{ ...validPayload(), data: new ArrayBuffer(31_000) }, "DURATION_SIZE_MISMATCH"],
  ])("rejects invalid bounded payload %#", (payload, code) => {
    expect(validateAudioCapturePayload(payload)).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("accepts only the bounded streaming contract", () => {
    expect(validatePrepareAudioRequest({ mode: "nemotron_streaming" })).toEqual({
      mode: "nemotron_streaming",
    });
    expect(
      validateAudioStreamStart({
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        maxDurationMs: AUDIO_MAX_DURATION_MS,
      }),
    ).toMatchObject({ format: AUDIO_FORMAT, sampleRate: AUDIO_SAMPLE_RATE });
    expect(
      validateAudioStreamChunk({
        streamId: STREAM_ID,
        sequence: 0,
        data: new ArrayBuffer(AUDIO_STREAM_CHUNK_BYTES),
      }),
    ).toMatchObject({ streamId: STREAM_ID, sequence: 0 });
    expect(
      validateAudioStreamFinish({
        streamId: STREAM_ID,
        lastSequence: 4,
        audioDurationMs: 500,
      }),
    ).toEqual({
      streamId: STREAM_ID,
      lastSequence: 4,
      audioDurationMs: 500,
    });
    expect(validateAudioStreamCancel({ streamId: STREAM_ID })).toEqual({
      streamId: STREAM_ID,
    });
  });

  it("rejects oversized or malformed stream chunks", () => {
    expect(() =>
      validateAudioStreamChunk({
        streamId: STREAM_ID,
        sequence: 0,
        data: new ArrayBuffer(AUDIO_STREAM_CHUNK_BYTES + 2),
      }),
    ).toThrow("Audio stream chunks");
    expect(() =>
      validateAudioStreamChunk({
        streamId: STREAM_ID,
        sequence: -1,
        data: new ArrayBuffer(100),
      }),
    ).toThrow("sequence");
    expect(() =>
      validateAudioStreamChunk({
        streamId: STREAM_ID,
        sequence: 0,
        data: new ArrayBuffer(3),
      }),
    ).toThrow("PCM bytes");
    expect(() =>
      validateAudioStreamChunk({
        streamId: STREAM_ID,
        sequence: AUDIO_STREAM_MAX_CHUNKS,
        data: new ArrayBuffer(2),
      }),
    ).toThrow("sequence");
    expect(() => validatePrepareAudioRequest({ mode: "automatic" })).toThrow("explicit Whisper");
    expect(() => validateAudioStreamCancel({ streamId: "stream-1234" })).toThrow("stream ID");
  });
});

describe("PCM and WAV conversion", () => {
  it("round-trips PCM bytes through the temporary WAV container", () => {
    const pcm = new Uint8Array([0, 0, 255, 127, 0, 128, 1, 0]);
    const wav = encodePcm16Wav(pcm);
    expect(extractPcm16FromWav(wav)).toEqual(pcm);
    expect(audioDurationMsFromPcmBytes(32_000)).toBe(1000);
  });

  it("downmixes and resamples browser channels to 16 kHz PCM16", () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.5);
    const pcm = resampleChannelsToPcm16([left, right], 48_000);
    expect(pcm.byteLength).toBe(32_000);
    expect(new DataView(pcm.buffer).getInt16(0, true)).toBe(0);
  });

  it("clips codec padding beyond the maximum PCM duration", () => {
    const padded = new Uint8Array(AUDIO_MAX_PCM_BYTES + 3_200);
    padded[AUDIO_MAX_PCM_BYTES - 1] = 123;
    padded[AUDIO_MAX_PCM_BYTES] = 231;

    const clipped = clipPcm16ToMaxBytes(padded);

    expect(clipped.byteLength).toBe(AUDIO_MAX_PCM_BYTES);
    expect(clipped.at(-1)).toBe(123);
    expect(audioDurationMsFromPcmBytes(clipped.byteLength)).toBe(AUDIO_MAX_DURATION_MS);
  });

  it("emits ordered 100 ms chunks from streaming resampling", () => {
    const resampler = new StreamingPcm16Resampler(48_000);
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < 10; index += 1) {
      chunks.push(...resampler.push([new Float32Array(4_800).fill(index / 10)]));
    }
    chunks.push(...resampler.finish());
    expect(chunks).toHaveLength(10);
    expect(chunks.every((chunk) => chunk.byteLength === AUDIO_STREAM_CHUNK_BYTES)).toBe(true);
    expect(new DataView(chunks[0]?.buffer ?? new ArrayBuffer(0)).getInt16(0, true)).toBe(0);
    expect(new DataView(chunks[9]?.buffer ?? new ArrayBuffer(0)).getInt16(0, true)).toBeGreaterThan(20_000);
  });

  it("caps PCM accumulation at the exact 30-second byte contract", () => {
    const exact = new BoundedPcmCapture();
    expect(exact.append(new Uint8Array(AUDIO_MAX_PCM_BYTES)).reachedLimit).toBe(true);
    expect(exact.byteLength).toBe(AUDIO_MAX_PCM_BYTES);
    expect(exact.durationMs).toBe(AUDIO_MAX_DURATION_MS);

    const oneFrameBeyond = new BoundedPcmCapture();
    const beyond = oneFrameBeyond.append(new Uint8Array(AUDIO_MAX_PCM_BYTES + 2));
    expect(beyond.accepted.byteLength).toBe(AUDIO_MAX_PCM_BYTES);
    expect(oneFrameBeyond.byteLength).toBe(AUDIO_MAX_PCM_BYTES);

    const crossing = new BoundedPcmCapture();
    crossing.append(new Uint8Array(AUDIO_MAX_PCM_BYTES - 1_000));
    const crossed = crossing.append(new Uint8Array(4_000));
    expect(crossed.accepted.byteLength).toBe(1_000);
    expect(crossing.byteLength).toBe(AUDIO_MAX_PCM_BYTES);
    expect(crossing.snapshot().byteLength).toBe(AUDIO_MAX_PCM_BYTES);
  });
});

describe("live transcript and backpressure", () => {
  it("replaces partial hypotheses and commits final segments in order", () => {
    const accumulator = new StreamingTranscriptAccumulator();
    expect(accumulator.push({ kind: "partial", text: " Can a queen" })).toBe("Can a queen");
    expect(accumulator.push({ kind: "partial", text: "Can a queen bed" })).toBe("Can a queen bed");
    expect(accumulator.push({ kind: "final", text: "Can a queen bed " })).toBe("Can a queen bed ");
    expect(accumulator.push({ kind: "none", text: "fit here" })).toBe("Can a queen bed fit here");
    expect(accumulator.finalize("Can a queen bed fit here?")).toBe("Can a queen bed fit here?");
  });

  it("ignores stale/out-of-order partial events and never marks them sent", () => {
    const base = { streamId: null, sequence: -1, text: "", isFinal: false } as const;
    const event = {
      streamId: STREAM_ID,
      sequence: 0,
      text: "Can a queen",
      firstPartialMs: 400,
      model: {
        alias: "nemotron",
        id: "nemotron-id",
        deviceType: "CPU",
        executionProvider: "CPUExecutionProvider",
        fileSizeMb: 696,
        language: "en",
        inputMode: "streaming PCM ItemQueue",
      },
      mode: "nemotron_streaming",
      externalEndpointUsed: false,
    } satisfies AudioPartialTranscriptEvent;
    const applied = applyPartialTranscriptEvent(base, event);
    expect(applied).toEqual({
      streamId: STREAM_ID,
      sequence: 0,
      text: "Can a queen",
      isFinal: false,
    });
    expect(applyPartialTranscriptEvent(applied, event)).toBe(applied);
    expect(
      applyPartialTranscriptEvent(applied, {
        ...event,
        streamId: OTHER_STREAM_ID,
        sequence: 1,
        text: "Wrong stream",
      }),
    ).toBe(applied);
    expect(
      applyPartialTranscriptEvent(
        { ...applied, isFinal: true },
        { ...event, sequence: 1, text: "Late partial" },
      ),
    ).toEqual({ ...applied, isFinal: true });
  });

  it("sends one chunk at a time and enforces the bounded queue", async () => {
    let releaseFirst: (() => void) | undefined;
    const sent: number[] = [];
    const pump = new BoundedAudioChunkPump(async (sequence) => {
      sent.push(sequence);
      if (sequence === 0) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { acceptedSequence: sequence, totalBytes: (sequence + 1) * AUDIO_STREAM_CHUNK_BYTES };
    });
    for (let index = 0; index < AUDIO_STREAM_MAX_QUEUED_CHUNKS + 1; index += 1) {
      pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }
    expect(() => pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES))).toThrow("backpressure");
    releaseFirst?.();
    await pump.flush();
    expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pump.lastSequence).toBe(8);
  });

  it("surfaces an asynchronous IPC failure immediately and stops pumping later chunks", async () => {
    const sent: number[] = [];
    const errors: unknown[] = [];
    const pump = new BoundedAudioChunkPump(
      async (sequence) => {
        sent.push(sequence);
        throw new Error("chunk IPC failed");
      },
      (error) => errors.push(error),
    );
    pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));

    await expect(pump.flush()).rejects.toThrow("chunk IPC failed");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(sent).toEqual([0]);
  });

  it("retains a completed asynchronous IPC failure and never restarts the pump", async () => {
    const sent: number[] = [];
    const errors: unknown[] = [];
    const pump = new BoundedAudioChunkPump(
      async (sequence) => {
        sent.push(sequence);
        throw new Error("remembered chunk failure");
      },
      (error) => errors.push(error),
    );

    pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    await expect(pump.flush()).rejects.toThrow("remembered chunk failure");
    expect(() => pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES))).toThrow("remembered chunk failure");
    expect(sent).toEqual([0]);
  });

  it("continues with bounded Whisper audio after a sticky pump failure and cleans live resources", async () => {
    const errors: unknown[] = [];
    const pump = new BoundedAudioChunkPump(
      async () => {
        throw new Error("live IPC failed");
      },
      (error) => errors.push(error),
    );
    const pcm = new BoundedPcmCapture();
    pcm.append(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    const stop = vi.fn(async () => [new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)]);
    const trackStop = vi.fn();
    const finish = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const result = await finalizeCapturedAudio({
      capture: { stop },
      mediaStream: {
        getTracks: () => [{ stop: trackStop }],
      } as unknown as MediaStream,
      pcm,
      live: {
        pump,
        streamId: STREAM_ID,
        finish,
        cancel,
      },
      releaseStream: releaseMediaStream,
    });

    expect(result.pcmBytes.byteLength).toBe(AUDIO_STREAM_CHUNK_BYTES * 2);
    expect(result.liveCaptionError).toBeInstanceOf(Error);
    expect(stop).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(STREAM_ID);
  });

  it("preserves a callback failure after the pump is detached and cancellation succeeds", async () => {
    const failureState = new LiveCaptionFailureState();
    const callbackFailure = new Error("async live callback failed");
    failureState.record(callbackFailure);
    const pcm = new BoundedPcmCapture();
    pcm.append(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    const cancel = vi.fn(async () => {});

    const result = await finalizeCapturedAudio({
      capture: { stop: async () => [new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)] },
      mediaStream: { getTracks: () => [] } as unknown as MediaStream,
      pcm,
      live: {
        pump: null,
        streamId: STREAM_ID,
        failure: failureState.error,
        finish: async () => {},
        cancel,
      },
    });

    expect(result.liveCaptionError).toBe("async live callback failed");
    expect(result.pcmBytes.byteLength).toBe(AUDIO_STREAM_CHUNK_BYTES * 2);
    expect(cancel).toHaveBeenCalledWith(STREAM_ID);
    failureState.clear();
    expect(failureState.error).toBeNull();
  });

  it("aggregates a detached callback failure with live-stream cancellation failure", async () => {
    const failureState = new LiveCaptionFailureState();
    const callbackFailure = new Error("async live callback failed");
    const cancelFailure = new Error("live cancellation failed");
    failureState.record(callbackFailure);

    const result = await finalizeCapturedAudio({
      capture: { stop: async () => [new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)] },
      mediaStream: { getTracks: () => [] } as unknown as MediaStream,
      pcm: new BoundedPcmCapture(),
      live: {
        pump: null,
        streamId: STREAM_ID,
        failure: failureState.error,
        finish: async () => {},
        cancel: async () => {
          throw cancelFailure;
        },
      },
    });

    expect(result.liveCaptionError).toBeInstanceOf(AggregateError);
    expect((result.liveCaptionError as AggregateError).errors).toEqual([
      "async live callback failed",
      cancelFailure,
    ]);
  });

  it("contains an asynchronous pump rejection after recording the callback failure", async () => {
    const failureState = new LiveCaptionFailureState();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const pump = new BoundedAudioChunkPump(
        async () => {
          throw new Error("background pump failed");
        },
        (error) => failureState.record(error),
      );

      pump.enqueue(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
      await vi.waitFor(() => expect(failureState.error).toBe("background pump failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
      expect(failureState.error).toBe("background pump failed");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("audio recorder state and draft behavior", () => {
  it("moves through permission, recording, transcription, and completion", () => {
    let state: AudioRecorderState = { status: "idle", elapsedMs: 0, detail: "" };
    state = reduceAudioRecorderState(state, { type: "REQUEST_PERMISSION" });
    expect(state.status).toBe("requesting_permission");
    state = reduceAudioRecorderState(state, { type: "START" });
    state = reduceAudioRecorderState(state, { type: "TICK", elapsedMs: 1250 });
    expect(state).toMatchObject({ status: "recording", elapsedMs: 1250 });
    state = reduceAudioRecorderState(state, { type: "TRANSCRIBE" });
    expect(state.status).toBe("transcribing");
    state = reduceAudioRecorderState(state, { type: "COMPLETE" });
    expect(state).toEqual({ status: "idle", elapsedMs: 0, detail: "" });
  });

  it("creates an editable transcript draft and never auto-submits", () => {
    expect(createTranscriptDraftUpdate("", "  Can a queen bed fit?  ")).toEqual({
      value: "Can a queen bed fit?",
      shouldSubmit: false,
    });
    expect(createTranscriptDraftUpdate("Keep this.", "Add a desk.")).toEqual({
      value: "Keep this. Add a desk.",
      shouldSubmit: false,
    });
  });

  it("shows the exact active model and offers only the explicit labeled fallback", async () => {
    const nemotron = audioReadiness();
    expect(audioModeDisplay(nemotron)).toBe(`${NEMOTRON_AUDIO_MODEL_ID} · LIVE`);
    expect(shouldOfferWhisperFallback(nemotron)).toBe(true);

    const failed = audioReadiness({
      status: "error",
      localAudioReady: false,
      fallbackReason: "Nemotron failed.",
    });
    expect(shouldOfferWhisperFallback(failed)).toBe(true);

    const whisper = audioReadiness({
      model: {
        alias: "whisper-tiny",
        id: WHISPER_AUDIO_MODEL_ID,
        deviceType: "CPU",
        executionProvider: AUDIO_EXECUTION_PROVIDER,
        fileSizeMb: 131,
        language: "en",
        inputMode: "temporary PCM WAV file URI",
      },
      activeMode: "whisper_file",
    });
    expect(audioModeDisplay(whisper)).toBe(`${WHISPER_AUDIO_MODEL_ID} · WHISPER FALLBACK`);
    expect(shouldOfferWhisperFallback(whisper)).toBe(false);

    const renderer = await readFile(path.resolve("src/renderer/app.ts"), "utf8");
    expect(renderer).toContain("Live draft <span>Nemotron</span>");
    expect(renderer).toContain("Final transcript <span>Whisper</span>");
    expect(renderer).toContain("Session summary <span>Qwen</span>");
    expect(renderer).toContain("Whisper-only fallback is ready");
    expect(renderer).toContain("Endpoint guard pending");
    expect(renderer).toContain("locked temporary audio");
    expect(renderer).toContain("Cancel / reset");
    expect(renderer).toContain("transcriptEditorDirty");
    expect(renderer).toContain("LiveCaptionFailureState");
    expect(renderer).toContain("Whisper final succeeded; live captions failed");
    expect(renderer).not.toContain("finalTranscript.value.trim()");
  });

  it("stops every microphone track during cleanup", () => {
    const stopOne = vi.fn();
    const stopTwo = vi.fn();
    releaseMediaStream({
      getTracks: () => [{ stop: stopOne }, { stop: stopTwo }],
    } as unknown as MediaStream);
    expect(stopOne).toHaveBeenCalledOnce();
    expect(stopTwo).toHaveBeenCalledOnce();
  });

  it("ignores stale recorder cleanup without touching the newer capture", () => {
    const oldRecorder = { state: "recording", stop: vi.fn() } as unknown as MediaRecorder;
    const newRecorder = { state: "recording", stop: vi.fn() } as unknown as MediaRecorder;
    const oldOperation = {
      operationId: 1,
      lifecycleGeneration: 0,
      recorder: oldRecorder,
      stream: {} as MediaStream,
      chunks: [new Blob(["old"])],
      startedAt: 0,
      recordingTimerId: 10,
      recordingLimitId: 11,
    } satisfies AudioRecorderOperation;
    const newOperation = {
      operationId: 2,
      lifecycleGeneration: 0,
      recorder: newRecorder,
      stream: {} as MediaStream,
      chunks: [new Blob(["new"])],
      startedAt: 0,
      recordingTimerId: 20,
      recordingLimitId: 21,
    } satisfies AudioRecorderOperation;
    const reference: AudioRecorderOperationRef = { current: newOperation };
    const clearInterval = vi.fn();
    const clearTimeout = vi.fn();
    const releaseStream = vi.fn();

    expect(
      cleanupRecorderOperation(reference, oldOperation, {
        stopRecorder: true,
        clearInterval,
        clearTimeout,
        releaseStream,
      }),
    ).toBe(false);
    expect(reference.current).toBe(newOperation);
    expect(newOperation.chunks).toHaveLength(1);
    expect(clearInterval).not.toHaveBeenCalled();
    expect(clearTimeout).not.toHaveBeenCalled();
    expect(releaseStream).not.toHaveBeenCalled();
    expect(newRecorder.stop).not.toHaveBeenCalled();

    expect(
      cleanupRecorderOperation(reference, newOperation, {
        stopRecorder: true,
        clearInterval,
        clearTimeout,
        releaseStream,
      }),
    ).toBe(true);
    expect(reference.current).toBeNull();
    expect(newOperation.chunks).toHaveLength(0);
    expect(clearInterval).toHaveBeenCalledWith(20);
    expect(clearTimeout).toHaveBeenCalledWith(21);
    expect(releaseStream).toHaveBeenCalledWith(newOperation.stream);
    expect(newRecorder.stop).toHaveBeenCalledOnce();
  });

  it("allows only one winner when automatic and manual stop race", () => {
    const operation = { stopping: false };
    expect(recordingLimitDelay(1_000, 1_000)).toBe(AUDIO_MAX_DURATION_MS);
    expect(recordingLimitDelay(1_000, 31_001)).toBe(0);
    expect(beginRecordingStop(operation)).toBe(true);
    expect(beginRecordingStop(operation)).toBe(false);
  });

  it("cancels and discards a recording without finish, transcription, or summary work", async () => {
    const pcm = new BoundedPcmCapture();
    pcm.append(new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    const stop = vi.fn(async () => [new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)]);
    const trackStop = vi.fn();
    const cancel = vi.fn(async () => {});
    const finish = vi.fn();
    const transcribe = vi.fn();
    const summarize = vi.fn();

    const reset = vi.fn(async () => "reset-complete");
    const api = {
      cancelLiveStream: cancel,
      reset,
      finishLiveStream: finish,
      transcribeCapture: transcribe,
      generateSummary: summarize,
    };

    await expect(
      cancelRecordingAndReset(
        {
          capture: { stop },
          mediaStream: {
            getTracks: () => [{ stop: trackStop }],
          } as unknown as MediaStream,
          pcm,
          pump: null,
          streamId: STREAM_ID,
          releaseStream: releaseMediaStream,
        },
        api,
      ),
    ).resolves.toEqual({ result: "reset-complete", cancellationError: null });

    expect(cancel).toHaveBeenCalledWith(STREAM_ID);
    expect(reset).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(pcm.byteLength).toBe(0);
    expect(finish).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });
});
