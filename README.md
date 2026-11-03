# Foundry Local Smart AI Recorder

> **Colleague playtest:** follow the
> [Windows 11 setup and hands-on guide](PLAYTEST.md) on
> `feature/multimodal-classroom-chat`.

Windows-first Electron prototype for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop, using the same owned capture.
3. **Qwen post-session summary** generated only from the reviewed Whisper final transcript.
4. **Optional local lesson assistant** for bounded image understanding and side chat while capture
   continues.

The core record-then-transcribe path remains usable when live captions are disabled or Nemotron
preparation fails. Image/chat share the one validated Foundry manager but use a separate optional
operation generation, CPU vision-language model slot, queue, and renderer-session lease. Both
text-only and image turns use the exact optional `qwen3.5-0.8b-generic-cpu:3` slot; the core
summary model is exclusive to transcript summary. Assistant failure or cleanup cannot unload or mutate the
Nemotron → Whisper → Qwen slots. There are no canned transcript, summary, image-analysis, or chat
fallbacks.

## What is real

| Responsibility | Exact implementation |
|---|---|
| SDK | `foundry-local-sdk@2.2.1`, in-process native sessions |
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` / `CPUExecutionProvider` |
| Final ASR | `openai-whisper-tiny-generic-cpu:4` / `CPUExecutionProvider` |
| Summary | `qwen3-0.6b-generic-gpu:2` / `WebGPUExecutionProvider` |
| Optional text + image chat | exact `qwen3.5-0.8b-generic-cpu:3` / CPU / `CPUExecutionProvider`, accepted only after runtime task/modality/EP validation; fresh per-turn `ChatSession` |
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

The optional assistant uses the exact Foundry Local 2.2.1 multimodal shape:
`Item.userMessage([Item.text(...), Item.imageFromData(...)])`, `ChatSession`,
`preflightRequest()`, `processRequest()`, and request cancellation. Each request gets a fresh
`ChatSession`, so Clear removes the only durable chat memory and clinic/classroom safety applies to
every turn. Text-only chat, image analysis, and direct image chat all use the same exact optional
CPU VLM `ModelSlot`, owned by the shared manager generation. The summary `ModelSlot` is never used
for side chat. Reset can unload only the optional VLM slot after its native request settles; core
slots remain loaded and callable while optional cleanup drains.

Images are selected only by a main-process file dialog. PNG/JPEG/WebP extension-derived MIME and
magic signatures must agree; input is capped at 10 MiB, 8,192 px per side, and 24 million pixels.
SVG, HTML, PDF, and Office files are rejected. The renderer receives only a PNG thumbnail plus
sanitized basename, original MIME, byte size, and dimensions—never a filesystem path or original
bytes. Analysis attaches to an exact image/context version and is discarded when stale. A final
transcript is preferred; otherwise a labeled ephemeral live-draft snapshot is used. Image analysis
keeps the complete transcript/version in its SHA-256 context fingerprint for stale-state checks,
but sends only a deterministic, whitespace-normalized lesson-topic excerpt to the VLM: the first
complete sentence(s) that fit within 160 characters, with a word-safe cap when no sentence fits.
Classroom/Clinic safety is supplied once as the system message. The image turn uses deterministic
sampling, `earlyStopping: true`, and a 180-token output reserve; its user prompt requires exactly
three ordered, bounded sections, rejects repetition, and stops immediately after Uncertainty.
Parsing remains fail-closed with the existing section and size bounds. For Clinic questions that
use bounded diagnosis, urgency/emergency, treatment, medication/prescription, or direct
`what should the patient do/start/take` wording, the application appends one fixed clinician
handoff to the visible answer when it is absent. The addition is not written into later model chat
history, and the exact local-model output remains unchanged in the `chat-raw` Developer Trace
entry.

The renderer's existing PNG thumbnail is a UI-only safety boundary. The reproduced repetition used
the 13.6 KiB, 1280×720 `ode-slide.png`, so this mitigation intentionally does not add image
transcoding. Bounded inference resizing for genuinely large photos is separate future hardening.

## Windows setup

Validated on Windows 11 x64 with Node.js `26.13.0`.

```powershell
npm ci
npm run build
npm run start:built
```

The project pins patched Electron `42.11.18`. The root `postinstall` runs
`scripts/ensure-electron.ps1`, which guards the Node 26 archive-extraction edge encountered during
initial setup: it first uses Electron's installer, then repairs from Electron's verified local cache
with Windows `Expand-Archive` when necessary.

Repository `.gitattributes` enforces LF for text and marks image/audio/native artifacts binary, so
a fresh Windows checkout remains lint-clean even when global `core.autocrlf=true`.

The tracked fixtures are ready to use. `fixtures/ode-slide.png` is deterministically generated from
original repository bitmap code by `scripts/generate-ode-image-fixture.mjs`;
`fixtures/ode-lesson.wav` is generated from original teaching text by
`scripts/generate-ode-fixture.ps1`. `fixtures/clinic-xray.png` is a metadata-free CC0 PA chest
radiograph for the Clinic safety flow; its pinned source, transformation, checksum, and
de-identification review are in `fixtures/clinic-xray.provenance.md`. Normal setup does not
regenerate these fixtures.

For local Windows validation, use a genuinely fresh checkout created after `.gitattributes` was
added. Do not mass-rewrite an existing working tree. Only for a clean, disposable validation
worktree that was materialized earlier:

```powershell
if (git status --porcelain) { throw "Validation worktree must be clean" }
git config core.autocrlf false
git reset --hard HEAD
```

Then run lint and the model gates. Never use that reset recipe in a worktree containing changes.

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
npm run test:vision-integration
npm run test:assistant-chat-integration
npm run test:concurrent-assistant-chain-integration
npm audit --audit-level=low
```

