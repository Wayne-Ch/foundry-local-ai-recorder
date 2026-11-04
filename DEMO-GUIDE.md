# AI Recorder Demo and Test Guide

This guide combines a manual UI test with an optional 15-minute stage walkthrough. Complete
[README setup](README.md#quick-start) before starting.

## Prerequisites

- Use the built app started with `npm run start:built`.
- Stay online for the first model preparation.
- Use a microphone for the live path, or use `fixtures\ode-lesson.wav` for the fallback path.
- Keep the app reset, consent unchecked, and live captions enabled before the walkthrough.

## Prepare the demo

1. Launch the app with `npm run start:built`.
2. Select **Prepare local models**.
3. Keep the app open and online until preparation finishes.
4. Confirm Nemotron, Whisper, and Qwen3.5 0.8B each show **READY**, the exact model ID, and
   `CPUExecutionProvider`.
5. Confirm the status reads **AI Recorder offline ready · 3/3 models**.
6. Select **Delete / reset** if any prior session data is visible.
7. Keep `fixtures\ode-lesson.wav` available for the fallback segment.

## Optional 15-minute walkthrough

The timings are optional; the same steps work as an untimed manual test.

### 0:00-1:30 - Explain the workflow

Point to the three model cards:

> Nemotron is the replaceable live draft, Whisper is the authoritative transcript after Stop, and
> Qwen3.5 0.8B summarizes only the reviewed Whisper version.

### 1:30-3:00 - Consent and readiness

1. Confirm all three model cards remain **READY**.
2. Check the consent box.
3. Select **Start** and allow microphone access.

Expected outcomes:

- The app requests audio permission only after the user action.
- The recording controls become busy immediately.
- Before the first caption, the indicator reads **Recording · waiting for caption**.

### 3:00-6:00 - Record the ODE sample

Say naturally:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. If y of zero equals three, then c equals three.

Expected outcomes:

- Nemotron text replaces the previous draft instead of appending a history.
- First-caption timing appears.
- The timer remains bounded to 30 seconds.
- The live draft is visibly separate from the final transcript area.

### 6:00-7:30 - Stop and review the transcript

1. Select **Stop**.
2. Watch the UI move through **Finalizing capture** and **Transcribing with Whisper**.
3. Confirm microphone use ends before the final transcript appears.
4. Confirm the Whisper transcript is editable and shows a version.

The live Nemotron draft must not be copied into the final transcript.

### 7:30-10:30 - Correct and summarize

1. Correct one word in the final transcript.
2. Select **Generate summary** without first selecting **Save correction**.
3. Confirm the app saves the correction before generating.
4. Confirm the transcript version increments.
5. Confirm the summary contains an overview followed by bullet lines and remains editable.

Review the summary against the final transcript. The summary is AI-generated and is not a citation
source.

### 10:30-12:30 - Reset and use the WAV fallback

1. Select **Delete / reset**.
2. Confirm transcript, summary, and timing data clear while all three model cards remain ready.
3. Select **Open stage fallback WAV**.
4. Choose `fixtures\ode-lesson.wav`.
5. Confirm the control moves through choose, read, decode, and Whisper transcription phases.
6. Generate a summary and confirm it follows the same editable, versioned flow as microphone
   capture.

### 12:30-15:00 - Close with current limits

State the visible product limits:

- English speech only.
- 30-second bounded capture.
- PCM16LE, 16 kHz, mono WAV import only.
- Transcript and summary state are memory-only.
- Summaries must be reviewed against the final transcript.

Close the **AI Recorder** window normally and wait for `npm run start:built` to return to the
PowerShell prompt.

## Offline variation

After one successful online preparation, close the app, disconnect the PC from the network, launch
again with `npm run start:built`, and run the recording and WAV-fallback sections above. Confirm
that both cached flows complete while the PC remains disconnected. Reconnect before preparing any
missing model assets.

## Recovery

| Symptom | Recovery |
|---|---|
| Preparation is still downloading | Keep the app open and online until every required card reports **READY**. |
| Native preflight fails | Close the app, run `npm ci` or `npm rebuild foundry-local-sdk`, run `npm run build`, and retry. |
| Microphone is denied or unavailable | Use **Open stage fallback WAV** with `fixtures\ode-lesson.wav`. |
| Nemotron fails during recording | Keep speaking and select **Stop**; Whisper still receives the bounded capture. |
| Nemotron cannot prepare | Continue in the visible degraded state with Whisper and Qwen; 3/3 readiness is unavailable. |
| Whisper fails | Do not summarize the live draft. Reset, confirm Whisper is ready, and retry. |
| Summary fails | Keep the final transcript visible and retry; do not substitute canned text. |
| WAV import fails | Confirm the file is PCM16LE, 16 kHz, mono. |

## Safety and limitations

- Obtain consent before recording.
- Use the final Whisper transcript, not the live draft, for review and summary generation.
- Verify AI-generated summaries before presenting or handing them off.
- Do not use a summary as a citation source.
- The app does not automatically export, sync, or retain transcript and summary state.
- First preparation can download model and execution-provider assets.
