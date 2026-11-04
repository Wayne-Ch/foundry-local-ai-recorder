# Enhanced AI Recorder

**Enhanced AI Recorder** extends the standard
[AI Recorder](https://github.com/Wayne-Ch/foundry-local-ai-recorder/tree/main) with local text
assistance, image analysis, and separate Classroom and Clinic modes.

The Windows-first Electron app uses three Foundry Local models:

1. Nemotron provides a replaceable live draft while the microphone is active.
2. Whisper creates the authoritative editable transcript after **Stop**.
3. A shared Qwen model summarizes the final transcript and handles text or image assistance through
   fresh request sessions.

Clinic mode is educational only. It does not diagnose, assess urgency, recommend treatment, or
replace a clinician or interpreter.

## Requirements

- Windows 11 x64.
- Git for Windows.
- Node.js and npm.
- Internet access for cloning, `npm ci`, and first model preparation.
- Several GB of free disk space for Electron, dependencies, models, and execution-provider assets.
- A microphone and Windows microphone permission for live recording. The stage fallback WAV, typed
  assistant, and image flows remain available without a microphone.

## Quick start

From the parent folder where you want the clone:

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
npm ci
npm run build
npm run start:built
```

For later runs, `npm run start` builds and launches the app.

The install scripts materialize the Foundry Local native runtime and the pinned Electron runtime.
Do not install with `--ignore-scripts`. If lifecycle scripts were skipped, rerun `npm ci` normally
without `--ignore-scripts` so the root `postinstall` materializes Electron and Foundry native files,
then run:

```powershell
npm run build
```

## First preparation

1. Select **Prepare local models**.
2. Keep the PC online and the app open while uncached model and execution-provider assets download.
3. Wait until the Nemotron, Whisper, and Shared Qwen cards all show **READY** and the status says
   **Enhanced AI Recorder offline ready · 3/3 models**.
4. For an offline demo, disconnect the PC only after the visible 3/3 ready state.

Later summary, Ask, Analyze image, and Explain image actions reuse the loaded local model. The app
uses Foundry Local's in-process SDK, does not start the embedded web service, and has no cloud
inference endpoint.

The repository includes these ready-to-use fixtures:

- `fixtures\ode-lesson.wav` for microphone-free transcription.
- `fixtures\ode-slide.png` for Classroom image analysis.
- `fixtures\clinic-xray.png` for the Clinic safety flow. Its source, CC0 license, transformation,
  checksum, and de-identification review are documented in
  [`fixtures/clinic-xray.provenance.md`](fixtures/clinic-xray.provenance.md).

## Models and providers

| Role | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary and text/image assistant | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app uses `foundry-local-sdk@2.2.1`.

## Key behavior

- Recording requires consent and a transient microphone grant.
- Nemotron live captions are replaceable draft text. Whisper supplies the final transcript and the
  only transcript version used for summary generation.
- The same bounded audio capture feeds live captions and the final Whisper request.
- Summary, Ask, and image analysis share one prepared Qwen model but use fresh sessions.
- Selected images expose a safe basename, type, dimensions, size, and thumbnail instead of a local
  filesystem path.
- **Delete / reset** clears recording, transcript, summary, chat, image, and timing state
  while keeping prepared models ready for another local run.
- Transcript, summary, assistant, and selected-image state are memory-only.
- Model and user markup remain inert text; supported math is rendered through KaTeX with trust
  disabled.

## Development checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
```

## Current limits and safety

- English speech only.
- Recording is bounded to 30 seconds; lecture-length recording is not supported.
- Imported WAV files must be PCM16LE, 16 kHz, mono.
- Image selection accepts bounded PNG, JPEG, and WebP files. SVG, HTML, PDF, and Office files are
  rejected.
- The Qwen 0.8B model can produce imperfect mathematical notation or visual structure. Summary and
  assistant output remain AI-generated and editable.
- Clinic mode is educational only. Medical-decision questions end with:
  `Diagnosis, urgency, and treatment decisions must be made by the treating clinician.`
- There is no transcript or summary export or persistence.
- First preparation may download uncached assets. Offline use begins after all three model cards
  reach **READY**.

For an executable manual test and 15-minute stage flow, see [DEMO-GUIDE.md](DEMO-GUIDE.md).
