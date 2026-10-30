import { audioDurationMsFromPcmBytes, validateAudioCapturePayload } from "../audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_SAMPLE_RATE,
  AUDIO_STREAM_CHUNK_BYTES,
  AUDIO_STREAM_MAX_QUEUED_CHUNKS,
  type AudioCapturePayload,
  type AudioReadiness,
  type AudioStreamChunkResponse,
} from "../audio/audio-types";

const MIME_TYPE_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"] as const;

export interface AudioRecorderOperation {
  readonly operationId: number;
  readonly lifecycleGeneration: number;
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  readonly startedAt: number;
  recordingTimerId: number | null;
  recordingLimitId: number | null;
}

export interface AudioRecorderOperationRef {
  current: AudioRecorderOperation | null;
}

interface RecorderCleanupOptions {
  readonly stopRecorder: boolean;
  readonly clearInterval: (timerId: number) => void;
  readonly clearTimeout: (timerId: number) => void;
  readonly releaseStream: (stream: MediaStream) => void;
}

export function chooseRecordingMimeType(): string | undefined {
  return MIME_TYPE_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function releaseMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function audioModeDisplay(readiness: AudioReadiness): string {
  if (readiness.activeMode === "whisper_file") {
    return `${readiness.model?.id ?? readiness.fallbackModelId} · WHISPER FALLBACK`;
  }
  return `${readiness.model?.id ?? readiness.preferredModelId} · LIVE`;
}

export function shouldOfferWhisperFallback(readiness: AudioReadiness): boolean {
  return readiness.fallbackAvailable && readiness.activeMode !== "whisper_file";
}

export function isCurrentRecorderOperation(
  reference: AudioRecorderOperationRef,
  operation: AudioRecorderOperation,
): boolean {
  return (
    reference.current === operation &&
    reference.current.operationId === operation.operationId &&
    reference.current.recorder === operation.recorder
  );
}

export function cleanupRecorderOperation(
  reference: AudioRecorderOperationRef,
  operation: AudioRecorderOperation,
  options: RecorderCleanupOptions,
): boolean {
  if (!isCurrentRecorderOperation(reference, operation)) {
    return false;
  }

  reference.current = null;
  if (operation.recordingTimerId !== null) {
    options.clearInterval(operation.recordingTimerId);
    operation.recordingTimerId = null;
  }
  if (operation.recordingLimitId !== null) {
    options.clearTimeout(operation.recordingLimitId);
    operation.recordingLimitId = null;
  }
  operation.chunks.length = 0;
  if (options.stopRecorder && operation.recorder.state !== "inactive") {
    try {
      operation.recorder.stop();
    } catch {
      // The recorder can race with an already queued stop event.
    }
  }
  options.releaseStream(operation.stream);
  return true;
}

export function clipPcm16ToMaxBytes(pcmBytes: Uint8Array): Uint8Array {
  return pcmBytes.byteLength <= AUDIO_MAX_PCM_BYTES ? pcmBytes : pcmBytes.subarray(0, AUDIO_MAX_PCM_BYTES);
}

export async function recordedBlobToAudioPayload(blob: Blob): Promise<AudioCapturePayload> {
  if (blob.size === 0) {
    throw new Error("The microphone recording was empty.");
  }

  const context = new AudioContext();
  try {
    const source = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: source.numberOfChannels }, (_, index) =>
      source.getChannelData(index),
    );
    const pcmBytes = clipPcm16ToMaxBytes(resampleChannelsToPcm16(channels, source.sampleRate));
    const durationMs = audioDurationMsFromPcmBytes(pcmBytes.byteLength);
    if (durationMs > AUDIO_MAX_DURATION_MS) {
      throw new Error(`Recording exceeds the ${AUDIO_MAX_DURATION_MS / 1000}-second limit.`);
    }

    const data = pcmBytes.buffer.slice(
      pcmBytes.byteOffset,
      pcmBytes.byteOffset + pcmBytes.byteLength,
    ) as ArrayBuffer;
    const payload: AudioCapturePayload = {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs,
      data,
    };
    const validation = validateAudioCapturePayload(payload);
    if (!validation.ok) {
      throw new Error(validation.error.message);
    }
    return payload;
  } finally {
    await context.close();
  }
}

export function resampleChannelsToPcm16(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
): Uint8Array {
  if (channels.length === 0 || channels[0]?.length === 0) {
    throw new Error("Decoded audio has no samples.");
  }
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("Decoded audio has an invalid sample rate.");
  }

  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  const outputLength = Math.max(1, Math.round((sourceLength * AUDIO_SAMPLE_RATE) / sourceSampleRate));
  const output = new Uint8Array(outputLength * 2);
  const view = new DataView(output.buffer);
  const sourceStep = sourceSampleRate / AUDIO_SAMPLE_RATE;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = Math.min(sourceLength - 1, outputIndex * sourceStep);
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(sourceLength - 1, lowerIndex + 1);
    const fraction = sourcePosition - lowerIndex;
    let mixed = 0;
    for (const channel of channels) {
      const lower = channel[lowerIndex] ?? 0;
      const upper = channel[upperIndex] ?? lower;
      mixed += lower + (upper - lower) * fraction;
    }
    mixed /= channels.length;
    const clamped = Math.max(-1, Math.min(1, mixed));
    const sample = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    view.setInt16(outputIndex * 2, sample, true);
  }

  return output;
}

