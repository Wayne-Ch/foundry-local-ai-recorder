# Level 300 code walkthrough

## 0:00-1:00 — Product state is not model output

**File:** `src/transcript/transcript-store.ts`

Show `applyLivePartial`, `setWhisperFinal`, `editFinal`, and `submitForSummary`.

Message:

> Live captions are replaceable display state. Only `setWhisperFinal` creates a durable version.
> Whisper's nonblank returned string is retained exactly; newlines, repeated spaces, Unicode, and
> punctuation are not normalized. Summary submission captures that exact text/version pair, and a
> correction invalidates the prior summary.

## 1:00-2:15 — Secure Electron boundary

**Files:** `src/main/main.ts`, `src/preload/preload.ts`

Show:

- `contextIsolation`, sandbox, and disabled Node integration;
- typed preload methods only;
- exact sender/frame/document checks in `assertTrustedRendererIpc`;
- denied navigation and window creation.

Message:

> Renderer code cannot access Node or Foundry Local directly. Every recorder operation crosses a
> narrow, validated IPC contract.

## 2:15-3:30 — Permission is a short-lived capability

**File:** `src/main/microphone-permission.ts`

Show the transient activation, exact origin, main-frame match, single audio media type, TTL, and
consumption rules.

Message:

> A successful permission prompt is not a standing grant. It is bound to the current app document
> and consumed by the immediate microphone request.

## 3:30-5:00 — One capture feeds two ASR paths

**Files:** `src/renderer/audio-capture.ts`, `src/renderer/app.ts`

Show:

- `LivePcmCapture` and its `AudioWorklet`;
- `StreamingPcm16Resampler`;
- `BoundedPcmCapture`;
- the eight-chunk `BoundedAudioChunkPump`;
- `finalizeCapturedAudio` and `cancelRecordingAndReset`.

Message:

> The renderer resamples once to PCM16LE/16 kHz/mono. `BoundedPcmCapture` trims at the exact
> 960,000-byte contract. Stop releases tracks first and snapshots this capture independently;
> Nemotron flush/finalization is optional, so sticky pump or backpressure errors cannot block
> Whisper. Reset uses the cancellation path and never calls finish, transcription, or summary.

## 5:00-6:30 — Nemotron native streaming contract

**File:** `src/foundry/foundry-runtime.ts`

Show `startLiveStream`, `appendLiveChunk`, `finishLiveStream`, and `consumeAudioStream`.

Checkpoint:

```ts
const request = new Request()
  .addItem(Item.audioDescriptor("pcm", AUDIO_SAMPLE_RATE, AUDIO_CHANNELS))
  .addItem(queue);
const stream = session.processStreamingRequest(request, { signal });
queue.push(Item.bytes(pcmBytes.slice()));
queue.markFinished();
```

Message:

> The request borrows the queue. The app owns queue completion/disposal, enforces sequence and byte
> bounds, and treats streaming segments as replaceable hypotheses. The terminal `SpeechResult` is
> evidence, not the final product transcript. A rejected finish cancels the native stream before
> renderer ownership is released.

## 6:30-8:00 — Whisper authoritative final

**Files:** `src/audio/temp-audio-store.ts`, `src/foundry/foundry-runtime.ts`

Show `withTemporaryWav` and `transcribeCapture`.

Checkpoint:

```ts
request
  .addItem(Item.audioFromUri(filePath))
  .setOptions({ search: { temperature: 0 }, additionalOptions: { language: "en" } });
```

Message:

> The original file path is never submitted directly. PCM is validated, written to an owned WAV,
> passed to `AudioSession`, required to return a nonblank `SpeechResult`, retained exactly without
> `.trim()`, and deleted only after the request/session settles.

## 8:00-9:30 — Summary preflight and exact input

**Files:** `src/main/recorder-controller.ts`, `src/summary/summary-prompt.ts`,
`src/foundry/foundry-runtime.ts`

Show:

- `submitForSummary`;
- the trace line stating live captions are excluded;
- `preflightRequest`;
- Qwen's `enable_thinking: false`;
- non-`stop` and empty-output failures.

Message:

> The controller passes the exact submitted Whisper string. The model cannot reach live draft
> state, and a stale transcript version prevents the result from being attached.

## 9:30-10:45 — Model preparation preserves working slots

**Files:** `src/foundry/model-slot.ts`, `src/foundry/foundry-runtime.ts`

Show that Whisper, Nemotron, and summary have separate slots. `ModelSlot.activate` loads the
candidate before swapping and unloading a prior model in that same slot.

Message:

> Optional Nemotron preparation cannot unload Whisper or Qwen. A candidate load failure leaves the
> prior working slot active and the UI falls back explicitly.

## 10:45-12:15 — Stream ownership survives renderer churn

**Files:** `src/main/audio-stream-owner.ts`, `src/main/main.ts`

Show the owner tuple and cancellation hooks for navigation, reload, render loss, destruction, and
window close.

Message:

> A stream belongs to one exact renderer frame token. Stale partials fail `canRoute` and never reach
> a replacement renderer.

## 12:15-13:15 — Deterministic cleanup and fail-closed mode

Show:

- endpoint validation before manager acceptance and every Prepare retry;
- tracked Nemotron, Whisper, and Qwen cancellation/settlement;
- timeout-triggered draining status and completion promise;
- queue/session disposal only after settlement, with temp/model/manager teardown behind the same
  barrier;
- model unload order;
- rejected-manager quarantine until shutdown and disposal are both confirmed;
- bounded/redacted live-caption diagnostics that cannot invalidate Whisper audio;
- reset clearing derived state without processing captured audio;
- startup `capture-*.wav` orphan recovery and locked-file warning.

## 13:15-15:00 — Evidence, not claims

**Files:** `tests/recorder-controller.test.ts`, `tests/audio-contract.test.ts`,
`tests/audio-stream-owner.test.ts`, `scripts/run-chain-integration.ts`, `VALIDATION.md`

The key regression asserts:

```ts
expect(summary.summaryInput).toBe(final.result.transcript);
expect(summary.summaryInput).not.toContain("live partial");
expect(summary.summaryInput).not.toContain("Nemotron terminal");
```

Close with the measured exact-model chain and the still-open physical network-disconnect gate.
