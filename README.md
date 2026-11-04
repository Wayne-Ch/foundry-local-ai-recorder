# AI Recorder

AI Recorder is the Standard-lineage, Windows-first Electron recorder powered by Foundry Local:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative transcript** after Stop, using the same bounded capture.
3. **Qwen3.5 0.8B summary** generated only from the reviewed Whisper transcript version.

The Standard lineage contains only this three-model workflow. Its Electron profile, app data,
logs, and temporary audio are isolated from the Enhanced app; only the immutable Foundry model
cache can be shared.

## Local model stack

| Responsibility | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app pins `foundry-local-sdk@2.2.1` and uses in-process `AudioSession` and `ChatSession`
instances. Prepare may download missing model or execution-provider assets. Once cached and
loaded, inference stays in process and the app rejects an active embedded web service or URL.

## Requirements

- Windows 11 x64.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for dependencies and model assets.
- A microphone for live recording. The committed WAV fixture supports microphone-free testing.

## Quick start

From the parent folder where you want the clone:

```powershell
git clone --branch main --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git ai-recorder
Set-Location .\ai-recorder
npm ci
npm run build
npm run start:built
```

Do not install with `--ignore-scripts`. The root `postinstall` verifies the Foundry native payload
and Electron. If lifecycle scripts were skipped, close the app and rerun `npm ci` normally without
`--ignore-scripts` so the root `postinstall` materializes Electron and Foundry native files. Then
run `npm run build` and retry.

Select **Prepare local models** and keep the app open and online until all three model cards show
**READY** and the status reads **AI Recorder offline ready · 3/3 models**. First preparation can
take several minutes while assets download. Later runs can use the cached models offline.

## Key behavior

- Recording requires explicit consent and a transient microphone permission grant.
- Audio is converted to PCM16LE, 16 kHz, mono and bounded to 30 seconds.
- Nemotron text is a replaceable live draft; it never becomes the durable transcript or summary
  input.
- Stop releases microphone tracks, snapshots the bounded capture, and runs Whisper even if the
  optional live-draft path is still finishing.
- The Whisper transcript is editable. Saving a correction increments its version and invalidates
  an older summary.
- Summary generation uses the exact submitted Whisper transcript version. A stale completion
  cannot attach after another edit or **Delete / reset**.
- Imported PCM16LE/16 kHz/mono WAV files use the same Whisper and summary flow as microphone audio.
- **Delete / reset** clears session state and owned temporary audio while preserving prepared model
  readiness.

## Development checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
```

## Current limitations

- English speech only.
- 30-second bounded capture.
- Imported WAV files must already be PCM16LE, 16 kHz, mono.
- Transcript and summary state are memory-only; there is no automatic export or account sync.
- Summaries may omit secondary details. Review them against the final transcript and do not use
  them as citation sources.
- Model preparation can require network access. Use the offline variation in the demo guide to
  verify a fully cached run while physically disconnected.

See [DEMO-GUIDE.md](DEMO-GUIDE.md) for the manual UI test, stage walkthrough, fallback fixture,
and recovery steps.
