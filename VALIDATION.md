# Validation record

Core model evidence: 2026-10-30 (Windows 11 x64)

Multimodal branch static/cloud evidence: 2026-11-02 (Linux cloud session)

Target-Windows Prepare/progress/native recovery evidence: 2026-11-03

Shared three-model offline-readiness evidence: 2026-11-03

## Validated identities

| Role | Exact model | Execution provider | Catalog size |
|---|---|---|---:|
| Live captions | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` | 696 MB |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` | 131 MB |
| Shared summary + text/image assistant | `qwen3.5-0.8b-generic-cpu:3` | CPU / `CPUExecutionProvider` | 1,037 MB; one prepared shared slot, fresh `ChatSession` per request |

SDK: `foundry-local-sdk@2.2.1`

Runtime log evidence:

- ONNX Runtime `1.31.0`
- ONNX Runtime GenAI `0.18.0`
- default per-user Foundry model cache
- nonessential telemetry disabled by configuration

## 2026-11-03 Prepare failure diagnosis and recovery

The original screenshot predated application-level correlation, and the native log contained no
failure entry at that time, so it cannot be tied conclusively to one exception after the fact. The
same `e000b86` worktree did reproduce a concrete setup failure:

```text
ERR_DLOPEN_FAILED: The specified procedure could not be found
...foundry_local_node.node
```

The SDK addon files existed, but `onnxruntime.dll`, `onnxruntime-genai.dll`, and
`onnxruntime_providers_shared.dll` were absent because a dependency update had been run with
`--ignore-scripts`. `npm rebuild foundry-local-sdk` restored the supported SDK runtime payload and
the real Whisper gate immediately passed. The persistent checkout now contains those files, and
the isolated real Electron Prepare probe completes all three models, so cache corruption and
second-manager contention were not reproduced.

The repository now prevents and diagnoses this class:

- root `postinstall` invokes the SDK native installer before the Electron runtime guard;
- Prepare performs a Windows native-file preflight before manager creation;
- missing/incompatible native files surface canonical `FOUNDRY_NATIVE_RUNTIME_MISSING` recovery,
  never generic success;
- catalog/cache/download/provider/load/endpoint failures retain secret-safe operation, model role,
  and phase metadata across IPC;
- Prepare/reset/shutdown write correlated secret-safe JSONL lifecycle events without raw paths,
  URLs, usernames, exception messages, tokens, or credentials.

Real isolated Electron Prepare result:

```text
PREPARE_UI_PROBE_OK
elapsedMs=10805
finalModelStates=["READY","READY","READY"]
finalStatus="Enhanced offline ready · 3/3 models. Recording, summary, chat, and image analysis stay on this PC."
resetPreservedModelStates=["READY","READY","READY"]
```

Observed button phases included runtime initialization, endpoint validation, Whisper catalog/load,
Nemotron catalog/load, and shared-Qwen catalog/load. All three are CPU models, so no WebGPU provider
registration is needed. The probe awaited clean native shutdown before process exit.

## Static validation

| Command | Result |
|---|---|
| Full Biome check in an LF-clean archive overlay | Pass; 98 files checked. The in-place checkout retains inherited CRLF in untouched files, so direct `npm run lint` reports formatting-only line-ending diffs. |
| `npm run typecheck` | Pass |
| `npm test` | Pass; 30 files, 394 tests |
| `npm run build` | Pass; main, preload, and Vite renderer |
| `npm audit --audit-level=low` | Pass after bounded retry of a feed HTTP 429; 0 vulnerabilities |
| Fresh clone with `core.autocrlf=true` | Pass; `README.md`, `src/main/main.ts`, and `src/foundry/foundry-runtime.ts` all had `CRLF=0` |

Unit coverage includes:

- replaceable partial versus final transcript semantics;
- transcript versioning and summary invalidation;
- exact Whisper-only summary input;
- exact newlines, repeated spaces, Unicode, and punctuation preserved through runtime, controller,
  durable snapshot, submitted snapshot, and Qwen prompt construction;
