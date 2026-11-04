# Enhanced AI Recorder

**Enhanced AI Recorder** extends
[AI Recorder](https://github.com/Wayne-Ch/foundry-local-ai-recorder)
and its [standard colleague guide](https://github.com/Wayne-Ch/foundry-local-ai-recorder/blob/main/PLAYTEST.md).
It preserves the standard recording, Whisper final transcript, and Qwen summary path, then adds
these Enhanced-only capabilities:

- **Ask AI** text assistance during and after recording.
- **Image analysis** plus **Explain image** for the selected lesson or Clinic fixture.
- **Classroom** mode for bounded lesson help.
- **Clinic · educational only** mode with a required clinician handoff and no diagnosis, urgency,
  or treatment decisions.

Follow the [Enhanced AI Recorder colleague playtest](PLAYTEST.md) on
`enhanced-ai-recorder`.

Windows-first Electron app for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop, using the same owned capture.
3. **Shared Qwen summary + lesson assistant** generated from the reviewed Whisper final transcript
   or used for bounded text/image help while capture continues.

The core record-then-transcribe path remains usable when live captions are disabled or Nemotron
preparation fails. Summary, text chat, and image turns share one prepared
`qwen3.5-0.8b-generic-cpu:3` `ModelSlot`, but each request gets a fresh `ChatSession` and keeps its
own generation, queue, cancellation, safety, and stale-result guards. Assistant reset clears
session/user state without unloading the prepared shared model; shutdown unloads all three slots.
There are no canned transcript, summary, image-analysis, or chat fallbacks.

## What is real

| Responsibility | Exact implementation |
|---|---|
| SDK | `foundry-local-sdk@2.2.1`, in-process native sessions |
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` / `CPUExecutionProvider` |
| Final ASR | `openai-whisper-tiny-generic-cpu:4` / `CPUExecutionProvider` |
| Shared summary + text/image assistant | exact `qwen3.5-0.8b-generic-cpu:3` / CPU / `CPUExecutionProvider`, accepted only after runtime task/modality/EP validation; fresh per-request `ChatSession` |
| Assistant math display | `katex@0.19.1`; supported inline/display delimiters only, trust disabled, prose and markup kept as text nodes |
| Live audio | PCM16LE, 16 kHz, mono, 100 ms chunks, bounded 32-chunk renderer/native queues |
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

Shared Qwen uses a fresh `ChatSession`, system/user messages, `preflightRequest()`, and
`processRequest()` for every summary and assistant turn. Thinking is disabled through
`chat_template_kwargs`. The summary prompt prioritizes source-backed fact preservation: names,
technical terms, equations, initial conditions, resolved constants, values/units/dates, ownership,
and explicit causes/results. The application does not trust presentation compliance: the
controller retains the exact raw Qwen text in Developer Trace, applies deterministic
content-preserving presentation, and stores only that formatted text in the editable Summary
state. The formatter first performs the existing protected math normalization, then safely splits
complete sentences into one overview plus bounded Unicode bullet lines. It never invents or drops
content; code/HTML/quoted spans stay opaque, long outputs are grouped in order, and unsafe
segmentation falls back to the factual paragraph. A non-`stop`, empty, stale-version, or oversized
result fails visibly.

The optional assistant uses the exact Foundry Local 2.2.1 multimodal shape:
`Item.userMessage([Item.text(...), Item.imageFromData(...)])`, `ChatSession`,
`preflightRequest()`, `processRequest()`, and request cancellation. Each request gets a fresh
`ChatSession`, so Clear removes the only durable chat memory and clinic/classroom safety applies to
every turn. Text-only chat, image analysis, direct image chat, and summary all use the same exact CPU VLM
`ModelSlot`, owned by the shared manager generation. Fresh `ChatSession` instances preserve
summary/assistant context isolation while allowing native concurrency. Reset cancels assistant
work and clears chat/image state but keeps the shared slot loaded and offline-ready; shutdown drains
requests before unloading it.

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
use bounded diagnosis, urgency/emergency, treatment, medication/prescription, or direct patient
`do/start/take` decision wording, the application normalizes any equivalent model-supplied
clinician referral and appends one fixed clinician handoff to the visible answer. The addition is
not written into later model chat history, and the exact local-model output remains unchanged in
the `chat-raw` Developer Trace entry.

Assistant chat renders supported `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` math with KaTeX.
Delimiter parsing is bounded, ordinary currency and unmatched delimiters remain text, invalid math
falls back to its literal source, and KaTeX trust is disabled. Model/user HTML remains inert text;
the renderer never inserts arbitrary model markup. Each chat request also has an identity-bound
**Waiting locally…** or **Thinking locally…** row until completion, cancellation, reset, mode
change, or failure. Image analysis similarly shows **Analyzing…** on the button and **Analyzing**
in image metadata while that exact request is pending.

The renderer's existing PNG thumbnail is a UI-only safety boundary. The reproduced repetition used
the 13.6 KiB, 1280×720 `ode-slide.png`, so this mitigation intentionally does not add image
transcoding. Bounded inference resizing for genuinely large photos is separate future hardening.

## Fresh clone, install, and launch

### Requirements

- The committed setup and playtest path is Windows 11 x64; current formal validation uses the same
  platform.
- Git.
- Node.js and npm; the root `package.json` currently declares neither an `engines` range nor a
  pinned `packageManager`.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for Electron, dependencies, and model/execution-provider assets.
- No minimum RAM value has been established by testing.
- A microphone is needed only for live voice-path testing; stage fallback WAV, typed assistant, and
  image flows remain available without one.

### Validated configuration

Formal app validation and current E2E evidence for this release were executed with Node.js
`26.13.0` and npm `11.20.0` on a Windows 11 x64 machine with AMD Radeon graphics, working WebGPU,
and 64 GB RAM. Those Node/npm versions are validation evidence, not a declared support range. All
three Foundry Local models use the documented `CPUExecutionProvider` path; AMD Radeon/WebGPU
identifies the evidence environment and is not a model requirement. This configuration is not the
product's only intended target. Foundry Local's broader public platform and hardware support is
separate, and other app environments must not be presented as having equivalent evidence until
tested to the same depth.

From the parent folder where you want the canonical `enhanced-ai-recorder` clone:

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
npm ci
npm run build
npm run start:built
```

The project pins patched Electron `42.11.18`. The root `postinstall` first runs
`scripts/ensure-foundry-native.mjs`, which invokes the SDK's supported native installer and verifies
that ONNX Runtime/GenAI dependencies are materialized, then runs `scripts/ensure-electron.ps1` to
guard the Node 26 Electron archive-extraction edge. Do not install with `--ignore-scripts`: that
skips both native runtimes. If it already happened, run `npm rebuild foundry-local-sdk`, then
`npm run build`.

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

First preparation can take several minutes while uncached model and execution-provider assets
download. Stay online and keep Enhanced AI Recorder open until all required model cards report
READY; later demo actions can run offline.

After successful Prepare, summary, Ask, Analyze, and Explain reuse the loaded shared CPU model
without catalog lookup, model download, or provider acquisition. The application does not start
the Foundry embedded web service and has no cloud inference endpoint.

## Product and storage isolation

| Surface | Enhanced namespace |
|---|---|
| npm package | `foundry-local-enhanced-ai-recorder` |
| Electron product/profile | `Enhanced AI Recorder` |
| Foundry app data and logs | `%LOCALAPPDATA%\FoundryLocalEnhancedAIRecorder` |
| Temporary audio | `%TEMP%\FoundryLocalEnhancedAIRecorder\audio` |
| Operation journal | `logs\enhanced-ai-recorder-operations-YYYY-MM-DD.jsonl` |

These paths are distinct from AI Recorder. The only intentionally shared path is the immutable
Foundry model cache, normally `%USERPROFILE%\.foundry\cache\models`.

## Run and validate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:electron
npm run probe:microphone-permission
npm run probe:stream-owner
npm run probe:assistant-ui
npm run probe:prepare-ui
npm run capture:ui
npm run test:whisper-integration
npm run test:nemotron-integration
npm run test:summary-integration
npm run test:chain-integration
npm run test:vision-integration
npm run test:assistant-chat-integration
npm run test:concurrent-assistant-chain-integration
npm run test:offline-shared-integration
npm audit --audit-level=low
```

`npm run capture:ui` uses a capture-only populated snapshot so the 1600×900 screenshot includes a
final transcript, formatted summary, and exact raw-summary trace evidence. It writes the ignored,
reproducible artifact to `artifacts\enhanced-ai-recorder-populated-summary.png`.

`npm run probe:assistant-ui` runs a hidden sandboxed Electron renderer and inspects the resulting
DOM for rendered inline/display math, inert markup, ordinary dollar text, request-bound chat/image
progress, recorder operation labels, context labels, and accessible busy/status attributes. It
writes the ignored screenshot `artifacts\enhanced-ai-recorder-assistant-ui.png`.

`npm run probe:prepare-ui` launches the real built app with isolated Electron/app-data profiles,
clicks **Prepare local models**, waits for Whisper, shared Qwen, and Nemotron to all reach
**READY** with the visible **3/3** offline label, and
asserts visible runtime/catalog/provider/load subphases before clean model/manager shutdown. It
writes `artifacts\enhanced-ai-recorder-prepare-models-ui.png` plus a secret-safe correlated JSONL
operation journal under
the ignored probe app-data directory.

The integration scripts use `fixtures/ode-lesson.wav`, generated locally by Windows Speech
Synthesis from original ODE teaching text, and `fixtures/ode-slide.png`, generated from original
bitmap drawing code in `scripts/generate-ode-image-fixture.mjs`. No copyrighted lecture material is
included. The separate Clinic playtest fixture is the CC0, metadata-free
`fixtures/clinic-xray.png`; it is not diagnostic reference data.

## Product behavior

- Recording requires an explicit consent checkbox and transient user-gesture microphone grant.
- **Prepare local models** changes immediately to a truthful runtime/model phase. The three cards
  expose initialization, endpoint validation, catalog/cache lookup, model download, execution
  provider registration, model load, READY, or a safe role/phase error. No percentage is invented.
- Live captions are optional. A failed Nemotron preparation leaves loaded Whisper and Qwen models
  intact and reports the Whisper-only fallback.
- Recording shows **Requesting microphone…**, then **Starting local models…**. The Nemotron panel is
  explicitly busy while waiting for the first replaceable caption; Stop changes to
  **Finalizing capture…** and then **Transcribing…** while Whisper owns finalization.
- Stop disables microphone input and releases tracks first, snapshots the exact bounded PCM
  independently, then finalizes or initiates cancellation of optional Nemotron best-effort. A
  timed-out or still-pending cancel is observed separately and quarantines only the live-caption
  slot; valid PCM proceeds immediately to Whisper, and Qwen remains available after the final.
- The timer and byte/frame limit share the authoritative capture boundary. Automatic and manual
  Stop races have one winner, and the final PCM cannot exceed exactly 30 seconds.
- The final transcript is editable. A correction increments its version and invalidates a prior
  summary.
- **Generate summary** submits only the current final transcript version. Recorded audio and
  imported WAV files converge on this same summary path. A dirty correction visibly shows
  **Saving correction…** before **Generating summary…**.
- **Ask AI** remains available during recording. It snapshots the current live draft for that
  request only, stores only the label `live draft snapshot (may change)` in chat history, and never
  writes the draft into final transcript or summary state. The matching Local AI row visibly shows
  **Waiting locally…** while queued and **Thinking locally…** while active.
- Assistant inference is enabled after **Prepare local models**. Summary, text-only chat, and image
  requests reuse the same already-loaded CPU VLM slot and validated manager generation. Request
  rows distinguish queued work, prepared-offline startup, local cached loading if ever needed, and
  active inference; post-Prepare actions do not perform catalog/download/provider acquisition.
- Chat is memory-only, bounded, serialized, cancellable, and independent from summary generation.
  Suggested prompts include a one-sentence ODE definition, a practical example, and one-sentence
  explanation of the selected image. Supported inline/display LaTeX is rendered safely; ordinary
  currency, unmatched delimiters, and non-math prose remain unchanged.
- **Image** accepts a bounded lecture/blackboard/diagram/slide screenshot or the pinned Clinic
  X-ray fixture at `fixtures/clinic-xray.png`. While analysis is pending, the button and metadata
  distinguish queued, assistant model/provider loading, and active **Analyzing** with accessible
  progress. Analysis returns
  three concise fields: visible text/objects, relation to lesson context, and uncertainty. A saved
  transcript correction immediately marks prior analysis unavailable and queues re-analysis;
  stale image/context results are rejected.
- Classroom mode explains lesson material. Clinic mode is educational and clinician-led only: no
  diagnosis, urgency assessment, treatment recommendation, or interpreter replacement.
  Switching modes cancels every assistant request, clears chat/analysis, and leaves any selected
  image explicitly unanalyzed until it is processed again in the new mode. Bounded medical-decision
  questions in Clinic mode visibly end with
  `Diagnosis, urgency, and treatment decisions must be made by the treating clinician.`
  Equivalent model-supplied clinician referrals are normalized to that single final sentence.
- Developer Trace keeps the exact raw Qwen response and records whether display formatting was
  applied. It also keeps exact raw optional-assistant output before the Clinic handoff is added.
  The editable Summary textarea receives the formatted text, and user edits continue from that
  formatted value.
- **Delete / reset** cancels and discards an active recording without calling Nemotron finish,
  Whisper, or Qwen; it then removes owned temporary audio and clears transcript, summary, timing,
  assistant chat/image bytes/thumbnail/analysis, timing, and trace state. It remains available
  during native waits, visibly shows **Clearing session data**, invalidates stale renderer
  completions, and clears every progress surface on success or error while retaining truthful
  three-model readiness.
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
- the assistant lane is internally serialized and has separate generations/queues from summary,
  even though both use the same loaded model. A cancelled assistant request that never settles can
  reject new assistant work but cannot delay recording, Whisper, Nemotron, core reset, or a fresh
  summary `ChatSession`
- Reset immediately clears visible assistant active/image/chat state. Native cancellation and
  settlement may continue under an explicit assistant-draining status, which rejects new assistant
  work without unloading the shared model or blocking recording, Whisper, or core cleanup
- assistant prose and markup are rendered only with text nodes; recognized math delimiters alone
  are passed to KaTeX with trust disabled, and exact raw local model output remains Developer Trace
  evidence
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
| Whisper | `ENHANCED_AI_RECORDER_WHISPER_MODEL_ID` | `ENHANCED_AI_RECORDER_WHISPER_EXECUTION_PROVIDER` |
| Nemotron | `ENHANCED_AI_RECORDER_NEMOTRON_MODEL_ID` | `ENHANCED_AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER` |
| Summary | `ENHANCED_AI_RECORDER_SUMMARY_MODEL_ID` | `ENHANCED_AI_RECORDER_SUMMARY_EXECUTION_PROVIDER` |
The shared Summary override must preserve the exact
`qwen3.5-0.8b-generic-cpu:3` / `CPUExecutionProvider` target; alternate shared
summary/assistant models fail closed.

Other paths:

- `ENHANCED_AI_RECORDER_APP_DATA_DIR`
- `FOUNDRY_MODEL_CACHE_DIR`

## Current limits

- Formal validation and current E2E evidence cover the currently validated Windows 11 x64 AMD
  Radeon/WebGPU configuration.
- That evidence scope does not limit the product to this hardware. Other app environments have not
  yet been validated to the same depth and must not be presented as having equivalent evidence
  until tested.
- English speech only.
- 30-second bounded capture; this is a classroom demo bound, not a lecture-length stability claim.
- Imported WAV files must already be PCM16LE, 16 kHz, mono.
- The shared Qwen 0.8B model is concise and fast on this machine, but its raw response can render
  mathematical notation imperfectly. The narrow display formatter repairs known artifacts only in
  explicit or strongly signaled math spans; ambiguous prose, paths, literal commands, and
  unbraced multi-token exponents remain unchanged. Model wording remains explicitly AI-generated
  and editable.
- Physical network-disconnect rehearsal remains a manual release gate. Passing integration tests
  proves in-process local inference and no application cloud endpoint, not that every machine-level
  network path was physically disconnected.
- Cloud validation cannot prove the Windows CPU VLM. The three multimodal integration commands
  above are mandatory on the currently validated configuration before claiming real image/chat
  evidence.
- Alternate shared summary/assistant model/provider overrides are rejected. There is no silent
  CPU/GPU fallback.
- Foundry Local logs show nonessential telemetry disabled, while SDK process information may still
  initialize. This is separate from inference and is documented rather than hidden.

## Application versus Foundry Local

**Application-owned:** consent, capture, resampling, bounds, IPC/frame ownership, temporary WAV
ownership, transcript versioning, summary submission policy, rendering, trace, and cleanup.

**Foundry Local-owned:** catalog resolution, model download/cache/load, execution-provider
registration, `AudioSession`/`ChatSession`, token preflight, and native inference.

## Standard app and recovery

The standard **AI Recorder** is the repository's `main` branch. Keep it in a separate canonical
`ai-recorder` clone by following the linked standard guide; do not switch this single-branch
Enhanced validation clone. Within Enhanced AI Recorder, Reset retains shared-model offline
readiness. If native cleanup fails, close the app and restart.

See [PLAYTEST.md](PLAYTEST.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md),
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md), and [VALIDATION.md](VALIDATION.md).