`npm run capture:ui` uses a capture-only populated snapshot so the 1600×900 screenshot includes a
final transcript, formatted summary, and exact raw-summary trace evidence. It writes the ignored,
reproducible artifact to `artifacts\smart-ai-recorder-populated-summary.png`.

The integration scripts use `fixtures/ode-lesson.wav`, generated locally by Windows Speech
Synthesis from original ODE teaching text, and `fixtures/ode-slide.png`, generated from original
bitmap drawing code in `scripts/generate-ode-image-fixture.mjs`. No copyrighted lecture material is
included. The separate Clinic playtest fixture is the CC0, metadata-free
`fixtures/clinic-xray.png`; it is not diagnostic reference data.

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
- **Ask AI** remains available during recording. It snapshots the current live draft for that
  request only, stores only the label `live draft snapshot (may change)` in chat history, and never
  writes the draft into final transcript or summary state.
- Assistant inference is enabled after **Prepare local models**. Text-only and image requests use
  the same lazy optional CPU VLM slot and validated manager generation; the summary slot remains
  exclusive to transcript summary.
- Chat is memory-only, bounded, serialized, cancellable, and independent from summary generation.
  Suggested prompts include a one-sentence ODE definition, a practical example, and one-sentence
  explanation of the selected image.
- **Image** accepts a bounded lecture/blackboard/diagram/slide screenshot or the pinned Clinic
  X-ray fixture. Analysis returns three concise fields: visible text/objects, relation to lesson
  context, and uncertainty. A saved transcript correction immediately marks prior analysis
  unavailable and queues re-analysis; stale image/context results are rejected.
- Classroom mode explains lesson material. Clinic mode is educational and clinician-led only: no
  diagnosis, urgency assessment, treatment recommendation, or interpreter replacement.
  Switching modes cancels every assistant request, clears chat/analysis, and leaves any selected
  image explicitly unanalyzed until it is processed again in the new mode. Bounded medical-decision
  questions in Clinic mode visibly end with
  `Diagnosis, urgency, and treatment decisions must be made by the treating clinician.`
- Developer Trace keeps the exact raw Qwen response and records whether display formatting was
  applied. It also keeps exact raw optional-assistant output before the Clinic handoff is added.
  The editable Summary textarea receives the formatted text, and user edits continue from that
  formatted value.
- **Delete / reset** cancels and discards an active recording without calling Nemotron finish,
  Whisper, or Qwen; it then removes owned temporary audio and clears transcript, summary, timing,
  assistant chat/image bytes/thumbnail/analysis, timing, and trace state.
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
- separate assistant session leases bound to the same exact renderer identity and an unguessable
  session generation
- cancellation on reload, navigation, render loss, webContents destruction, and window close
- queued work captures only immutable mode/image/context tokens. Raw image bytes are copied only
  when the task begins, remain pinned through native settlement, and are then zero-filled;
  replace/remove/reset/shutdown also zero-fill the retained original
- one global manager/endpoint guard/shutdown lifecycle for core and assistant; there is no second
  `FoundryLocalManager`
- the optional assistant lane is internally serialized but completely separate from the core Qwen
  summary lane. A cancelled assistant request that never settles can reject new assistant work but
  cannot delay recording, Whisper, Nemotron, core reset, or summary
- Reset immediately clears visible assistant active/image/chat state. Native cancellation and
  vision-slot unload may continue under an explicit optional-draining status, which rejects new
  assistant work without blocking recording, Whisper, or core cleanup
- assistant responses are rendered only with `textContent`/text nodes; exact raw local model output
  remains Developer Trace evidence
- deterministic queue, session, model, manager, and temporary-file cleanup
- request cancellation, session disposal, operation settlement, and temporary-file deletion are
  attempted independently so one cleanup failure cannot skip the rest
- native assistant cancel callbacks are exception-contained; cleanup diagnostics are surfaced
  safely, abort listeners are removed deterministically, and every tracked image copy is released
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
| Optional assistant | `SMART_RECORDER_VISION_MODEL_ID` | `SMART_RECORDER_VISION_EXECUTION_PROVIDER` |

Overrides are labeled not stage-validated unless they exactly match the built-in pair. Optional
assistant variables must be supplied together and must preserve the exact
`qwen3.5-0.8b-generic-cpu:3` / `CPUExecutionProvider` / `CPU` target; alternate assistant
model/device/provider combinations fail closed.

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
- Cloud validation cannot prove the Windows CPU VLM. The three multimodal integration commands
  above are mandatory on the target Windows machine before claiming real image/chat evidence.
- Alternate assistant model/device/provider overrides are rejected. There is no silent CPU/GPU
  fallback.
- Foundry Local logs show nonessential telemetry disabled, while SDK process information may still
  initialize. This is separate from inference and is documented rather than hidden.

## Application versus Foundry Local

**Application-owned:** consent, capture, resampling, bounds, IPC/frame ownership, temporary WAV
ownership, transcript versioning, summary submission policy, rendering, trace, and cleanup.

**Foundry Local-owned:** catalog resolution, model download/cache/load, execution-provider
registration, `AudioSession`/`ChatSession`, token preflight, and native inference.

## Rollback

The feature is isolated on `feature/multimodal-classroom-chat`; `main` remains unchanged. To return
to the stable recorder, launch/build `main` or the previously deployed SHA. Within this feature
build, simply avoid the optional right-side panel: the CPU assistant slot is not prepared until a
chat or image request is made. If optional native cleanup fails, close the app and restart; the core
recorder remains the authoritative recovery path.

See [PLAYTEST.md](PLAYTEST.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md),
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md), and [VALIDATION.md](VALIDATION.md).
