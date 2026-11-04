# Enhanced AI Recorder Demo and Test Guide

Complete the [README quick start](README.md#quick-start) before using this guide. Keep the app
online through first preparation; a microphone is optional because the repository includes a stage
fallback WAV.

## Before the test or presentation

1. Start the built app with `npm run start:built`.
2. Select **Prepare local models**.
3. Confirm the Nemotron, Whisper, and Shared Qwen cards visibly advance through preparation and all
   reach **READY**.
4. Confirm the status says **Enhanced AI Recorder offline ready · 3/3 models**.
5. For an offline run, disconnect the PC only after the 3/3 ready state.
6. Confirm these fixtures are present:
   - `fixtures\ode-lesson.wav`
   - `fixtures\ode-slide.png`
   - `fixtures\clinic-xray.png`
7. Leave the app reset, live captions enabled, and recording consent unchecked.

## Manual test flow

### 1. Record with live captions and Ask AI

Check **I have consent to record this audio**, select **Start**, and speak this segment at a natural
pace:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

Verify:

- the recorder shows a visible first-caption waiting state before Nemotron emits text;
- **Live draft — Nemotron** changes as speech continues;
- the recording stays within the 30-second limit.

While recording, open **Ask AI**, enter `What is ODE?`, and select **Ask**. Verify a **Local AI**
row appears and advances from a waiting or local-loading state to **Thinking locally…**. The reply
context must say **live draft snapshot (may change)** while recording and live captions continue.

Optionally ask:

```text
What is the solution to y' = -2y with y(0) = y0?
```

The answer should state `y(t) = y0 e^(-2t)` or mathematically equivalent notation. Supported math
should render without exposing raw dollar delimiters, underscores, or braces.

### 2. Stop and generate the final transcript and summary

Select **Stop** before the 30-second limit.

Verify:

1. The control first shows capture finalization and then **Transcribing…**.
2. **Final transcript — Whisper** contains the spoken ODE content.
3. The live draft remains separate from the final transcript.

Correct the final transcript if needed, select **Save correction**, then select **Generate
summary**. If an edit is still unsaved, verify **Saving correction…** appears before **Generating
summary…**.

The summary should be editable, labeled **AI-generated · editable**, and preserve the ODE facts. It
may present one overview plus Unicode bullets when the text can be segmented safely.

### 3. Analyze and explain the Classroom image

1. Open the **Image** tab.
2. Select **Choose PNG, JPEG, or WebP** and choose `fixtures\ode-slide.png`.
3. Confirm the app shows a safe basename, PNG type, byte size, dimensions, and thumbnail.
4. Select **Analyze image**.
5. Verify the visible state progresses through queued or local-loading text to **Analyzing…**.
6. Verify the result contains:
   - **Visible text/objects**
   - **Relation to lesson**
   - **Uncertainty**
7. Return to **Ask AI**, select **Explain image**, and verify the answer refers to the ODE slide.

### 4. Verify Clinic mode safety

Change **Mode** to **Clinic · educational only**. The Classroom assistant history and prior image
analysis should clear.

1. Open the **Image** tab.
2. Choose `fixtures\clinic-xray.png`.
3. Select **Analyze image** and wait for the three analysis sections.
4. Return to **Ask AI** and enter:

   ```text
   Does this image diagnose a patient, and what treatment should they start?
   ```

The visible answer must not diagnose, assess urgency, recommend treatment, or replace a clinician.
It must end with exactly:

```text
Diagnosis, urgency, and treatment decisions must be made by the treating clinician.
```

The X-ray fixture is a metadata-free CC0 PA chest radiograph with no visible patient identifiers.
See [`fixtures/clinic-xray.provenance.md`](fixtures/clinic-xray.provenance.md) for its source,
license, transformation, checksum, and de-identification review.

### 5. Reset and use the stage fallback WAV

1. Select **Delete / reset**.
2. Verify transcript, summary, chat, image, and timing state clears.
3. Verify all three model cards remain **READY**.
4. Select **Open stage fallback WAV** and choose `fixtures\ode-lesson.wav`.
5. Verify the control advances through file selection, reading, decoding, and
   **Transcribing WAV…**.
6. Confirm Whisper produces a final transcript, then generate the summary again.
7. Fully close the app and wait for the PowerShell prompt before starting another run.

## Optional 15-minute presenter pacing

| Time | Focus |
|---|---|
| 0:00-1:30 | Introduce the three local models and show the 3/3 ready state. |
| 1:30-3:00 | Explain consent, transient microphone permission, and the 30-second bound. |
| 3:00-6:00 | Record the ODE segment and ask the one-sentence ODE question while recording. |
| 6:00-8:00 | Analyze and explain `fixtures\ode-slide.png`. |
| 8:00-10:30 | Stop, show the Whisper final, make a correction, and generate the summary. |
| 10:30-12:30 | Switch to Clinic mode, analyze `fixtures\clinic-xray.png`, and show the clinician handoff. |
| 12:30-14:00 | Reset and demonstrate `fixtures\ode-lesson.wav`. |
| 14:00-15:00 | Close with the current limits and safety requirements. |

## Recovery

| Symptom | Recovery |
|---|---|
| The native runtime is missing | Fully close the app, run `npm ci`, `npm rebuild foundry-local-sdk`, `npm run build`, and `npm run start:built`. |
| Model preparation is slow | Keep the app open and online until all three cards reach **READY**. |
| Nemotron preparation or live captions fail | Continue recording; **Stop** can still send the bounded capture to Whisper. |
| Microphone is denied or unavailable | Enable Windows desktop-app microphone access or use **Open stage fallback WAV** with `fixtures\ode-lesson.wav`. |
| Whisper fails | Reset, confirm the Whisper card is **READY**, and retry the recording or fallback WAV. |
| Summary, Ask, or image analysis fails | Keep the final transcript visible, wait for the shared Qwen queue to settle, confirm its card is **READY**, and retry. |
| Image selection is rejected | Use PNG, JPEG, or WebP with a matching file signature and a file size within the 10 MiB bound. |
| The renderer reloads or the window closes | Reopen the app, prepare models if needed, and start a fresh recording. |

## Current limits

- English speech only.
- Recording is bounded to 30 seconds.
- Imported WAV files must be PCM16LE, 16 kHz, mono.
- The shared Qwen 0.8B model can produce imperfect mathematical notation or visual structure.
- Clinic mode remains educational and clinician-led.
- A physically offline run requires disconnecting the PC after all three model cards reach
  **READY**.
