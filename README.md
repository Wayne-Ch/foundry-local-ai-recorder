# Enhanced AI Recorder

Enhanced AI Recorder extends the standard AI Recorder recording, Whisper transcript, and Qwen
summary flow with:

- **Ask AI** text assistance during and after recording.
- **Image analysis** plus **Explain image** for the selected lesson or Clinic fixture.
- **Classroom** mode for lesson help.
- **Clinic · educational only** mode with a required clinician handoff and no diagnosis, urgency,
  or treatment decisions.

Use the [Enhanced AI Recorder Test Guide](PLAYTEST.md) for the complete colleague test flow.

## Local models

| Responsibility | Model | Execution provider |
|---|---|---|
| Live draft | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Final transcript | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |
| Summary, Ask AI, and image assistance | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |

The app pins `foundry-local-sdk@2.2.1`. After all three models are ready, recording, transcription,
summary, text assistance, and image assistance run locally without a cloud inference endpoint.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, `npm ci`, and first model preparation.
- Several GB of free disk space for Electron, dependencies, and model assets.
- A microphone only for live voice-path testing; the included WAV, typed assistant, and image
  flows work without one.

## Clone, install, build, and launch

From the parent folder where you want to keep the `enhanced-ai-recorder` clone:

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
npm ci
npm run build
npm run start:built
```

Use `npm ci` as shown and do not skip install scripts. The install step adds the required native
dependencies.

The included fixtures are ready to use:

- `fixtures\ode-lesson.wav` for the Whisper fallback.
- `fixtures\ode-slide.png` for Classroom image analysis.
- `fixtures\clinic-xray.png` for the Clinic safety flow. See the
  [fixture provenance record](fixtures/clinic-xray.provenance.md) for its source, license,
  transformation, checksum, and de-identification review.

First preparation may download uncached model and runtime assets. Stay online and keep
Enhanced AI Recorder open until all three model cards report **READY** and the status says
**Enhanced AI Recorder offline ready · 3/3 models**. Later test actions can run offline.

## Current limitations

- English speech only.
- 30-second recording limit.
- Imported WAV files must be PCM16LE, 16 kHz, mono.
- Image analysis is intended for the included lesson and Clinic flows, not arbitrary visual
  inspection.
- Clinic mode is educational only and does not provide diagnosis, urgency, or treatment decisions.
- The shared Qwen 0.8B model can render some mathematical notation imperfectly; model wording
  remains editable.
- Transcript, summary, assistant, and image-analysis state are memory-only.

## Standard app

The standard **AI Recorder** is on the `main` branch. Keep it in a separate `ai-recorder` clone
rather than switching branches in this Enhanced checkout.
