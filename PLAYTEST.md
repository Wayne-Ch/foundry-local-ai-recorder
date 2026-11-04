# Enhanced AI Recorder Test Guide

**Enhanced AI Recorder** extends
[AI Recorder](https://github.com/Wayne-Ch/foundry-local-ai-recorder)
with Ask AI, image analysis/Explain image, Classroom mode, and Clinic educational mode. It is not
diagnostic software, does not provide medical decisions, and is not intended for arbitrary images,
floor plans, or general visual inspection.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, npm packages, and any uncached model or execution-provider
  downloads.
- Several GB of free disk space for Electron, dependencies, models, and model caches.
- A microphone and permission are needed only for live voice-path testing; stage fallback WAV,
  typed assistant, and image flows remain available without one.

## Validated configuration

Current E2E evidence for this test guide was collected on a Windows 11 x64 machine with AMD Radeon
graphics, working WebGPU, and 64 GB RAM.
Validation used Node.js 26.13.0 and npm 11.20.0. All Recorder models use the
documented `CPUExecutionProvider` path; AMD Radeon/WebGPU identifies the evidence environment and
is not a model requirement. This configuration is not the product's only intended target. Foundry
Local's broader public platform and hardware support is separate, and other app environments must
not be presented as having equivalent evidence until tested to the same depth. No minimum RAM
requirement has been established; 64 GB describes the validated machine, not a product minimum.

## Clone the Enhanced branch and start

This test guide uses `enhanced-ai-recorder`, not the repository's default `main`
branch. In PowerShell:

[Open the Enhanced branch](https://github.com/Wayne-Ch/foundry-local-ai-recorder/tree/enhanced-ai-recorder)

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
git branch --show-current
```

The final command must print:

```text
enhanced-ai-recorder
```

Install the locked dependencies, build, and launch:

```powershell
npm ci
npm run build
npm run start:built
```

`npm run start` is the build-and-launch shortcut for later runs.
Confirm the window title and top heading both say **Enhanced AI Recorder**.

## Included fixtures

Use the committed fixtures; no download or fixture generation is needed for this test guide.

- `fixtures\ode-slide.png` is a tracked 1280x720 PNG generated entirely by
  `scripts\generate-ode-image-fixture.mjs`. It contains original bitmap drawing and teaching text,
  with no external image or copyrighted lecture material. Its SHA-256 is
  `FDB0714E42ECFFF68F7785D39D854417FED955FD43C9C1AD5F332E157EBF22AE`.
- `fixtures\ode-lesson.wav` is a tracked PCM16LE, 16 kHz, mono WAV. Its reproducible generation
  path is `scripts\generate-ode-fixture.ps1`, which uses Windows `System.Speech` and the original
  ODE script below. Installed Windows voices can make regenerated WAV bytes differ, so use the
  committed fixture for consistent testing.
- `fixtures\clinic-xray.png` is a metadata-free, 1929x2207 grayscale PA chest radiograph for the
  Clinic safety flow. It is CC0, contains no visible patient identifiers, and has SHA-256
  `AEC7A9FF0A1880C27DF73D2CB726485E4ED4905E2E1847113EB7B9BAA2CEF287`. See
  `fixtures\clinic-xray.provenance.md` for the pinned source, license, transformation, and
  de-identification review.

Developer-only regeneration and diff checks are documented in
[VALIDATION.md](VALIDATION.md#developer-fixture-integrity).

## Prepare the local models

First preparation can take several minutes while uncached model and execution-provider assets
download; keep the PC online and Enhanced AI Recorder open until Whisper, Nemotron, and Shared Qwen
report **READY**. Later demo actions can run offline.

1. Select **Prepare local models**.
2. Confirm the button changes immediately and each card exposes its current step: runtime/endpoint
   initialization, catalog/cache lookup, download, provider registration, or model load. Do not
   accept a static screen with no visible working state.
3. Wait until the Whisper, Nemotron, and **Shared Qwen** cards all show **READY**, the status says
   **Enhanced AI Recorder offline ready · 3/3 models**, and the top-right pill says
   **In-process boundary validated**.
4. Only after 3/3 readiness, disconnect the demo PC from the network for the offline rehearsal.

Model preparation can use the network, but inference is performed by Foundry Local in-process.
After successful 3/3 Prepare, summary, Ask, Analyze image, and Explain image reuse the loaded shared
Qwen model and do not perform catalog, model-download, or provider-acquisition work. The app does
not call a cloud inference endpoint or start Foundry's embedded web service.

## Copy/paste play flow

The recorder has a 30-second limit, so keep this guide visible beside the app and move promptly.
Speak this exact four-sentence script:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

1. Confirm all three cards are **READY**, **Enhanced AI Recorder offline ready · 3/3 models** and
   **In-process boundary validated** are visible, and the PC is disconnected.
2. Leave **Live English captions** enabled.
3. Check **I have consent to record this audio**, then select **Start**.
4. Before the first caption, confirm the recorder says it is waiting for the first caption and the
   Live draft region is visibly busy. Speak the first two sentences and confirm the draft changes.
5. While recording continues, open **Ask AI**, enter exactly `What is ODE?`, and select **Ask**.
6. Immediately verify a **Local AI** row appears. It may first show **Waiting locally…**,
   **Using the prepared offline assistant…**, or
   **Loading the prepared cached shared model locally…** before changing to
   **Thinking locally…** when that exact request begins inference.
7. Speak the final two sentences, then select **Stop** before the 30-second limit.
   Verify Stop first shows capture finalization and then **Transcribing…** while Whisper runs.
8. In the assistant reply, verify the context label says **live draft snapshot (may change)**.
9. Wait for **Final transcript — Whisper** to contain the authoritative final transcript. Minor
   speech-recognition wording differences are acceptable; it must reflect the spoken ODE content.
10. Select **Generate summary** and wait for the editable local Qwen summary.
    If the transcript is dirty, verify **Saving correction…** appears before
    **Generating summary…**. Verify the app presents one overview plus Unicode bullets when safe;
    Developer Trace must retain the exact raw factual model paragraph/list.
11. Return to **Ask AI**, enter exactly
    `What is the solution to y' = -2y with y(0) = y0?`, and select **Ask**. Verify the **Local AI**
    answer states the decay solution `y(t) = y0 e^(-2t)` or mathematically equivalent notation.
    Any supported math generated in the answer should render visually without exposing raw dollar
    delimiters, underscores, or braces. The student's plain-text question does not need to be
    transformed into LaTeX.
12. Open the **Image** tab, select **Choose PNG, JPEG, or WebP**, and choose the repository-relative
    file `fixtures\ode-slide.png`.
13. Select **Analyze image**. While it runs, verify the button/metadata distinguish
    **Analyzing… (queued)**, **Using offline assistant…**, **Loading cached model…**, and active
    **Analyzing…** as applicable; **Prepare required** must not appear after successful 3/3
    preparation. Then verify the result has **Visible text/objects**, **Relation to lesson**, and
    **Uncertainty** sections.
14. Return to **Ask AI**, select **Explain image**, and verify the answer refers to the analyzed ODE
    slide rather than inventing unrelated content.
15. Change **Mode** to **Clinic · educational only**. Mode isolation intentionally clears the
    Classroom assistant history and image analysis; the selected ODE slide remains marked
    unanalyzed and is not reused as Clinic analysis.
16. Return to **Image**, choose the repository-relative Clinic fixture
    `fixtures\clinic-xray.png` to replace the ODE slide, select **Analyze image**, verify the same
    visible analyzing state, and wait for the three analysis sections to appear.
17. Return to **Ask AI**, ask exactly
    `Does this image diagnose a patient, and what treatment should they start?`, and verify the
    visible answer does not diagnose, assess urgency, or recommend treatment and ends with
    `Diagnosis, urgency, and treatment decisions must be made by the treating clinician.`
    If the model supplied equivalent clinician-referral wording, verify the visible answer still
    contains only one clinician handoff at the end.
18. Open **Developer Trace** and verify the matching `chat-raw` row retains the raw local-model
    response; the clinician handoff is an application-owned addition to the visible Clinic answer.
19. Select **Delete / reset** and wait for recorder and assistant state to clear.
    Verify all three model cards remain **READY** so another offline run can begin without Prepare.
20. Fully close the app window. Application shutdown unloads the remaining models; confirm the
    PowerShell prompt returns before starting another run.

Run these checks from the clone root after the prompt returns. Both commands must produce no
output:

```powershell
$repo = (Resolve-Path .).Path
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -in @("electron.exe", "node.exe") -and
    $_.CommandLine -and
    $_.CommandLine.Contains($repo, [System.StringComparison]::OrdinalIgnoreCase)
  }

Get-ChildItem -LiteralPath "$env:TEMP\FoundryLocalEnhancedAIRecorder\audio" `
  -Filter "capture-*.wav" -File -ErrorAction SilentlyContinue
```

## Troubleshooting

### Initial model preparation is slow or fails

- For the complete play flow, all three model cards must show **READY**. A visible
  **2/3 local models are ready** warning may still support a reduced recorder path, but it does not
  validate the complete enhanced offline demo.
- If a card reaches an error, fully close the app, relaunch with `npm run start:built`, select
  **Prepare local models** once, and capture the card's model ID, execution provider, status, and
  the corresponding **Developer Trace** row if it fails again.

### Microphone permission is denied

1. Close the app.
2. Open **Windows Settings > Privacy & security > Microphone**.
3. Enable **Microphone access** and **Let desktop apps access your microphone**.
4. Relaunch the app, check the in-app consent box, and select **Start** again.

If no microphone is available, select **Open stage fallback WAV** and choose
`fixtures\ode-lesson.wav`; verify the button advances through file selection/read/decode and
**Transcribing WAV…** before the same Whisper final-transcription path completes.

### `FOUNDRY_NATIVE_RUNTIME_MISSING`

This means the SDK package exists but required ONNX Runtime/GenAI files were skipped or are
incompatible. Fully close the app, then run:

```powershell
npm ci
npm rebuild foundry-local-sdk
npm run build
npm run probe:prepare-ui
```

Do not bypass lifecycle scripts with `--ignore-scripts`. A passing Prepare probe ends with
`PREPARE_UI_PROBE_OK`, the 3/3 offline-ready label, and all three model states equal to `READY`.

### `OPTIONAL_ASSISTANT_FAILED`

Recording and Whisper may remain usable, but summary and assistant share one prepared model. For
actionable evidence:

1. Select **Show trace**.
2. Reproduce one failed **Ask**, **Analyze image**, or **Explain image** action.
3. Capture the time, selected Classroom/Clinic mode, action, latest `assistant:*` phase, and the
   visible safe diagnostic such as `[OPTIONAL_ASSISTANT_FAILED/Error; details omitted]`.
4. Note whether recording and core transcription continued.

The trace intentionally omits raw native messages, local paths, usernames, and credentials. Do not
add those details when sharing the evidence.

### Electron runtime is missing

From the repository root in PowerShell:

```powershell
npm ci
powershell -NoProfile -Command "npm rebuild foundry-local-sdk"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ensure-electron.ps1
Test-Path .\node_modules\electron\dist\electron.exe
```

The final command must print `True`. Then rerun `npm run build` and `npm run start:built`.

### Rerun the vision integration

Fully close the app first. Complete one successful online 3/3 Prepare if the shared model is not
cached, then run:

```powershell
npm run test:vision-integration
```

A passing target-Windows run ends with `VISION_INTEGRATION_OK`.

## Standard app

The repository's `main` branch is the standard **AI Recorder**. Use a separate canonical
`ai-recorder` clone and follow the
[AI Recorder Test Guide](https://github.com/Wayne-Ch/foundry-local-ai-recorder/blob/main/PLAYTEST.md);
do not switch this single-branch Enhanced validation clone.
