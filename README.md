# AI Recorder

AI Recorder is the standard Windows-first Electron app for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop.
3. **Qwen3.5 0.8B summary** generated from the reviewed Whisper transcript.

The repository's `main` branch contains this standard app.
Enhanced AI Recorder on branch `enhanced-ai-recorder` extends it with Ask AI, image analysis, and
Classroom and Clinic educational modes.

## Features

- Explicit recording consent and microphone permission.
- Replaceable live captions followed by an editable Whisper transcript.
- Editable local summary generated from the current transcript.
- Committed WAV fallback for testing without a microphone.
- **Delete / reset** clears the current transcript and summary while keeping prepared models ready.

## Exact local stack

| Responsibility | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app pins `foundry-local-sdk@2.2.1`. First preparation may download missing model or
execution-provider assets; after preparation, inference runs locally.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for dependencies and model assets.
- A microphone only for live voice-path testing; the committed WAV fallback works without one.

## Tested configuration

This guide was tested on Windows 11 x64 with AMD Radeon graphics, working WebGPU, 64 GB RAM,
Node.js 26.13.0, and npm 11.20.0. All Recorder models use `CPUExecutionProvider`; AMD Radeon and
WebGPU are not model requirements.

## Fresh clone, install, and launch

From the parent folder where you want the canonical `ai-recorder` clone:

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-ai-recorder.git ai-recorder
Set-Location .\ai-recorder
npm ci
npm run build
npm run start:built
```

Use `npm ci` as shown and do not skip install scripts, because setup installs the required native
dependencies. The committed `fixtures\ode-lesson.wav` is ready to use.

First preparation may download uncached model and execution-provider assets. Stay online and keep
AI Recorder open until all three model cards report **READY** and the status says
**AI Recorder offline ready · 3/3 models**. Later test actions can run offline.

Close the **AI Recorder** window normally when testing is complete and wait for
`npm run start:built` to return to the PowerShell prompt.

Follow [PLAYTEST.md](PLAYTEST.md) for the complete test flow.

## Current limitations

- English speech only.
- 30-second recording limit.
- Imported WAV files must be PCM16LE, 16 kHz, mono.
- Transcript and summary state are memory-only; there is no automatic export or account sync.
