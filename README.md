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
preparation fails. Summary, text chat, and image turns reuse one prepared
`qwen3.5-0.8b-generic-cpu:3` model through fresh request sessions. **Delete / reset** clears the
current recording and assistant state while preserving prepared model readiness. There are no
canned transcript, summary, image-analysis, or chat fallbacks.

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

The detailed queue, session, generation, image-byte zero-fill, stale-result, cleanup, and Clinic
handoff contracts are documented in [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md). Measured model,
benchmark, fixture, and recovery evidence is retained in [VALIDATION.md](VALIDATION.md).

## Fresh clone, install, and launch

### Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for Electron, dependencies, and model/execution-provider assets.
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
tested to the same depth. No minimum RAM requirement has been established; 64 GB describes the
validated machine, not a product minimum.

From the parent folder where you want the canonical `enhanced-ai-recorder` clone:

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
npm ci
npm run build
npm run start:built
```

The project pins Electron `42.11.18`. The root `postinstall` first runs
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

For the guarded clean-disposable-worktree procedure used to validate older Windows checkouts, see
[VALIDATION.md](VALIDATION.md). Normal onboarding never rewrites an existing working tree.

First preparation can take several minutes while uncached model and execution-provider assets
download; stay online and keep Enhanced AI Recorder open until all three model cards report
**READY**. Later demo actions can run offline.

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

The probes create ignored screenshots and operation journals; the exact artifact paths, measured
latencies, model identities, and completed target-Windows multimodal results are recorded in
[VALIDATION.md](VALIDATION.md).

## Product behavior

- **Prepare local models** reports truthful phases and reaches
  **Enhanced AI Recorder offline ready · 3/3 models** only when Nemotron, Whisper, and Shared Qwen
  are loaded.
- Recording requires consent and a transient microphone grant. Nemotron remains a replaceable live
  draft; Stop releases the microphone and sends the same bounded capture to Whisper for the
  authoritative editable final.
- **Generate summary** uses only the current Whisper transcript version. Recorded audio and the
  committed stage fallback WAV follow the same path.
- **Ask AI**, image analysis, and summary reuse the prepared Shared Qwen model through fresh
  request sessions. A Local AI row may show **Waiting locally…**, prepared-offline or cached-model
  startup, then **Thinking locally…** when inference begins.
- Image selection accepts bounded PNG/JPEG/WebP input and exposes only safe metadata and a
  thumbnail to the renderer. Analysis returns **Visible text/objects**, **Relation to lesson**, and
  **Uncertainty**.
- Classroom mode explains lesson material. Clinic mode remains educational and clinician-led,
  never making diagnosis, urgency, or treatment decisions; bounded medical-decision questions end
  with the fixed treating-clinician handoff.
- Developer Trace retains exact raw Qwen output while the visible summary/chat presentation stays
  safe and editable.
- **Delete / reset** clears recording, transcript, summary, chat, image, timing, and trace state
  while retaining truthful three-model readiness. Transcript and assistant state are memory-only.

## Security and lifecycle

- Electron runs with context isolation and sandboxing enabled, Node integration disabled, a narrow
  typed preload API, exact renderer identity checks, and denied navigation/window creation.
- Microphone, audio-stream, and assistant work are bound to short-lived main-process ownership and
  cancelled on reload, navigation, render loss, destruction, or close.
- Image bytes, request provenance, queues, session disposal, model ownership, manager generation,
  Reset/shutdown drains, and temporary-file cleanup follow deterministic fail-closed contracts.
- Model/user markup remains inert text; supported math alone is rendered through KaTeX with trust
  disabled.
- Diagnostics expose canonical safe metadata rather than raw native messages, local paths,
  usernames, credentials, or arbitrary suffixes.

See [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md) for the queue/session/zero-fill/manager-generation
design and [VALIDATION.md](VALIDATION.md) for the complete regression matrix and recovery evidence.

## Configuration overrides

Each override requires an exact model ID and execution provider together. Invalid or partial
overrides fail; they never silently fall back.

| Role | Model variable | Provider variable |
|---|---|---|
| Whisper | `ENHANCED_AI_RECORDER_WHISPER_MODEL_ID` | `ENHANCED_AI_RECORDER_WHISPER_EXECUTION_PROVIDER` |
| Nemotron | `ENHANCED_AI_RECORDER_NEMOTRON_MODEL_ID` | `ENHANCED_AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER` |
| Summary | `ENHANCED_AI_RECORDER_SUMMARY_MODEL_ID` | `ENHANCED_AI_RECORDER_SUMMARY_EXECUTION_PROVIDER` |

The Shared Qwen override must preserve the exact
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
- No minimum RAM requirement has been established; the validated machine had 64 GB.
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
- Target-Windows vision, assistant-chat, and concurrent-chain evidence is complete; it does not
  replace the manual physical network-disconnect rehearsal.
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
Enhanced validation clone. Within Enhanced AI Recorder, **Delete / reset** retains shared-model
offline readiness. If native cleanup fails, close the app and restart.

See [PLAYTEST.md](PLAYTEST.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md),
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md), and [VALIDATION.md](VALIDATION.md).