- generic summary fact preservation for ODE equations/conditions/constants, Project Atlas
  names/numbers/ownership/causality, and Team Aurora units/cycles/causality/action/date;
- deterministic summary presentation that preserves content while converting safely segmentable
  sentences into one overview plus bounded Unicode bullets, with idempotent fallback;
- left-to-right protected-span and dollar-delimiter scanning for both observed malformed ODE
  outputs, tight/spaced inline and display math, independent currency tokens, escaped/unmatched
  dollars, bounded implicit equations, `\cdot`, `\times`, primes, braced exponents, safe
  single-token superscripts, and multiple equations;
- one full-string delimiter/token pass that carries outer context across protected content, removes
  only globally unmatched math-adjacent closers, and preserves balanced/nested outer delimiters such
  as `{e^(−2t)}`, `f(e^(−2t))`, and `("rate", e^(−2t))`;
- no invented grouping for unbraced multi-token exponents, plus idempotent preservation of
  Windows/UNC/POSIX paths, literal and quoted commands, currency, inline/fenced code, complete
  generic HTML/XML-like elements, malformed tags, script/style/code/pre content, nested or
  unmatched braces, ordinary prose, Unicode, intentional bullets, and a generated cross-product of
  protected spans, outer delimiters, multiple math spans, currency, paths, and malformed closers;
- pathological whitespace normalization outside protected code/HTML regions, exact raw Qwen trace
  evidence, textarea/textContent-only rendering, the formatted editable-summary split, the shared
  recording/import summary path, and the deterministic populated-summary capture fixture;
- audio format, byte, duration, queue, and sequence bounds;
- exact 30-second accumulation, one-frame overflow trimming, multi-chunk boundary crossing, and
  automatic/manual Stop race;
- sticky live IPC/pump failure continuing to Whisper with track/stream cleanup and no unhandled
  rejection;
- callback-time live-caption failure retained after the pump reference is detached, including
  pending-forever cancellation, Whisper success/failure, warning UI/trace, and Reset clearing;
- cancellation/reset making zero finish, transcribe, or summary calls;
- manager-epoch model ownership, retain-for-retry cleanup, and fail-closed guard recovery when
  `isLoaded`, model unload, manager shutdown/disposal, or multiple cleanup actions fail;
- rejected-manager quarantine across combined shutdown/disposal failure, repeated cleanup failure,
  concurrent Prepare retry, later successful retry, and shutdown without replacement creation;
- endpoint guard first-fail/retry disposal, stale-model rejection, and inference blocking for
  active URL/service state;
- request-cancel failure never skipping Whisper/Qwen/Nemotron session disposal, tracked-operation
  settlement, or temporary-file deletion;
- in-flight Whisper/Qwen cancellation and settlement before session/model/manager/temp teardown,
  including Reset and shutdown races;
- scoped Nemotron drain isolation: a pending cancel rejects a new live stream while valid PCM still
  reaches Whisper, the exact final still reaches Qwen, and global shutdown defers model/manager
  teardown until the native stream settles;
- one durable Reset/shutdown cleanup generation across timeout, repeated Reset/shutdown calls,
  upgrade from Reset to shutdown, late settlement, cleanup error, and retry, with counters proving
  no duplicate temporary cleanup, model unload, manager shutdown, or manager disposal;
- canonical structured diagnostics for quoted/unquoted Windows drive, spaced UNC, POSIX, Unicode,
  credential-like, and very-long raw messages; status and Developer Trace retain no path suffix,
  username, or arbitrary raw phrase;
- native SDK materialization preflight, actionable recovery, structured IPC serialization, and
  Prepare fault/delay matrices for initialization, endpoint validation, catalog, cache, download,
  provider discovery/registration where applicable, and model load;
- immediate accessible renderer progress for Prepare/model cards, microphone/start, first Nemotron
  caption wait, Stop/finalize, Whisper final, WAV select/read/decode/transcribe, transcript save,
  summary save/generation, queued prepared-offline assistant inference, image analysis, Reset,
  cleanup, and stale-generation suppression;
