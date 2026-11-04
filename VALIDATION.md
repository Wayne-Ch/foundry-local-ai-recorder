# AI Recorder validation

Date: 2026-11-03 (Windows 11 x64)

Formal app validation and current E2E evidence were executed on a Windows 11 x64 machine with AMD
Radeon graphics and working WebGPU. Those details identify the evidence machine, not product
requirements: the Recorder models use the exact CPU execution providers listed below, and AI
Recorder is not intended only for the validated hardware. Foundry Local's broader public platform
and hardware support is separate from this app-specific evidence. Other app environments,
including other Windows hardware, Windows Arm64, Linux, Apple-silicon macOS, and other GPU, NPU, or
execution-provider configurations, have not yet been validated to the same depth for this app and
must not be presented as having equivalent evidence until tested.

## Exact required identities

| Role | Model | Execution provider | Catalog size |
|---|---|---|---:|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` | 696 MB |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` | 131 MB |
| Summary | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` | 1,037 MB |

SDK: `foundry-local-sdk@2.2.1`

Toolchain evidence: Node.js `26.13.0` with npm `11.20.0`. The root `package.json` declares neither
an `engines` range nor a pinned `packageManager`, so these versions are validated evidence rather
than a declared support range.

The standard app has exactly these three roles. Each summary request creates a fresh text-only
`ChatSession`; no summary conversation state is reused.

## Static validation

| Command | Result |
|---|---|
| `npm run lint` | Pass; 62 files checked |
| `npm run typecheck` | Pass |
| `npm test` | Pass; 16 files, 261 tests |
| `npm run build` | Pass; main, preload, and renderer |
| `npm audit --audit-level=low` | Pass; 0 vulnerabilities |
| `git diff --check` | Pass |

Coverage includes:

- truthful Prepare phases and model-card readiness;
- native Foundry preflight, partial-DLL repair, and safe rebuild guidance;
- exact three-model target validation;
- fresh text-only summary sessions;
- bounded PCM, queue, duration, and WAV contracts;
- replaceable Nemotron draft versus exact durable Whisper final;
- transcript correction, versioning, summary invalidation, and stale-result rejection;
- summary non-`stop`, empty, context-overflow, and oversized error contracts;
- omission-tolerant factual accuracy that rejects false roles, relationships, equations, numbers,
  units, names, dates, and causes;
- deterministic formatter idempotence and signed/Unicode numeric-prefix preservation;
- Reset/shutdown single-flight cleanup and native settlement;
- safe diagnostics with operation/model/phase metadata and no raw local paths;
- AI Recorder profile, app-data, log, journal, and temporary-audio isolation;
- cross-app cleanup isolation.

## Qwen3.5 factual accuracy gate

Command:

```powershell
npm run test:summary-integration
```

Result: `SUMMARY_FACT_GATE_OK`

The acceptance policy first proves that a correct concise result with omitted secondary facts
passes, while an invented number and a false ownership relationship fail.

| Fixture | Latency | Prompt / completion tokens | Result |
|---|---:|---:|---|
| ODE | 3,356 ms | 242 / 64 | Pass |
| Project Atlas | 2,415 ms | 234 / 55 | Pass |
| Team Aurora | 2,916 ms | 251 / 70 | Pass |
| Concise Project Cedar | 1,820 ms | 202 / 24 | Pass |

ODE raw:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.

ODE display:

> An ordinary differential equation relates a function to its derivatives.
> • For the first order equation y prime equals negative two y, separate the variables.
> • The solution is y of t equals c times e to the negative two t for decay over time.
> • If y of 0 equals 3, then c equals 3.

The ODE result preserves the equation, general solution, decay relationship, initial condition, and
resolved constant without claiming that `c` is the initial condition.

Atlas and Aurora preserved every emitted number/unit, name/date, owner/action, and causal
relationship. The concise case returned 24 completion tokens and remained accurate. All four runs
used `qwen3.5-0.8b-generic-cpu:3` / `CPUExecutionProvider`, finished with `stop`, stayed below
10 seconds, remained bounded, and were stable under a second formatting pass.

## Exact-model integrations

### Whisper

Command: `npm run test:whisper-integration`

Result: `WHISPER_INTEGRATION_OK`

- fixture duration: 20,270 ms;
- transcription: 2,064 ms;
- expected ODE words: 6/6;
- exact model/provider asserted;
- no external endpoint;
- no owned temporary WAV residue.

### Nemotron

Command: `npm run test:nemotron-integration`

Result: `NEMOTRON_INTEGRATION_OK`

- partial count: 92;
- first partial: 1,345 ms;
- terminal finalization: 88 ms;
- expected ODE words: 6/6;
- exact model/provider asserted.

### Full chain

Command: `npm run test:chain-integration`

Result: `CHAIN_INTEGRATION_OK`

| Evidence | Measured result |
|---|---:|
| Nemotron partial count | 92 |
| First live caption | 1,276 ms |
| Stop to Whisper final | 2,061 ms |
| Transcript final to summary | 2,794 ms |
| Qwen3.5 generation | 2,550 ms |
| Qwen3.5 prompt / completion tokens | 233 / 55 |
| Summary input equals exact Whisper final | true |
| Owned temporary WAV residue | 0 |
| In-process mode validated | true |
| External inference endpoint used | false |
| Embedded web service running / URLs | false / 0 |

## Prepare, Reset, and Electron probes

| Command | Result |
|---|---|
| `npm run probe:prepare-ui` | Pass; 12,010 ms to 3/3 ready; truthful phases; Reset preserved all three ready states |
| `npm run probe:microphone-permission` | Pass; one audio track, zero video tracks, exact document/security origin |
| `npm run probe:stream-owner` | Pass; reload/close revoked leases; stale partial routable = false |
| `npm run smoke:electron` | `ELECTRON_SMOKE_OK` |
| `npm run capture:ui` | Pass; `artifacts\ai-recorder-populated-summary.png` |

The Prepare capture shows:

- **AI Recorder** identity;
- Nemotron, Whisper, and Qwen3.5 0.8B cards at **READY**;
- exact CPU providers;
- **AI Recorder offline ready · 3/3 models**;
- no secondary feature surface.

The populated-summary capture shows the final transcript, editable Qwen3.5 summary, exact
`summary-raw` evidence, and formatter-applied flag without clipping or horizontal overflow.

No Electron or recorder process started by these gates remained after exit.

## Local inference boundary

1. Runtime uses in-process `AudioSession` and `ChatSession`.
2. Readiness becomes validated only when the embedded service is stopped and URL list is empty.
3. The app never starts the Foundry embedded web service.
4. Integration results report `externalEndpointUsed: false`.
5. No CLI subprocess performs inference.

This proves the application inference path is in process and has no external inference endpoint.
It does not prove physical isolation of the PC. Model preparation can download uncached assets.

## Manual release gate

- [ ] Disconnect the PC after all three exact CPU models are cached.
- [ ] Launch the built app.
- [ ] Confirm **AI Recorder offline ready · 3/3 models**.
- [ ] Record the ODE segment with live captions.
- [ ] Stop and confirm the Whisper final.
- [ ] Generate the Qwen3.5 summary.
- [ ] Reset and repeat with `fixtures\ode-lesson.wav`.
- [ ] Confirm no owned temporary WAV remains.

Until this checklist passes, describe the app as **local cached inference with no app cloud
endpoint**, not as a completed physically offline rehearsal.

## Known limitations

- Formal validation and current E2E evidence cover the currently validated Windows 11 x64 AMD
  Radeon/WebGPU configuration.
- That evidence scope does not limit the product to this hardware. Other app environments have not
  yet been validated to the same depth and must not be presented as having equivalent evidence
  until tested.
- English only.
- 30-second bounded capture.
- PCM16LE/16 kHz/mono WAV import only.
- Summary omissions are allowed; emitted facts must remain accurate.
- Transcript and summary state are memory-only.
