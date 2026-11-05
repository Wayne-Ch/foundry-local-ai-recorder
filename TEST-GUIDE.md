# Enhanced AI Recorder Test Guide

**Enhanced AI Recorder** extends AI Recorder with Ask AI, image analysis/Explain image, Classroom
mode, and Clinic educational mode. It is not diagnostic software, does not provide medical
decisions, and is not intended for arbitrary images, floor plans, or general visual inspection.

## Requirements

Meet the [README requirements](README.md#requirements), including Node.js and npm. Keep internet
access through installation and first model preparation. A microphone is needed only for live voice
testing; use the included WAV fallback otherwise.

Note: This guide was validated on Windows 11 x64 with Node.js 26.13.0, npm 11.20.0, and AMD
Radeon 860M graphics with working WebGPU support. Other environments have not yet been validated.

## Clone the Enhanced branch and start

Follow the
[README clone, install, build, and launch instructions](README.md#clone-install-build-and-launch).

Confirm the window title and page heading both say **Enhanced AI Recorder**. The initial screen must
show the Nemotron, Whisper, and **Shared Qwen** model cards, **Prepare local models**, enabled
**Live English captions**, disabled **Start**, **Stop**, and **Open stage fallback WAV**, and the
status **Prepare the local models to begin.**

## Included fixtures

Use the included fixtures; no download or fixture generation is needed for this test guide.

- `fixtures\ode-slide.png` for Classroom image analysis.
- `fixtures\ode-lesson.wav`, a PCM16LE, 16 kHz, mono WAV, for the Whisper fallback.
- `fixtures\clinic-xray.png` for the Clinic safety flow. See the
  [fixture provenance record](fixtures/clinic-xray.provenance.md) for its source, license,
  transformation, checksum, and de-identification review.

## Prepare the local models

First preparation may download model and GPU provider assets. Keep the PC online and Enhanced
AI Recorder open until Whisper, Nemotron, and Shared Qwen report **READY**. Later test actions can
run offline.

1. Select **Prepare local models**.
2. Confirm the button changes immediately and each card shows visible progress.
3. Wait until the Whisper, Nemotron, and **Shared Qwen** cards all show **READY** and the status says
   **Enhanced AI Recorder offline ready · 3/3 models**.
4. Only after 3/3 readiness, disconnect the test PC from the network for the offline check.

After successful preparation, **Generate summary**, **Ask**, **Analyze image**, and **Explain image**
use the loaded local models without a cloud inference endpoint.

## Test flow

The recorder has a 30-second limit. Speak this exact four-sentence script:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

1. Confirm all three cards are **READY**, **Enhanced AI Recorder offline ready · 3/3 models** is
   visible, and the PC is disconnected.
2. Leave **Live English captions** enabled.
3. Check **I have consent to record this audio**, then select **Start**.
4. Before the first caption, confirm the status says **Recording · waiting for caption** and the
   Live draft region is visibly busy. Speak the first two sentences and confirm the draft changes.
5. While recording continues, open **Ask AI**, enter exactly `What is ODE?`, and select **Ask**.
6. Immediately verify a **Local AI** row appears. It may first show **Waiting locally…**,
   **Using the prepared offline assistant…**, or
   **Loading the prepared cached shared model locally…** before changing to
   **Thinking locally…** when that request begins.
7. Speak the final two sentences, then select **Stop** before the 30-second limit.
   Verify **Stop** first changes to **Finalizing capture…** and then **Transcribing…** while
   Whisper runs.
8. In the assistant reply, verify the context label says **live draft snapshot (may change)**.
9. Wait for the **Final transcript** card labeled **Whisper** to contain the authoritative final
   transcript. Minor speech-recognition wording differences are acceptable; it must reflect the
   spoken ODE content.
10. In **Final transcript**, edit one word, then select **Generate summary** without saving first.
    Verify **Saving correction…** appears before **Generating summary…**, then wait for the
    editable local Qwen summary. Verify the app presents exactly one overview plus four Unicode
    bullets.
11. Return to **Ask AI**, enter exactly
    `What is the solution to y' = -2y with y(0) = y0?`, and select **Ask**. Verify the **Local AI**
    answer states the decay solution `y(t) = y0 e^(-2t)` or mathematically equivalent notation.
    Any supported math generated in the answer should render visually without exposing raw dollar
    delimiters, underscores, or braces. The student's plain-text question does not need to be
    transformed into LaTeX.
12. Open the **Image** tab, select **Choose PNG, JPEG, or WebP**, and choose
    `fixtures\ode-slide.png`.
13. Select **Analyze image**. While it runs, verify the button/metadata distinguish
    **Analyzing… (queued)**, **Using offline assistant…**, **Loading cached model…**, and active
    **Analyzing…** as applicable; **Prepare required** must not appear after successful 3/3
    preparation. Then verify the result has **Visible text/objects**, **Relation to lesson**, and
    **Uncertainty** sections.
14. Return to **Ask AI**, select **Explain image**, and verify the answer refers to the analyzed ODE
    slide rather than inventing unrelated content.
15. Change **Mode** to **Clinic · educational only**. Verify the Classroom assistant history and
    image analysis clear; the selected ODE slide remains marked unanalyzed and is not reused as
    Clinic analysis.
16. Return to **Image**, choose `fixtures\clinic-xray.png` to replace the ODE slide, select
    **Analyze image**, verify the same
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

### Initial model preparation does not reach READY

- Keep the PC online and wait for all three model cards to show **READY**.
- If a card shows an error, close the app, relaunch with `npm run start:built`, and select
  **Prepare local models** once. If it fails again, note the visible error.

### Microphone permission is denied

1. Close the app.
2. Open **Windows Settings > Privacy & security > Microphone**.
3. Enable **Microphone access** and **Let desktop apps access your microphone**.
4. Relaunch the app, check the in-app consent box, and select **Start** again.

If no microphone is available, select **Open stage fallback WAV**, choose
`fixtures\ode-lesson.wav`, and confirm the Whisper final transcript appears.

### `FOUNDRY_NATIVE_RUNTIME_MISSING`

Close the app, then run:

```powershell
npm ci
npm run build
npm run start:built
```

Confirm all three model cards can reach **READY**. If the error persists, note the visible error.

### `OPTIONAL_ASSISTANT_FAILED`

Retry the same **Ask**, **Analyze image**, or **Explain image** action once. If it fails again,
close and relaunch the app, prepare the models, and confirm their visible status. Note the visible
error if the failure persists.

### Electron runtime is missing

From the repository root, run:

```powershell
npm ci
npm run build
npm run start:built
```