- temporary WAV creation, recovery, and failure cleanup;
- EACCES/EBUSY/EPERM startup retention warnings with hidden paths and retry guidance;
- model-slot replacement failure preserving a working model;
- exact override validation;
- microphone permission gating;
- frame-token stream ownership, stale routing, reload, and close behavior;
- static absence of cloud inference endpoints, `fetch`, and embedded web-service startup.
- PNG/JPEG/WebP extension-derived MIME plus magic-signature checks, 10 MiB/file dimension/pixel
  bounds, active/document format rejection, generated ODE fixture validation, sanitized basename,
  and renderer contracts with no path/original bytes;
- final transcript versus ephemeral live-draft image/chat context priority, context labels, image
  and transcript version tokens, full-transcript fingerprints with 160-character sentence-bounded
  image-topic excerpts, tail-only correction invalidation, stale analysis rejection, and no durable
  live snapshot text;
- classroom and clinic prompts, including explicit no diagnosis, urgency assessment, treatment
  recommendation, or interpreter replacement;
- bounded serialized assistant queue, active/queued cancellation, owner revocation, Reset, mode
  changes, and stale generations;
- exact Foundry Local 2.2.1 text/image request parts, runtime catalog/task/modality/device/EP
  validation, fresh summary/assistant session disposal, request cancellation, shared-slot
  preservation across Reset, one manager creation, and the shared endpoint guard;
- concurrent Nemotron chunk acceptance while text chat runs, Whisper completion during assistant
  drain, shared CPU VLM identity for summary/text/image requests, pending-forever assistant
  cancellation with immediate summary/reset, deferred one-time shutdown cleanup, and immediate
  Reset snapshots with no stale active request;
- enqueue-time assistant generation/mode/image/context tokens, queued replace/remove/reset
  cancellation without byte ownership, execution-time copies, tracked zero-fill after request
  construction/cancel failure, and exact analysis/history provenance checks;
- Classroom-to-Clinic isolation that cancels all assistant work, clears output/analysis, retains an
  explicitly unanalyzed image, and prevents old classroom text from entering Clinic prompts;
- generation/session guarded image picking across delayed dialog/stat/read/decode boundaries, with
  Reset/stale-owner wins and zero-filled discarded buffers;
- cancel-throw containment during Reset, Clear, mode change, renderer revocation, and shutdown,
  including safe diagnostics, deterministic listener removal, session disposal, and byte release;
- safe plain-text display, inert markup, response bounds, required structured image note, raw
  assistant trace, accessible tabs/status/keyboard controls, and Electron isolation assertions.
- exact CPU VLM section-and-bullets output, inline fields, case-insensitive headings, numbered and
  bulleted objects, wrapped lines, deterministic joins, inert markup/math preservation, required
  section order, duplicate-conflict rejection, and per-field/combined parser bounds.

The test environment replaces only SDK-native `Request`, `Item`, and `ItemQueue` constructors with
typed in-memory equivalents so the cloud suite does not load Windows ONNX native libraries.
Production/integration builds continue to import the real `foundry-local-sdk@2.2.1`.

## Exact-model integrations

### Complete chain

Command:

```powershell
npm run test:chain-integration
```

Result: `CHAIN_INTEGRATION_OK`

| Evidence | Measured result |
|---|---:|
| Nemotron partial count | 92 |
| First live caption | 3,085 ms |
| Stop to Whisper final | 423 ms |
| Transcript final to summary | 2,767 ms |
| Shared Qwen generation | 2,573 ms |
| Shared Qwen prompt/completion tokens | 310 / 58 |
| Owned temporary WAV residue | 0 |
| Summary input equals exact Whisper final | true |
| In-process mode validated | true |
| External inference endpoint used | false |
| Embedded web service running / URLs | false / 0 |

Nemotron terminal:

> An ordinary differential equation relates a function to its derivatives for the first order
> equation y prime equals negative two y separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

