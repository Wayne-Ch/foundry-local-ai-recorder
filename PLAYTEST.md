# Enhanced AI Recorder Test Guide

**Enhanced AI Recorder** extends AI Recorder with Ask AI, image analysis/Explain image, Classroom
mode, and Clinic educational mode. It is not diagnostic software, does not provide medical
decisions, and is not intended for arbitrary images, floor plans, or general visual inspection.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for the clone, npm packages, and any uncached model or execution-provider
  downloads.
- Several GB of free disk space for Electron, dependencies, models, and model caches.
- A microphone and permission only for live voice-path testing; the committed fallback WAV, typed
  assistant, and image flows remain available without one.

## Tested configuration

This guide was tested on Windows 11 x64 with AMD Radeon graphics, working WebGPU, 64 GB RAM,
Node.js 26.13.0, and npm 11.20.0. All Recorder models use `CPUExecutionProvider`; AMD Radeon and
WebGPU are not model requirements.

## Clone the Enhanced branch and start

This test guide uses `enhanced-ai-recorder`, not the repository's default `main` branch.

[Open the Enhanced branch](https://github.com/Wayne-Ch/foundry-local-ai-recorder/tree/enhanced-ai-recorder)

```powershell
git clone --branch enhanced-ai-recorder --single-branch https://github.com/Wayne-Ch/foundry-local-ai-recorder.git enhanced-ai-recorder
Set-Location .\enhanced-ai-recorder
npm ci
npm run build
npm run start:built
```

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

## Prepare the local models

First preparation may download model and execution-provider assets. Keep the PC online and Enhanced
AI Recorder open until Whisper, Nemotron, and Shared Qwen report **READY**. Later test actions can
run offline.

1. Select **Prepare local models**.
2. Confirm the button changes immediately and each card shows visible progress.
3. Wait until the Whisper, Nemotron, and **Shared Qwen** cards all show **READY** and the status says
   **Enhanced AI Recorder offline ready · 3/3 models**.
4. Only after 3/3 readiness, disconnect the test PC from the network for the offline check.

After successful preparation, summary, Ask, Analyze image, and Explain image use the loaded local
models without a cloud inference endpoint.

## Test flow

The recorder has a 30-second limit. Speak this exact four-sentence script:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

1. Confirm all three cards are **READY**, **Enhanced AI Recorder offline ready · 3/3 models** is
   visible, and the PC is disconnected.
2. Leave **Live English captions** enabled.
3. Check **I have consent to record this audio**, then select **Start**.
4. Before the first caption, confirm the recorder says it is waiting for the first caption and the
   Live draft region is visibly busy. Speak the first two sentences and confirm the draft changes.
5. While recording continues, open **Ask AI**, enter exactly `What is ODE?`, and select **Ask**.
6. Immediately verify a **Local AI** row appears. It may first show **Waiting locally…**,
   **Using the prepared offline assistant…**, or
   **Loading the prepared cached shared model locally…** before changing to
   **Thinking locally…** when that request begins.
7. Speak the final two sentences, then select **Stop** before the 30-second limit.
   Verify Stop first shows capture finalization and then **Transcribing…** while Whisper runs.
8. In the assistant reply, verify the context label says **live draft snapshot (may change)**.
9. Wait for **Final transcript — Whisper** to contain the authoritative final transcript. Minor
   speech-recognition wording differences are acceptable; it must reflect the spoken ODE content.
10. Select **Generate summary** and wait for the editable local Qwen summary.
    If the transcript is dirty, verify **Saving correction…** appears before
    **Generating summary…**. Verify the app presents one overview plus Unicode bullets when safe.
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
18. Select **Delete / reset** and wait for recorder and assistant state to clear.
    Verify all three model cards remain **READY** so another offline run can begin without Prepare.
19. Close the app window and confirm `npm run start:built` returns to the PowerShell prompt without
    a visible cleanup error.

## Troubleshooting

### Initial model preparation is slow or fails

- Keep the PC online and wait for all three model cards to show **READY**.
- If a card shows an error, close the app, relaunch with `npm run start:built`, and select
  **Prepare local models** once. If it fails again, report only the visible error.

### Microphone permission is denied

1. Close the app.
2. Open **Windows Settings > Privacy & security > Microphone**.
3. Enable **Microphone access** and **Let desktop apps access your microphone**.
4. Relaunch the app, check the in-app consent box, and select **Start** again.

If no microphone is available, open the WAV fallback and choose
`fixtures\ode-lesson.wav`; confirm the Whisper final transcript appears.

### `FOUNDRY_NATIVE_RUNTIME_MISSING`

Close the app, then run:

```powershell
npm ci
npm run build
npm run start:built
```

Confirm all three model cards can reach **READY**. If the error persists, report the visible error.

### `OPTIONAL_ASSISTANT_FAILED`

Retry the same **Ask**, **Analyze image**, or **Explain image** action once. If it fails again,
close and relaunch the app, prepare the models, and confirm their visible status. Report only the
visible error if the failure persists.

### Electron runtime is missing

From the repository root, run:

```powershell
npm ci
npm run build
npm run start:built
```

## Standard app

The repository's `main` branch is the standard **AI Recorder**. Use a separate canonical
`ai-recorder` clone from the
[standard AI Recorder repository](https://github.com/Wayne-Ch/foundry-local-ai-recorder);
do not switch this single-branch Enhanced test clone.
