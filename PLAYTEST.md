[Open the repository at `feature/multimodal-classroom-chat`](https://github.com/Wayne-Ch/foundry-local-smart-ai-recorder/tree/feature/multimodal-classroom-chat)

# AI Recorder colleague playtest

This is a Windows-first Ignite prototype for local classroom recording, transcription, summary,
chat, and bounded lesson-image explanation. It is not diagnostic software, does not provide
medical decisions, and is not intended for arbitrary images, floor plans, or general visual
inspection.

## Prerequisites

- Windows 11 x64 with current graphics drivers.
- Git for Windows.
- Node.js 26.x; the validated Windows version is `26.13.0`.
- A working microphone and permission to record the test speaker.
- Internet access for the clone, npm packages, and any uncached model or execution-provider
  downloads.
- Several GB of free disk space for Electron, dependencies, models, and model caches.

## Clone the feature branch and start

The playtest is on `feature/multimodal-classroom-chat`, not the repository's default `main`
branch. In PowerShell:

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-smart-ai-recorder.git
Set-Location .\foundry-local-smart-ai-recorder
git fetch origin
git switch --track origin/feature/multimodal-classroom-chat
git branch --show-current
```

The final command must print:

```text
feature/multimodal-classroom-chat
```

Install the locked dependencies, build, and launch:

```powershell
npm ci
npm run build
npm run start:built
```

`npm run start` is the build-and-launch shortcut for later runs.

## Included fixtures

Use the committed fixtures; no download or fixture generation is needed for the playtest.

- `fixtures\ode-slide.png` is a tracked 1280x720 PNG generated entirely by
  `scripts\generate-ode-image-fixture.mjs`. It contains original bitmap drawing and teaching text,
  with no external image or copyrighted lecture material. Its SHA-256 is
  `FDB0714E42ECFFF68F7785D39D854417FED955FD43C9C1AD5F332E157EBF22AE`.
- `fixtures\ode-lesson.wav` is a tracked PCM16LE, 16 kHz, mono WAV. Its reproducible generation
  path is `scripts\generate-ode-fixture.ps1`, which uses Windows `System.Speech` and the original
  ODE script below. Installed Windows voices can make regenerated WAV bytes differ, so use the
  committed fixture for consistent playtesting.
- `fixtures\clinic-xray.png` is a metadata-free, 1929x2207 grayscale PA chest radiograph for the
  Clinic safety flow. It is CC0, contains no visible patient identifiers, and has SHA-256
  `AEC7A9FF0A1880C27DF73D2CB726485E4ED4905E2E1847113EB7B9BAA2CEF287`. See
  `fixtures\clinic-xray.provenance.md` for the pinned source, license, transformation, and
  de-identification review.

To audit the deterministic image fixture rather than run the playtest:

```powershell
npm run fixture:image
git diff --exit-code -- .\fixtures\ode-slide.png
```

## Prepare the local models

1. Keep the PC online for the first preparation.
2. Select **Prepare local models**.
3. Confirm the button changes immediately and each card exposes its current step: runtime/endpoint
   initialization, catalog/cache lookup, download, provider registration, or model load. Do not
   accept a static screen with no visible working state.
4. Wait until the Whisper, Nemotron, and Qwen model cards all show **READY** and the top-right pill
   says **In-process boundary validated**.

The first preparation has no fixed latency. It may take several minutes because the three core
catalog payloads total about 1.4 GB and the WebGPU execution-provider bundle may also be
downloaded. Leave the app open while the status message reports download and load progress.
Subsequent launches use cached assets but still need time to load them into memory.

The optional CPU vision/chat model is loaded lazily. The first **Ask** or **Analyze image** action
can therefore take longer than later requests and may need the network if that model is not cached.

Model preparation can use the network, but inference is performed by Foundry Local in-process.
The app does not call a cloud inference endpoint or start Foundry's embedded web service. Describe
this as local in-process inference, not as proof that the whole PC is physically offline.

## Copy/paste play flow

The recorder has a 30-second limit, so keep this guide visible beside the app and move promptly.
Speak this exact four-sentence script:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

1. Confirm all three core cards are **READY** and **In-process boundary validated** is visible.
2. Leave **Live English captions** enabled.
3. Check **I have consent to record this audio**, then select **Start**.
4. Before the first caption, confirm the recorder says it is waiting for the first caption and the
   Live draft region is visibly busy. Speak the first two sentences and confirm the draft changes.
5. While recording continues, open **Ask AI**, enter exactly `What is ODE?`, and select **Ask**.
6. Immediately verify a **Local AI** row shows **Thinking locally…**. If another optional request is
   already running, it first shows **Waiting locally…** and changes when that exact request starts.
7. Speak the final two sentences, then select **Stop** before the 30-second limit.
   Verify Stop first shows capture finalization and then **Transcribing…** while Whisper runs.
8. In the assistant reply, verify the context label says **live draft snapshot (may change)**.
9. Wait for **Final transcript — Whisper** to contain the authoritative final transcript. Minor
   speech-recognition wording differences are acceptable; it must reflect the spoken ODE content.
10. Select **Generate summary** and wait for the editable local Qwen summary.
    If the transcript is dirty, verify **Saving correction…** appears before
    **Generating summary…**.
11. Return to **Ask AI**, enter exactly
    `Render this decay equation: $y(t) = y_0 e^{-2t}$.`, and select **Ask**. Verify the submitted
    equation renders with a subscript and exponent instead of literal dollar signs, underscore, or
    braces. Supported math repeated in the Local AI reply should render the same way.
12. Open the **Image** tab, select **Choose PNG, JPEG, or WebP**, and choose the repository-relative
    file `fixtures\ode-slide.png`.
13. Select **Analyze image**. While it runs, verify the button/metadata distinguish queued work,
    lazy assistant model/provider loading, and active **Analyzing…**. Then verify the result has
    **Visible text/objects**, **Relation to lesson**, and **Uncertainty** sections.
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
20. Fully close the app window. Application shutdown unloads the remaining models; confirm the
    PowerShell prompt returns before starting another run.

## Troubleshooting

### Initial model preparation is slow or fails

- Keep the PC online and let the current download/load status finish; first load is expected to be
  much slower than a cached launch.
- For the complete play flow, all three core cards must show **READY**. A visible
  **Whisper-only fallback is ready** warning still supports recording and final transcription, but
  it does not validate the Nemotron live-draft steps.
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

Do not use `npm install --ignore-scripts`. A passing Prepare probe ends with
`PREPARE_UI_PROBE_OK` and all three core model states equal to `READY`.

### `OPTIONAL_ASSISTANT_FAILED`

Recording, Whisper, and summary remain usable. For actionable evidence:

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

Fully close the app first, keep the PC online if the optional model is not cached, and run:

```powershell
npm run test:vision-integration
```

A passing target-Windows run ends with `VISION_INTEGRATION_OK`.

## Stable branch and rollback

`main` remains the stable recorder branch; this playtest is isolated on
`feature/multimodal-classroom-chat`. To return a clean clone to the stable branch:

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run build
npm run start:built
```

To playtest again, explicitly switch back to `feature/multimodal-classroom-chat` before building.
