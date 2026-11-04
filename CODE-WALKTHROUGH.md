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
> Nemotron flush/finalization is optional. When cancellation is required, the renderer initiates it
> and observes the safe result independently instead of awaiting it before Whisper. Reset uses the
> cancellation path and never calls finish, transcription, or summary.

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
`src/summary/summary-format.ts`, `src/foundry/foundry-runtime.ts`,
`src/renderer/app.ts`

Show:

- `submitForSummary`;
- the trace line stating live captions are excluded;
- `preflightRequest`;
- Qwen's `enable_thinking: false`;
- the raw `summary-raw` trace entry and `summaryDisplayFormattingApplied` field;
- the single controller-side display formatter used after either recorded or imported audio;
- literal textarea/`textContent` rendering rather than HTML or Markdown interpretation;
- non-`stop` and empty-output failures.

Message:

> The controller passes the exact submitted Whisper string. The model cannot reach live draft
> state, and a stale transcript version prevents the result from being attached. Qwen's exact raw
> response remains in Developer Trace; only the deterministic plain-text display form enters the
> editable Summary state.

## 9:30-10:45 — Main-owned image ingest and stale-result rejection

**Files:** `src/assistant/image-security.ts`, `src/main/main.ts`,
`src/main/assistant-controller.ts`, `src/assistant/assistant-state.ts`

Show:

- the generation/session-leased main-process picker and extension/MIME/signature checks;
- PNG/JPEG/WebP dimension parsing before decode;
- state revalidation after dialog/stat/read/decode boundaries, original-byte zero-fill, and the PNG
  thumbnail-only renderer contract;
- final-transcript → ephemeral-live-draft → none context priority;
- full transcript/version fingerprinting for image/context token comparison in `applyImageAnalysis`;
- the separate 160-character sentence-bounded lesson-topic excerpt used only by the multimodal
  prompt, so a tail-only correction still invalidates stored or in-flight analysis;
- system-only safety plus deterministic early stopping and a 180-token image output reserve to
  contain the known small-Qwen VLM repetition failure;
- automatic re-analysis after Whisper final/import/correction.

Message:

> The renderer never receives a path or original bytes. Image analysis is an optional,
> version-attached note. If the image or lesson context changes while inference runs, the result is
> trace evidence only and cannot attach to current state. The safe UI thumbnail is unchanged; the
> reproduced 13.6 KiB fixture is not an image-size failure, so large-photo inference resizing is a
> separate future hardening item.

## 10:45-12:15 — Side chat is separate from capture and summary

**Files:** `src/assistant/assistant-queue.ts`, `src/main/assistant-controller.ts`,
`src/foundry/optional-vision-chat-runtime.ts`, `src/foundry/foundry-runtime.ts`

Show:

- the bounded serialized queue and AbortSignal cancellation;
- per-request live-draft snapshot with durable labels but no durable draft text;
- memory-only chat history admitted to prompts only when its mode/image/context provenance still
  matches;
- one prepared `qwen3.5-0.8b-generic-cpu:3` in the summary `ModelSlot`, shared by transcript
  summary, text chat, and image analysis;
- one fresh `ChatSession` for every summary or assistant generation;
- exact `Item.userMessage` text/image parts;
- one shared validated manager and manager generation;
- independent recorder/assistant generations, queues, cancellation, histories, prompts, and safety
  boundaries even though the prepared model allocation is shared;
- a summary lane that never waits for optional assistant cancellation or native settlement;
- enqueue-time operation tokens and execution-time image-byte copies with deterministic zero-fill;
- immediate visible Reset that clears user/session state, cancels and drains in-flight sessions, and
  retains the shared model as READY for the next summary or assistant request;
- shutdown-only shared-slot unload under the manager cleanup barrier;
- clinic prompt prohibitions.

Message:

> Asking during recording never enters the audio controller. Summary, text, and image generations
> borrow one prepared Qwen model but always use fresh ChatSessions and independent generations,
> queues, histories, prompts, and safety boundaries. Requests capture immutable provenance at
> enqueue and copy image bytes only at execution. Reset clears user/session state while keeping the
> shared model READY; shutdown drains native work and unloads the shared slot.

## 12:15-13:15 — Model preparation preserves working slots

**Files:** `src/foundry/model-slot.ts`, `src/foundry/foundry-runtime.ts`

Show that Whisper, Nemotron, and summary have separate slots. `ModelSlot.activate` loads the
candidate before swapping and unloading a prior model in that same slot.

Message:

> Optional Nemotron preparation cannot unload Whisper or Qwen. A candidate load failure leaves the
> prior working slot active and the UI falls back explicitly.

## 13:15-14:15 — Stream and assistant ownership survive renderer churn

**Files:** `src/main/audio-stream-owner.ts`, `src/main/assistant-session-owner.ts`,
`src/main/main.ts`

Show the owner tuple and cancellation hooks for navigation, reload, render loss, destruction, and
window close.

Message:

> Audio streams and assistant requests have separate leases but the same exact renderer identity.
> Reload, navigation, render loss, destruction, and close cancel both lanes; stale partials and
> model results never reach a replacement renderer.

## 14:15-15:30 — Deterministic cleanup and fail-closed mode

Show:

- endpoint validation before manager acceptance and every Prepare retry;
- tracked Nemotron, Whisper, and Qwen cancellation/settlement;
- the scoped Nemotron drain that blocks only another live stream while Whisper/Qwen continue;
- the durable Reset/shutdown generation whose bounded public result survives timeout and retry;
- queue/session disposal only after settlement, with temp/model/manager teardown behind the global
  barrier and exactly once per generation;
- model unload retry that keeps the manager quarantined until every slot is clear;
- rejected-manager quarantine until shutdown and disposal are both confirmed;
- canonical structured diagnostics that never render raw native/IPC messages or local paths;
- reset clearing derived state without processing captured audio;
- optional assistant reset immediately clearing chat/image state and cancelling its queue without
  waiting on core cleanup;
- optional session drain on Reset while the shared Qwen slot remains READY, with shared-slot unload
  deferred to shutdown under the existing manager cleanup barrier;
- Reset hiding stale assistant activity immediately while the native drain rejects only new
  optional work;
- startup `capture-*.wav` orphan recovery and locked-file warning.

## 15:30-17:00 — Evidence, not claims

**Files:** `tests/recorder-controller.test.ts`, `tests/audio-contract.test.ts`,
`tests/audio-stream-owner.test.ts`, `tests/assistant-controller.test.ts`,
`tests/image-security.test.ts`, `scripts/run-chain-integration.ts`,
`scripts/run-concurrent-assistant-chain-integration.ts`, `VALIDATION.md`

The key regression asserts:

```ts
expect(summary.summaryInput).toBe(final.result.transcript);
expect(summary.summaryInput).not.toContain("live partial");
expect(summary.summaryInput).not.toContain("Nemotron terminal");
expect(summary.snapshot.transcript.summary?.text).not.toContain("\\cdot");
expect(summary.snapshot.trace.findLast((entry) => entry.phase === "summary-raw")?.detail)
  .toBe(rawQwenResponse);
```

Close with the measured core chain, cloud static evidence, and the still-mandatory target-Windows
VLM/chat/concurrent-chain gates.
