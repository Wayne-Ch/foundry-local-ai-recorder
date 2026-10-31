# Foundry Local Smart AI Recorder

Windows-first Electron prototype for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop, using the same owned capture.
3. **Qwen post-session summary** generated only from the reviewed Whisper final transcript.

The core record-then-transcribe path remains usable when live captions are disabled or Nemotron
preparation fails. There are no canned transcript or summary fallbacks.

## What is real

| Responsibility | Exact implementation |
|---|---|
| SDK | `foundry-local-sdk@2.2.1`, in-process native sessions |
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` / `CPUExecutionProvider` |
| Final ASR | `openai-whisper-tiny-generic-cpu:4` / `CPUExecutionProvider` |
| Summary | `qwen3-0.6b-generic-gpu:2` / `WebGPUExecutionProvider` |
| Live audio | PCM16LE, 16 kHz, mono, 100 ms chunks, bounded eight-chunk renderer/native queues |
| Whisper input | Application-owned validated temporary WAV passed through `Item.audioFromUri(...)` |
| Summary input | Exact, untrimmed Whisper string/version captured by `TranscriptStore.submitForSummary()` |

Nemotron uses `Item.audioDescriptor("pcm", 16000, 1)`, a borrowed `ItemQueue`,
`Item.bytes(...)`, `markFinished()`, and `AudioSession.processStreamingRequest()`. Its replaceable
partials and terminal aggregate are display/evidence only. The controller does not write either to
durable transcript state.

Whisper receives the same bounded PCM capture after Stop. The application caps accumulation at
exactly 960,000 PCM bytes/30,000 ms, writes an owner-tracked WAV with mode `0600`, creates an
`AudioSession`, adds `Item.audioFromUri(...)`, requires a nonblank terminal `SpeechResult`, preserves
that returned string without trimming or whitespace normalization, and removes the WAV in
`finally`.

Qwen uses `ChatSession`, system/user messages, `preflightRequest()`, and `processRequest()`.
Thinking is disabled through `chat_template_kwargs` so the small model spends its bounded output
budget on the summary. The prompt requests concise plain text with readable Unicode notation, but
the application does not trust prompt compliance: the controller retains the exact raw Qwen text
in Developer Trace, applies one deterministic display formatter, and stores only that formatted
text in the editable Summary state. The formatter converts a narrow token set only inside explicit
dollar-delimited math or confidently bounded equation-like spans. It protects code and HTML
literals, leaves paths and quoted or prose backslash commands intact, preserves ambiguous
unbraced exponents, repairs only simple attached exponent closers, and normalizes pathological
whitespace outside protected regions. A non-`stop`, empty, stale-version, or oversized result
fails visibly.

## Windows setup

Validated on Wayne Chuang's Windows 11 x64 machine with Node.js `26.13.0`.

```powershell
npm install
npm run fixture:generate
npm run start
```

The project pins patched Electron `42.11.18`. The root `postinstall` runs
`scripts/ensure-electron.ps1`, which guards the Node 26 archive-extraction edge encountered during
initial setup: it first uses Electron's installer, then repairs from Electron's verified local cache
with Windows `Expand-Archive` when necessary.

Select **Prepare local models** before recording. Preparation can use the network to download an
uncached model or the WebGPU execution-provider bundle. Once cached and loaded, inference uses
native in-process sessions; the application does not start the Foundry embedded web service and has
no cloud inference endpoint.

## Run and validate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:electron
npm run probe:microphone-permission
npm run probe:stream-owner
npm run capture:ui
npm run test:whisper-integration
npm run test:nemotron-integration
npm run test:summary-integration
npm run test:chain-integration
npm audit --audit-level=low
```

The integration scripts use `fixtures/ode-lesson.wav`, generated locally by Windows Speech
Synthesis from original ODE teaching text. No copyrighted lecture material is included.

## Product behavior

- Recording requires an explicit consent checkbox and transient user-gesture microphone grant.
- Live captions are optional. A failed Nemotron preparation leaves loaded Whisper and Qwen models
  intact and reports the Whisper-only fallback.
- Stop disables microphone input and releases tracks first, snapshots the exact bounded PCM
  independently, then finalizes or initiates cancellation of optional Nemotron best-effort. A
  timed-out or still-pending cancel is observed separately and quarantines only the live-caption
  slot; valid PCM proceeds immediately to Whisper, and Qwen remains available after the final.
- The timer and byte/frame limit share the authoritative capture boundary. Automatic and manual
  Stop races have one winner, and the final PCM cannot exceed exactly 30 seconds.
- The final transcript is editable. A correction increments its version and invalidates a prior
  summary.
- **Generate summary** submits only the current final transcript version. Recorded audio and
  imported WAV files converge on this same summary path.
- Developer Trace keeps the exact raw Qwen response and records whether display formatting was
  applied. The editable Summary textarea receives the formatted text, and user edits continue from
  that formatted value.