export class StreamingPcm16Resampler {
  readonly #sourceStep: number;
  readonly #chunkSamples = AUDIO_STREAM_CHUNK_BYTES / 2;
  #pendingSource = new Float32Array(0);
  #sourcePosition = 0;
  #pendingSamples: number[] = [];

  constructor(sourceSampleRate: number) {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new Error("Microphone sample rate is invalid.");
    }
    this.#sourceStep = sourceSampleRate / AUDIO_SAMPLE_RATE;
  }

  push(channels: readonly Float32Array[]): Uint8Array[] {
    if (channels.length === 0 || channels[0]?.length === 0) {
      return [];
    }
    const sourceLength = Math.min(...channels.map((channel) => channel.length));
    const mono = new Float32Array(sourceLength);
    for (let index = 0; index < sourceLength; index += 1) {
      let sum = 0;
      for (const channel of channels) {
        sum += channel[index] ?? 0;
      }
      mono[index] = sum / channels.length;
    }
    const combined = new Float32Array(this.#pendingSource.length + mono.length);
    combined.set(this.#pendingSource);
    combined.set(mono, this.#pendingSource.length);
    this.#consumeSource(combined, false);
    return this.#takeCompleteChunks();
  }

  finish(): Uint8Array[] {
    if (this.#pendingSource.length > 0) {
      this.#consumeSource(this.#pendingSource, true);
      this.#pendingSource = new Float32Array(0);
      this.#sourcePosition = 0;
    }
    const chunks = this.#takeCompleteChunks();
    if (this.#pendingSamples.length > 0) {
      chunks.push(encodePcmSamples(this.#pendingSamples));
      this.#pendingSamples = [];
    }
    return chunks;
  }

  #consumeSource(source: Float32Array, final: boolean): void {
    const limit = final ? source.length : Math.max(0, source.length - 1);
    while (this.#sourcePosition < limit) {
      const lowerIndex = Math.floor(this.#sourcePosition);
      const upperIndex = Math.min(source.length - 1, lowerIndex + 1);
      const fraction = this.#sourcePosition - lowerIndex;
      const lower = source[lowerIndex] ?? 0;
      const upper = source[upperIndex] ?? lower;
      this.#pendingSamples.push(floatToPcm16(lower + (upper - lower) * fraction));
      this.#sourcePosition += this.#sourceStep;
    }

    const consumed = Math.min(source.length, Math.floor(this.#sourcePosition));
    this.#pendingSource = source.slice(consumed);
    this.#sourcePosition -= consumed;
  }

  #takeCompleteChunks(): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    while (this.#pendingSamples.length >= this.#chunkSamples) {
      chunks.push(encodePcmSamples(this.#pendingSamples.splice(0, this.#chunkSamples)));
    }
    return chunks;
  }
}

export class BoundedAudioChunkPump {
  readonly #queue: Array<{
    readonly sequence: number;
    readonly data: ArrayBuffer;
    readonly expectedTotalBytes: number;
  }> = [];
  readonly #send: (sequence: number, data: ArrayBuffer) => Promise<AudioStreamChunkResponse>;
  readonly #onError: (error: unknown) => void;
  #nextSequence = 0;
  #nextTotalBytes = 0;
  #pumpPromise: Promise<void> | null = null;
  #failure: unknown | null = null;
  #cancelled = false;

  constructor(
    send: (sequence: number, data: ArrayBuffer) => Promise<AudioStreamChunkResponse>,
    onError: (error: unknown) => void = () => {},
  ) {
    this.#send = send;
    this.#onError = onError;
  }

  get lastSequence(): number {
    return this.#nextSequence - 1;
  }

  enqueue(chunk: Uint8Array): void {
    if (this.#cancelled) {
      throw new Error("Audio stream is cancelled.");
    }
    if (this.#failure !== null) {
      throw this.#failure;
    }
    if (this.#queue.length >= AUDIO_STREAM_MAX_QUEUED_CHUNKS) {
      throw new Error("Audio stream backpressure limit was exceeded.");
    }
    const data = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    this.#nextTotalBytes += chunk.byteLength;
    this.#queue.push({
      sequence: this.#nextSequence,
      data,
      expectedTotalBytes: this.#nextTotalBytes,
    });
    this.#nextSequence += 1;
    if (this.#pumpPromise === null) {
      this.#startPump();
    }
  }

  async flush(): Promise<void> {
    if (this.#failure !== null) {
      throw this.#failure;
    }
    await this.#pumpPromise;
    if (this.#failure !== null) {
      throw this.#failure;
    }
    if (this.#queue.length > 0) {
      this.#startPump();
      await this.#pumpPromise;
    }
    if (this.#failure !== null) {
      throw this.#failure;
    }
  }

  cancel(): void {
    this.#cancelled = true;
    this.#queue.length = 0;
  }

  #startPump(): void {
    let trackedPromise: Promise<void>;
    trackedPromise = this.#pump().finally(() => {
      if (this.#pumpPromise === trackedPromise) {
        this.#pumpPromise = null;
      }
    });
    this.#pumpPromise = trackedPromise;
    void trackedPromise.catch(() => undefined);
  }

  async #pump(): Promise<void> {
    try {
      while (!this.#cancelled && this.#queue.length > 0) {
        const chunk = this.#queue.shift();
        if (chunk === undefined) {
          break;
        }
        const response = await this.#send(chunk.sequence, chunk.data);
        if (response.acceptedSequence !== chunk.sequence) {
          throw new Error(
            `Audio stream acknowledgement mismatch: ${response.acceptedSequence} != ${chunk.sequence}.`,
          );
        }
        if (response.totalBytes !== chunk.expectedTotalBytes) {
          throw new Error(
            `Audio stream byte acknowledgement mismatch: ${response.totalBytes} != ${chunk.expectedTotalBytes}.`,
          );
        }
      }
    } catch (error) {
      if (!this.#cancelled) {
        this.#failure = error;
        this.#queue.length = 0;
        this.#onError(error);
      }
      throw error;
    }
  }
}

