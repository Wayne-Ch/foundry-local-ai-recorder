# Validation record

Date: 2026-10-29 (Windows 11 x64)

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
| `npm run lint` | Pass; 43 files checked |
| `npm run typecheck` | Pass |
| `npm test -- --reporter=dot` | Pass; 9 files, 54 tests |
| `npm run build` | Pass; main, preload, and Vite renderer |
| `npm audit --omit=dev --json` | Pass; 0 production vulnerabilities |

Unit coverage includes:

- replaceable partial versus final transcript semantics;
- transcript versioning and summary invalidation;
- exact Whisper-only summary input;
- audio format, byte, duration, queue, and sequence bounds;
- temporary WAV creation, recovery, and failure cleanup;
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
| First live caption | 1,334 ms |
| Stop to Whisper final | 467 ms |
| Transcript final to summary | 2,947 ms |
| Qwen generation | 2,945 ms |
| Qwen prompt/completion tokens | 177 / 43 |
| Owned temporary WAV residue | 0 |
| Summary input equals exact Whisper final | true |

Nemotron terminal:

> An ordinary differential equation relates a function to its derivatives for the first order
> equation y prime equals negative two y separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

Whisper authoritative final:

> an ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative 2y, separate the variables. The solution is y of t equals c times
> e to the negative 2t. The initial value determines the constant c.

The integration asserted that the summary input equals the Whisper string and differs from both the
last live partial and Nemotron terminal.

### Whisper

Command: `npm run test:whisper-integration`

Result: `WHISPER_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 20,270 ms synthetic fixture;
- 605 ms transcription;
- 6/6 expected ODE words matched;
- terminal `whisper_file_final`;
- no owned temporary WAV residue;
- `externalEndpointUsed: false`.

### Nemotron

Command: `npm run test:nemotron-integration`

Result: `NEMOTRON_INTEGRATION_OK`

- exact ID/CPU provider asserted;
- 92 partials;
- first partial 1,361 ms;
- terminal finalization 151 ms;
- 6/6 expected ODE words matched;
- terminal `live_stream_final`.

### Qwen summary robustness

Command: `npm run test:summary-integration`

Result: `SUMMARY_INTEGRATION_OK`

| Prompt | Latency | Prompt tokens | Completion tokens |
|---|---:|---:|---:|
| ODE solution | 4,095 ms | 162 | 73 |
| Euler comparison | 3,135 ms | 148 | 27 |
| Solution procedure | 4,493 ms | 146 | 45 |

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
2. `RuntimeReadiness` requires `embeddedWebServiceRunning: false` and an empty URL list.
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