- **Delete / reset** cancels and discards an active recording without calling Nemotron finish,
  Whisper, or Qwen; it then removes owned temporary audio and clears transcript, summary, timing,
  and trace state.
- Transcript and summary state are memory-only. There is intentionally no automatic retention,
  export, account sync, or background upload in this prototype.
- A local PCM16LE/16 kHz/mono WAV can be opened as a stage fallback and follows the same temporary
  WAV + Whisper path.

## Security and lifecycle

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- narrow typed preload API
- exact main-frame/document URL checks on every IPC call
- deny-by-default navigation and window creation
- short-lived microphone authorization bound to the active main frame
- main-process stream leases bound to webContents, process, frame tree node, and frame token
- cancellation on reload, navigation, render loss, webContents destruction, and window close
- deterministic queue, session, model, manager, and temporary-file cleanup
- request cancellation, session disposal, operation settlement, and temporary-file deletion are
  attempted independently so one cleanup failure cannot skip the rest
- optional Nemotron cancellation has a scoped single-flight drain: it rejects another live stream
  but does not enter the global inference barrier for already-loaded Whisper or Qwen
- Reset and shutdown share one durable cleanup generation. A caller-facing timeout does not clear
  that generation or enqueue duplicate temporary cleanup, model unload, manager shutdown, or
  manager disposal
- temporary-file deletion, model unload, and manager shutdown/disposal remain behind the global
  drain barrier and run only after every native session settles; timeout never authorizes early
  teardown
- manager-epoch-bound model slots retain ownership after a failed loaded-state probe or unload, so
  manager shutdown/disposal is deferred until a later retry confirms every model slot is clear
- fail-closed in-process endpoint validation on every Prepare retry and before new inference; guard
  failure quarantines the rejected manager until both shutdown and disposal are confirmed, and a
  retry cannot create a replacement manager while cleanup remains unsafe
- preload/native failures become canonical `{ code, name, safeSummary, truncated }` diagnostics.
  Raw messages, paths, usernames, credentials, and arbitrary suffixes are never rendered in status
  or Developer Trace, so diagnostic content cannot block valid PCM or leak local identity
- startup orphan recovery removes only owned `capture-*.wav` files; locked retained files produce a
  UI/Developer Trace warning with count, hidden-path policy, and retry guidance

## Configuration overrides

Each override requires an exact model ID and execution provider together. Invalid or partial
overrides fail; they never silently fall back.

| Role | Model variable | Provider variable |
|---|---|---|
| Whisper | `SMART_RECORDER_WHISPER_MODEL_ID` | `SMART_RECORDER_WHISPER_EXECUTION_PROVIDER` |
| Nemotron | `SMART_RECORDER_NEMOTRON_MODEL_ID` | `SMART_RECORDER_NEMOTRON_EXECUTION_PROVIDER` |
| Summary | `SMART_RECORDER_SUMMARY_MODEL_ID` | `SMART_RECORDER_SUMMARY_EXECUTION_PROVIDER` |

Overrides are labeled not stage-validated unless they exactly match the built-in pair.

Other paths:

- `SMART_RECORDER_APP_DATA_DIR`
- `FOUNDRY_MODEL_CACHE_DIR`

## Current limits

- Windows 11 x64 only.
- English speech only.
- 30-second bounded capture; this is a classroom demo bound, not a lecture-length stability claim.
- Imported WAV files must already be PCM16LE, 16 kHz, mono.
- The small Qwen model is concise and fast on this machine, but its raw response can render
  mathematical notation imperfectly. The narrow display formatter repairs known artifacts only in
  explicit or strongly signaled math spans; ambiguous prose, paths, literal commands, and
  unbraced multi-token exponents remain unchanged. Model wording remains explicitly AI-generated
  and editable.
- Physical network-disconnect rehearsal remains a manual release gate. Passing integration tests
  proves in-process local inference and no application cloud endpoint, not that every machine-level
  network path was physically disconnected.
- Foundry Local logs show nonessential telemetry disabled, while SDK process information may still
  initialize. This is separate from inference and is documented rather than hidden.

## Application versus Foundry Local

**Application-owned:** consent, capture, resampling, bounds, IPC/frame ownership, temporary WAV
ownership, transcript versioning, summary submission policy, rendering, trace, and cleanup.

**Foundry Local-owned:** catalog resolution, model download/cache/load, execution-provider
registration, `AudioSession`/`ChatSession`, token preflight, and native inference.

## Later image-processing boundary

Image processing is deliberately absent. A later feature should add a separate typed image-ingest
service and model slot, then attach extracted evidence to a finalized transcript version. It must
not share microphone stream ownership, mutate live caption drafts, or bypass the existing
transcript-version/summary boundary.

See [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md), [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md), and
[VALIDATION.md](VALIDATION.md).
