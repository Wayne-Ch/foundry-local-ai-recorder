# Validation record

Date: 2026-10-30 (Windows 11 x64)

## Validated identities

| Role | Exact model | Execution provider | Catalog size |
|---|---|---|---:|
| Live captions | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` | 696 MB |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` | 131 MB |
| Summary | `qwen3-0.6b-generic-gpu:2` | `WebGPUExecutionProvider` | 529 MB |

SDK: `foundry-local-sdk@2.2.1`

Runtime log evidence:

- ONNX Runtime `1.31.0`
- ONNX Runtime GenAI `0.18.0`
- WebGPU bundle `webgpu-ep-0.2.1-win-x64`
- model cache `C:\Users\waynechuang\.foundry\cache\models`
- nonessential telemetry disabled by configuration

## Static validation

| Command | Result |
|---|---|
| `npm run lint` | Pass; 44 files checked |
| `npm run typecheck` | Pass |
| `npm test -- --reporter=dot` | Pass; 10 files, 72 tests |
| `npm run build` | Pass; main, preload, and Vite renderer |
| `npm audit --offline --audit-level=high` | Pass from local advisory cache; 0 vulnerabilities |

The configured Microsoft package-feed audit endpoint returned HTTP 429 on three backoff retries,
and direct `registry.npmjs.org` audit failed the environment TLS handshake. The successful offline
result is recorded as cache-based evidence, not a live advisory-service result.

Unit coverage includes:

- replaceable partial versus final transcript semantics;
- transcript versioning and summary invalidation;
- exact Whisper-only summary input;
- exact newlines, repeated spaces, Unicode, and punctuation preserved through runtime, controller,
  durable snapshot, submitted snapshot, and Qwen prompt construction;
- audio format, byte, duration, queue, and sequence bounds;
- exact 30-second accumulation, one-frame overflow trimming, multi-chunk boundary crossing, and
  automatic/manual Stop race;
- sticky live IPC/pump failure continuing to Whisper with track/stream cleanup and no unhandled
  rejection;
- cancellation/reset making zero finish, transcribe, or summary calls;
- endpoint guard first-fail/second-retry disposal and inference blocking for active URL/service
  state;
- in-flight Whisper/Qwen cancellation and settlement before session/model/manager/temp teardown;
- temporary WAV creation, recovery, and failure cleanup;
- EACCES/EBUSY/EPERM startup retention warnings with hidden paths and retry guidance;
- model-slot replacement failure preserving a working model;
- exact override validation;
- microphone permission gating;
- frame-token stream ownership, stale routing, reload, and close behavior;
- static absence of cloud inference endpoints, `fetch`, and embedded web-service startup.

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
| First live caption | 1,347 ms |
| Stop to Whisper final | 561 ms |
| Transcript final to summary | 3,134 ms |
| Qwen generation | 3,131 ms |
| Qwen prompt/completion tokens | 177 / 69 |
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

### Whisper

Command: `npm run test:whisper-integration`

Result: `WHISPER_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 20,270 ms synthetic fixture;
- 355 ms transcription;
- 6/6 expected ODE words matched;
- terminal `whisper_file_final`;
- no owned temporary WAV residue;
- `externalEndpointUsed: false`.

### Nemotron

Command: `npm run test:nemotron-integration`

Result: `NEMOTRON_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 92 partials;
- first partial 1,283 ms;
- terminal finalization 171 ms;
- 6/6 expected ODE words matched;
- terminal `live_stream_final`.

### Qwen summary robustness

Command: `npm run test:summary-integration`

Result: `SUMMARY_INTEGRATION_OK`

| Prompt | Latency | Prompt tokens | Completion tokens |
|---|---:|---:|---:|
| ODE solution | 3,181 ms | 162 | 73 |
| Euler comparison | 3,820 ms | 148 | 27 |
| Solution procedure | 3,133 ms | 146 | 45 |

All three runs returned nonempty bounded output with `finishReason: "stop"`. Qwen thinking was
disabled via `chat_template_kwargs` after an initial validation run showed the default reasoning
mode exhausting the 260-token output budget.

## Electron validation

| Command | Result |
|---|---|
| `npm run smoke:electron` | `ELECTRON_SMOKE_OK` |
| `npm run probe:microphone-permission` | `MICROPHONE_PERMISSION_PROBE_OK`; one fake audio track, zero video tracks, exact document/security origin |
| `npm run probe:stream-owner` | `STREAM_OWNER_PROBE_OK`; reload and close cancelled leases, stale partial routable = false |
| `npm run capture:ui` | `UI_CAPTURE_OK` |

Stage screenshot:

`artifacts\smart-ai-recorder-stage.png`

The screenshot is intentionally untracked and remains available in the local worktree artifact
directory.

## Local inference boundary

Evidence:

1. Runtime uses `AudioSession` and `ChatSession` directly.
2. `RuntimeReadiness.inProcessModeValidated` becomes true only after observing
   `embeddedWebServiceRunning: false` and an empty URL list.
3. The application never calls `FoundryLocalManager.startWebService()`.
4. Static tests reject cloud inference endpoint strings and renderer/main `fetch(...)`.
5. Integration results report `externalEndpointUsed: false`.
6. No CLI subprocess performs inference.

This proves the application's inference path is in-process and has no external inference endpoint.
It does not prove physical isolation of the PC. Model/EP preparation can download uncached assets,
and Foundry Local logs state that nonessential telemetry is disabled while process information may
still initialize.

## Manual release gates

- [ ] Disconnect the PC from network after all three exact models and WebGPU EP are cached.
- [ ] Launch the built app.
- [ ] Record the ODE segment with live captions.
- [ ] Stop and confirm Whisper final.
- [ ] Generate the Qwen summary.
- [ ] Reset and repeat with `fixtures\ode-lesson.wav`.
- [ ] Confirm no owned temporary WAV remains.
- [ ] Re-run a live online dependency audit when the configured advisory endpoint is below its rate
  limit.

Until that checklist is completed, describe the prototype as **local cached inference with no app
cloud endpoint**, not as a completed physically offline rehearsal.

## Known limitations

- 30-second bounded capture only.
- English only.
- PCM16LE/16 kHz/mono WAV import only.
- The Qwen 0.6B model can format equations imperfectly; summary text is editable and not a citation
  source.
- No transcript/summary export or persistence.
- No image processing.