export class LivePcmCapture {
  readonly #context: AudioContext;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #worklet: AudioWorkletNode;
  readonly #silentGain: GainNode;
  readonly #resampler: StreamingPcm16Resampler;
  readonly #onChunk: (chunk: Uint8Array) => void;
  readonly #onError: (error: unknown) => void;
  #stopped = false;

  private constructor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    worklet: AudioWorkletNode,
    silentGain: GainNode,
    onChunk: (chunk: Uint8Array) => void,
    onError: (error: unknown) => void,
  ) {
    this.#context = context;
    this.#source = source;
    this.#worklet = worklet;
    this.#silentGain = silentGain;
    this.#resampler = new StreamingPcm16Resampler(context.sampleRate);
    this.#onChunk = onChunk;
    this.#onError = onError;
    this.#worklet.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
      try {
        for (const chunk of this.#resampler.push(event.data)) {
          this.#onChunk(chunk);
        }
      } catch (error) {
        this.#onError(error);
      }
    };
  }

  static async start(
    stream: MediaStream,
    onChunk: (chunk: Uint8Array) => void,
    onError: (error: unknown) => void,
  ): Promise<LivePcmCapture> {
    const context = new AudioContext({ latencyHint: "interactive" });
    let moduleUrl: string | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let worklet: AudioWorkletNode | null = null;
    let silentGain: GainNode | null = null;
    try {
      moduleUrl = URL.createObjectURL(new Blob([audioWorkletSource()], { type: "text/javascript" }));
      await context.audioWorklet.addModule(moduleUrl);
      source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, "foundry-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      await context.resume();
      return new LivePcmCapture(context, source, worklet, silentGain, onChunk, onError);
    } catch (error) {
      clearAudioWorkletHandler(worklet);
      disconnectAudioNode(source);
      disconnectAudioNode(worklet);
      disconnectAudioNode(silentGain);
      await closeAudioContext(context);
      throw error;
    } finally {
      if (moduleUrl !== null) {
        URL.revokeObjectURL(moduleUrl);
      }
    }
  }

  async stop(): Promise<Uint8Array[]> {
    if (this.#stopped) {
      return [];
    }
    this.#stopped = true;
    this.#worklet.port.onmessage = null;
    this.#source.disconnect();
    this.#worklet.disconnect();
    this.#silentGain.disconnect();
    const finalChunks = this.#resampler.finish();
    await this.#context.close();
    return finalChunks;
  }
}

function clearAudioWorkletHandler(worklet: AudioWorkletNode | null): void {
  if (worklet === null) {
    return;
  }
  try {
    worklet.port.onmessage = null;
  } catch {
    // Continue releasing the remaining partially constructed audio resources.
  }
}

function disconnectAudioNode(node: AudioNode | null): void {
  if (node === null) {
    return;
  }
  try {
    node.disconnect();
  } catch {
    // A setup failure can leave the node constructed but not connected.
  }
}

async function closeAudioContext(context: AudioContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Preserve the original setup failure after best-effort resource release.
  }
}

function floatToPcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

function encodePcmSamples(samples: readonly number[]): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  samples.forEach((sample, index) => {
    view.setInt16(index * 2, sample, true);
  });
  return output;
}

function audioWorkletSource(): string {
  return `
class FoundryPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      const channels = input.map((channel) => channel.slice());
      this.port.postMessage(channels, channels.map((channel) => channel.buffer));
    }
    return true;
  }
}
registerProcessor("foundry-pcm-capture", FoundryPcmCaptureProcessor);
`;
}
