# AI Recorder

Windows-first Electron app for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop, using the same bounded capture.
3. **Qwen3.5 0.8B summary** generated only from the reviewed Whisper transcript version.

The app has exactly these three model roles. It does not expose any secondary chat, visual-analysis,
or mode-specific workflow.

## Exact local stack

| Responsibility | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app pins `foundry-local-sdk@2.2.1` and uses in-process `AudioSession` and `ChatSession`
instances. Prepare may download missing model or execution-provider assets. Once cached and loaded,
inference remains local to the process and the endpoint guard rejects an active embedded web
service or URL.

## Fresh clone, install, and launch

### Requirements

- The committed setup and playtest path is Windows 11 x64; current formal validation uses the same
  platform.
- Git.
- Node.js and npm; the root `package.json` currently declares neither an `engines` range nor a
  pinned `packageManager`.
- Internet access for `npm install` and the first model preparation.
- Several GB of free disk space for dependencies and model assets.
- No minimum RAM value has been established by testing.
- A microphone is needed only for live voice-path testing; the stage fallback WAV flow remains
  available without one.

### Validated configuration

Formal app validation and current E2E evidence for this release were executed with Node.js
`26.13.0` and npm `11.20.0` on a Windows 11 x64 machine with AMD Radeon graphics, working WebGPU,
and 64 GB RAM. Those Node/npm versions are validation evidence, not a declared support range. All
Recorder models use the documented `CPUExecutionProvider` path; AMD Radeon/WebGPU identifies the
evidence environment and is not a model requirement. This configuration is not the product's only
intended target. Foundry Local's broader public platform and hardware support is separate, and
other app environments must not be presented as having equivalent evidence until tested to the
same depth.

From the parent folder where you want the canonical `ai-recorder` clone:

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-ai-recorder.git ai-recorder
Set-Location .\ai-recorder
npm install
npm run fixture:generate
npm run build
npm run start:built
```

Do not install with `--ignore-scripts`. The root `postinstall` first verifies and repairs the
Foundry native payload, then verifies Electron. If native Foundry files are incomplete, Prepare
returns an actionable `FOUNDRY_NATIVE_RUNTIME_MISSING` diagnostic with rebuild guidance.

First preparation can take several minutes while uncached model and execution-provider assets
download. Stay online and keep AI Recorder open until all required model cards report READY; later
demo actions can run offline.

Select **Prepare local models** before recording. The status becomes
**AI Recorder offline ready · 3/3 models** only when Nemotron, Whisper, and Qwen3.5 0.8B all report
truthful loaded readiness. Whisper and Qwen can remain usable when the optional live-draft path
fails, but that degraded state is shown as a warning rather than complete offline readiness.

Close the **AI Recorder** window normally when the playtest is complete and wait for the
`npm run start:built` command to return to the PowerShell prompt.

## Recorder behavior

- Recording requires an explicit consent checkbox and a transient user-gesture microphone grant.
- PCM is resampled to PCM16LE, 16 kHz, mono and bounded to 30 seconds / 960,000 bytes.
- While waiting for the first Nemotron result, the UI explicitly shows
  **Recording · waiting for caption**.
- Nemotron partials replace each other and never enter durable transcript state or summary input.
- Stop releases microphone tracks first, snapshots the exact bounded PCM, and runs Whisper even if
  Nemotron finalization or cancellation is still draining.
- Imported PCM16LE/16 kHz/mono WAV files use the same validated temporary-WAV and Whisper path.
- The final transcript is editable. Saving a correction increments its version and invalidates an
  older summary.
- Summary submission captures the exact transcript string and version. Stale completion is
  rejected if Reset or another edit changes that generation.
- Each summary uses a fresh text-only Qwen3.5 `ChatSession`; no conversation state is reused.
- Qwen raw output is retained only in Developer Trace. The editable summary stores the result of a
  deterministic, idempotent formatter that preserves factual numeric prefixes, including signed
  and Unicode-digit facts.
- Reset cancels current work, discards unsubmitted audio, clears derived state, removes owned
  temporary WAV files, and preserves already prepared model readiness.
- Shutdown waits for native request settlement before queue/session/model/manager teardown.

## Product and storage isolation

The canonical repository and release metadata identify this app as **AI Recorder**:

| Surface | Standard namespace |
|---|---|
| npm package | `foundry-local-ai-recorder` |
| Electron product/profile | `AI Recorder` |
| Foundry app data and logs | `%LOCALAPPDATA%\FoundryLocalAIRecorder` |
| Temporary audio | `%TEMP%\FoundryLocalAIRecorder\audio` |
| Operation journal | `logs\ai-recorder-operations-YYYY-MM-DD.jsonl` |

These paths are distinct from the Enhanced app. The only intentionally shareable path is the
immutable Foundry model cache, normally `%USERPROFILE%\.foundry\cache\models`.

## Validate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
npm run test:whisper-integration
npm run test:nemotron-integration
npm run test:summary-integration
npm run test:chain-integration
npm run probe:prepare-ui
npm run probe:microphone-permission
npm run probe:stream-owner
npm run smoke:electron
npm run capture:ui
```

`npm run test:summary-integration` gates ODE, Project Atlas, Team Aurora, and a concise-output case.
Shorter summaries may omit secondary facts, but every stated relationship, equation, number/unit,
name/date, role, and cause must remain accurate. The gate also checks deterministic formatting,
formatter idempotence, a 10-second per-run latency bound, and raw-summary trace evidence.

`npm run capture:ui` writes the ignored deterministic artifact
`artifacts\ai-recorder-populated-summary.png`.

See [PLAYTEST.md](PLAYTEST.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md),
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md), and [VALIDATION.md](VALIDATION.md).

## Configuration overrides

Each model override requires an exact model ID and execution provider together. Invalid or partial
overrides fail instead of silently falling back.

| Role | Model variable | Provider variable |
|---|---|---|
| Whisper | `AI_RECORDER_WHISPER_MODEL_ID` | `AI_RECORDER_WHISPER_EXECUTION_PROVIDER` |
| Nemotron | `AI_RECORDER_NEMOTRON_MODEL_ID` | `AI_RECORDER_NEMOTRON_EXECUTION_PROVIDER` |
| Summary | `AI_RECORDER_SUMMARY_MODEL_ID` | `AI_RECORDER_SUMMARY_EXECUTION_PROVIDER` |

The summary variables accept only the standard
`qwen3.5-0.8b-generic-cpu:3` / `CPUExecutionProvider` pair.

Other paths:

- `AI_RECORDER_APP_DATA_DIR`
- `FOUNDRY_MODEL_CACHE_DIR`

## Current limits

- Current app E2E evidence covers the validated Windows 11 x64 AMD Radeon/WebGPU configuration;
  other environments require equivalent testing before making the same evidence claim.
- That evidence boundary does not make the validated hardware the product's only intended target.
- English speech only.
- 30-second bounded capture.
- Imported WAV files must already be PCM16LE, 16 kHz, mono.
- Transcript and summary state are memory-only; there is no automatic export or account sync.
- A physical network-disconnect rehearsal remains a manual release gate. Passing integration tests
  proves the app path is in-process and has no external inference endpoint; it does not prove that
  every machine-level network path is disconnected.