Whisper authoritative final:

>  an ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative 2y, separate the variables. The solution is y of t equals c times
> e to the negative 2t. The initial value determines the constant c.

The leading space in that Whisper result is intentional evidence: the integration asserted that the
summary input equals the returned Whisper string exactly and differs from both the last live partial
and Nemotron terminal.

The real chain was not deliberately wedged inside the native SDK. The forced cancellation-failure
gate is covered deterministically by a direct runtime regression whose Nemotron response and
iterator remain pending: the cancel caller times out, valid PCM still reaches Whisper, Qwen receives
the exact Whisper final, the live warning remains, another live stream is rejected, and global
shutdown defers teardown until the stream is released.

### Whisper

Command: `npm run test:whisper-integration`

Result: `WHISPER_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 20,270 ms synthetic fixture;
- 354 ms transcription;
- 6/6 expected ODE words matched;
- terminal `whisper_file_final`;
- no owned temporary WAV residue;
- `externalEndpointUsed: false`.

### Nemotron

Command: `npm run test:nemotron-integration`

Result: `NEMOTRON_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 92 partials;
- first partial 1,299 ms;
- terminal finalization 109 ms;
- 6/6 expected ODE words matched;
- terminal `live_stream_final`.

### Qwen summary robustness

Command: `npm run test:summary-integration`

Result: `SUMMARY_INTEGRATION_OK`

| Fixture | Latency | Prompt tokens | Completion tokens |
|---|---:|---:|---:|
| ODE equation/initial condition/resolved constant | 2,976 ms | 319 | 64 |
| Project Atlas names/numbers/cache cause/owner/date | 2,793 ms | 311 | 55 |
| Team Aurora units/cycles/charging cause/action/date | 3,159 ms | 328 | 73 |

`SUMMARY_FACT_GATE_OK` requires every source-backed fact, rejects fixture-crossing claims and
unexpected numbers, requires `finishReason: stop`, and asserts current bounds plus formatter
stability. Raw qwen3.5 output remained exact Developer Trace evidence. The application-owned
presentation layer then split complete sentences into one overview plus Unicode bullets without
fact loss or duplication; unsafe segmentation falls back to the factual paragraph. Qwen thinking
remains disabled through `chat_template_kwargs`.

## Electron validation

| Command | Result |
|---|---|
| `npm run smoke:electron` | `ELECTRON_SMOKE_OK` |
| `npm run probe:microphone-permission` | `MICROPHONE_PERMISSION_PROBE_OK`; one fake audio track, zero video tracks, exact document/security origin |
| `npm run probe:stream-owner` | `STREAM_OWNER_PROBE_OK`; reload and close cancelled leases, stale partial routable = false |
| `npm run probe:assistant-ui` | `ASSISTANT_UI_RENDER_OK`; math safety plus immediate recorder/chat/image progress labels and ARIA busy/status states inspected |
| `npm run probe:prepare-ui` | `PREPARE_UI_PROBE_OK`; isolated real app reached Whisper/shared-Qwen/Nemotron READY with the 3/3 offline label, captured intermediate model phases, and shut down cleanly |
| `npm run capture:ui` | `UI_CAPTURE_OK`; deterministic populated-summary capture inspected successfully |
| `npm run test:offline-shared-integration` | `OFFLINE_SHARED_MODEL_OK`; post-Prepare summary/Ask/image/concurrent work made zero catalog/provider acquisition calls |

The 2026-11-02 cloud run used `xvfb-run`. Because the remote process runs as root, the four harness
launchers add Chromium `--no-sandbox` only in that root-only test environment. Production
`BrowserWindow` settings remain `sandbox: true`, `contextIsolation: true`, and
`nodeIntegration: false`; static tests enforce them.

No Electron or recorder process started by these validation commands remained. The shared machine
already had an OS-installed `foundrylocald` listener started on 2026-10-29, before this worktree
session; it was not used by the in-process runtime and was not terminated because it is not owned by
this validation run.

