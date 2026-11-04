# AI Recorder

AI Recorder is a Windows-first Electron app for a complete local recording workflow:

1. **Nemotron live draft** while the microphone is active.
2. **Whisper authoritative final transcript** after Stop.
3. **Qwen3.5 0.8B summary** generated from the reviewed Whisper transcript.

The `main` branch contains this app. The `enhanced-ai-recorder` branch adds Ask AI, image analysis,
and Classroom and Clinic educational modes.

## Features

- Explicit recording consent and microphone permission.
- Replaceable live captions followed by an editable Whisper transcript.
- Editable local summary generated from the current transcript.
- Included WAV fallback for testing without a microphone.
- **Delete / reset** clears the current transcript and summary while keeping prepared models ready.

## Local AI models

| Responsibility | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app uses `foundry-local-sdk@2.2.1`. First preparation may download missing model or
execution-provider files; after preparation, model processing runs locally.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for dependencies and model files.
- A microphone only for live recording tests; the included WAV fallback works without one.

## Fresh clone, install, and launch

From the parent folder where you want to keep the repository:

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-ai-recorder.git ai-recorder
Set-Location .\ai-recorder
npm ci
npm run build
npm run start:built
```

Run `npm ci` exactly as shown; do not skip install scripts because they set up the required Foundry
Local and Electron files. The included `fixtures\ode-lesson.wav` is ready to use.

First preparation may download missing model and execution-provider files. Stay online and keep
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
