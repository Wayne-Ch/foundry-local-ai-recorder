import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyPartialTranscriptEvent,
  audioDurationMsFromPcmBytes,
  createTranscriptDraftUpdate,
  encodePcm16Wav,
  extractPcm16FromWav,
  reduceAudioRecorderState,
  StreamingTranscriptAccumulator,
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
  cleanupRecorderOperation,
  clipPcm16ToMaxBytes,
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
    }
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
});