Populated-summary screenshot:

`artifacts\smart-ai-recorder-populated-summary.png`

Prepare/progress screenshots:

- `artifacts\prepare-models-ui.png`
- `artifacts\assistant-ui-rendering.png`

The capture-only bootstrap fixture renders a final transcript, the formatted summary text
`y′ = −2y` and `e^(−2t)`, and an expanded `summary-raw` trace row containing the exact Qwen-like
source `$ y' = -2y $` and `$ e^{-2t}} $` with **Summary display formatting applied**. The
`BrowserWindow` is 1600×900; the deterministic capture scroll position keeps the final transcript,
summary, raw trace, and flag visible together. Inspection found no horizontal overflow, clipped
textarea content, or clipped trace text.

The PNG is intentionally untracked under the repository's ignored `artifacts\` directory. The
tracked `npm run capture:ui` path rebuilds the app and reproduces it at the path above.

The current capture also shows the 1600×900 three-column layout with the readable/collapsible
**Lesson assistant** panel, Classroom/Clinic selector, Ask AI/Image tabs, chips, input, and
non-color status text while the transcript and summary remain readable.

## Target-Windows multimodal gates

All three gates were executed successfully on the target Windows 11 machine on 2026-11-03. Linux
cloud validation remains separate and must not substitute for this real CPU VLM evidence.

Use a genuinely fresh Windows checkout so committed `.gitattributes` applies before files are
materialized. If an older validation worktree predates the LF attributes, do not mass-convert it.
Only when that worktree is clean and disposable:

```powershell
if (git status --porcelain) { throw "Validation worktree must be clean" }
git config core.autocrlf false
git reset --hard HEAD
npm run lint
```

```powershell
npm run test:vision-integration
npm run test:assistant-chat-integration
npm run test:concurrent-assistant-chain-integration
```

Required success markers:

- `VISION_REPETITION_REGRESSION_OK`: ordered text chat → native Whisper final → reviewed exact
  problematic transcript → Qwen summary → `ode-slide.png` image analysis, ending in
  `finishReason: stop` with all three parsed sections.
- `VISION_INTEGRATION_OK`: exact
  `qwen3.5-0.8b-generic-cpu:3` / `CPUExecutionProvider`, real `ode-slide.png` bytes, structured
  visible text/relation/uncertainty note, and ODE/equation recognition.
- `ASSISTANT_CHAT_INTEGRATION_OK`: exact local model and a substantive one-sentence answer to
  `What is ODE? Answer in one sentence.`, using the prepared shared CPU slot.
- `CONCURRENT_ASSISTANT_CHAIN_OK`: Nemotron partials continue while chat is submitted, Whisper
  remains authoritative, Qwen receives the exact Whisper final, only one manager exists, chat
  returns independently, and owned temporary WAV residue remains zero.

Measured target results:

- text chat returned a substantive one-sentence ODE answer from exact
  `qwen3.5-0.8b-generic-cpu:3`;
- vision returned all three bounded sections from the real 1280×720 ODE fixture with
  `finishReason: stop`;
- concurrent chat completed in 1,578 ms while 92 Nemotron partials continued, Whisper remained
  authoritative, shared Qwen summarized its exact final in 2,625 ms, and temporary WAV residue
  stayed zero.

The earlier collision-induced `Device is lost` run is not evidence. The shared summary/assistant
target is pinned to the exact CPU VLM; alternate model/provider overrides and silent fallback are
rejected.

## Local inference boundary

Evidence:

1. Runtime uses `AudioSession` and `ChatSession` directly.
2. `RuntimeReadiness.inProcessModeValidated` becomes true only after observing
   `embeddedWebServiceRunning: false` and an empty URL list.
3. The application never calls `FoundryLocalManager.startWebService()`.
4. Static tests reject cloud inference endpoint strings and renderer/main `fetch(...)`.
5. Integration results report `externalEndpointUsed: false`.
6. No CLI subprocess performs inference.
7. Static source audit found no `startWebService(...)`, `fetch(...)`, or HTTP endpoint string in
   `src` or integration scripts.

