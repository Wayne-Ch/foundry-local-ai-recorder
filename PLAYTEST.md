# AI Recorder Test Guide

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for installation and first preparation.
- Several GB of free disk space for dependencies and model files.
- A microphone only for live recording tests; use the included WAV fallback when no
  microphone is available.

Note: This guide was validated on Windows 11 x64 with Node.js 26.13.0 and npm 11.20.0. Other environments have not yet been validated.

## Setup

1. Complete the [README installation and launch steps](README.md#fresh-clone-install-and-launch).
2. Confirm the window title and top heading both say **AI Recorder**.
3. Leave **Live English captions** enabled and the
   **I have consent to record this audio.** checkbox unchecked.

## Prepare

First preparation may download model and execution-provider files. Stay online and keep AI
Recorder open until all three model cards report **READY**. Later test actions can run offline.

1. Select **Prepare local models**.
2. Confirm the button changes to a busy label and the three model cards show preparation progress.
3. Confirm Nemotron, Whisper, and Qwen3.5 0.8B each reach **READY** and match the IDs and provider in
   the README [Local AI models](README.md#local-ai-models) table.
4. Confirm the final success says **AI Recorder offline ready · 3/3 models**.

## Record

1. Select the **I have consent to record this audio.** checkbox.
2. Select **Start** and allow microphone access.
3. Say naturally:

   > An ordinary differential equation relates a function to its derivatives. For the first order
   > equation y prime equals negative two y, separate the variables. The solution is y of t equals c
   > times e to the negative two t. If y of zero equals three, then c equals three.

4. Before the first caption, confirm the indicator says **Recording · waiting for caption**.
5. Confirm text in **Live draft** replaces the previous draft instead of appending a history.

## Stop and review

1. Select **Stop**.
2. Confirm the UI moves through **Finalizing capture** and **Transcribing with Whisper**.
3. Confirm microphone use ends before the final transcript appears.
4. Confirm **Final transcript** is editable and shows a version.
5. Confirm the live draft is not copied into the final transcript.

## Correct and summarize

1. Correct one word in **Final transcript**.
2. Select **Generate summary** without first selecting **Save correction**.
3. Confirm the status says **Saving the transcript correction before summary generation…** before
   summary generation begins.
4. Confirm the transcript version increments.
5. Confirm **Session summary** has one overview line followed by bullet lines and remains editable.

## Reset and WAV fallback

1. Select **Delete / reset** and confirm it changes to **Cancelling / resetting…**.
2. Confirm the transcript and summary clear while all three model cards remain ready.
3. Select **Open stage fallback WAV** and choose `fixtures\ode-lesson.wav`.
4. Confirm **Final transcript** appears and remains editable.
5. Generate a summary and confirm it follows the same transcript-review flow as microphone
   capture.

## Failure observations

- If microphone access is denied, allow it in Windows and retry. If no microphone is available,
  use `fixtures\ode-lesson.wav`.
- If live captions fail during capture, select **Stop**; Whisper should still produce the final
  transcript. Retry the recording once if needed.
- If preparation or another action fails, close the app, relaunch with `npm run start:built`, retry
  once, and confirm the visible status. If it still fails, note the visible error message.

## Shut down

1. Close the **AI Recorder** window normally.
2. Wait for `npm run start:built` to return to the PowerShell prompt.