This proves the application's inference path is in-process and has no external inference endpoint.
It does not prove physical isolation of the PC. Model/EP preparation can download uncached assets,
and Foundry Local logs state that nonessential telemetry is disabled while process information may
still initialize.

The process-local offline guard switched to fail-closed acquisition immediately after successful
Prepare, then ran summary, Ask, ODE image analysis, and concurrent summary+Ask:

| Offline shared-model evidence | Measured result |
|---|---:|
| Prepare | 11,840 ms |
| RSS after 3/3 Prepare | 2.06 GiB |
| Peak process RSS during full gate | 14.82 GiB |
| Summary wall / native generation | 2,914 / 2,725 ms |
| Text Ask | 1,396 ms |
| ODE image analysis | 6,970 ms |
| Concurrent summary + Ask | 3,351 ms |
| Post-Prepare catalog/provider acquisition attempts | 0 |

## Manual release gates

- [ ] Launch the built app while online.
- [ ] Select Prepare and wait for Whisper, Nemotron, and Shared Qwen to show READY plus the visible
      **Enhanced offline ready · 3/3 models** label.
- [ ] Disconnect the PC from network only after that 3/3 gate.
- [ ] Record the ODE segment with live captions.
- [ ] Stop and confirm Whisper final.
- [ ] Generate the Qwen summary; inspect readable display notation and the exact raw Qwen Developer
      Trace entry.
- [ ] Select `fixtures\ode-slide.png`; confirm safe metadata/thumbnail and a structured ODE image
      note.
- [ ] Ask the one-sentence ODE question during active recording; confirm audio/live captions do not
      pause.
- [ ] Correct the final transcript and confirm image analysis advances to a new version.
- [ ] Switch to Clinic mode and confirm the visible non-diagnostic/clinician-led safety statement.
- [ ] Reset and repeat with `fixtures\ode-lesson.wav`.
- [ ] Confirm recording and WAV import use the same formatted summary behavior.
- [ ] Confirm Reset clears transcript/chat/image state while all three model cards remain READY.
- [ ] Confirm no owned temporary WAV remains.

Until that checklist is completed, describe the prototype as **local cached inference with no app
cloud endpoint**, not as a completed physically offline rehearsal.

## Known limitations

- 30-second bounded capture only.
- English only.
- PCM16LE/16 kHz/mono WAV import only.
- The shared Qwen 0.8B model may ignore requested visual structure even when it preserves facts.
  Raw text remains trace evidence; deterministic presentation changes only safe math notation and
  structure/whitespace, falls back rather than dropping content, and the editable summary is not a
  citation source.
- The Qwen 0.8B CPU VLM has a known long-context repetition failure class. Image analysis mitigates
  it by retaining the complete transcript/version only in the stale-state fingerprint while sending
  a deterministic 160-character sentence-bounded topic excerpt, system safety once, early stopping,
  and a 180-token output reserve. The reproduced 13.6 KiB, 1280×720 fixture was not size-bound;
  inference resizing for genuinely large photos remains separate future hardening.
- No transcript/summary export or persistence.
- Prepare owns the exact CPU VLM catalog/download/load wait. Post-Prepare assistant actions reuse
  the loaded shared slot and distinguish prepared-offline startup from active Thinking/Analyzing.

## Rollback

- Stable `main` remains the rollback branch; this work must be deployed only from
  `feature/multimodal-classroom-chat`.
- To avoid assistant behavior without changing builds, do not open the right-side image/chat panel.
  The shared CPU slot remains required for summary and is prepared with the other two models.
- To roll back the feature build, redeploy the previously validated `main` SHA
  `41e9d365dc6b4a20a17c511b6ea7ccc5ee1f8a38` or a newer approved main SHA.
- A failed optional cleanup is not a reason to discard a valid Whisper transcript. Close/restart
  the app, then continue with the stable core path.
