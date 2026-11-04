# AI Recorder Test Guide

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for installation and first preparation.
- Several GB of free disk space for dependencies and model assets.
- A microphone only for live voice-path testing; use the committed WAV fallback when no
  microphone is available.

## Tested configuration

This guide was tested on Windows 11 x64 with AMD Radeon graphics, working WebGPU, 64 GB RAM,
Node.js 26.13.0, and npm 11.20.0. All Recorder models use `CPUExecutionProvider`; AMD Radeon and
WebGPU are not model requirements.

## Setup

1. From the parent folder where you want the canonical clone, run:

   ```powershell
   git clone https://github.com/Wayne-Ch/foundry-local-ai-recorder.git ai-recorder
   Set-Location .\ai-recorder
   ```

2. Run `npm ci` and `npm run build`. The committed `fixtures\ode-lesson.wav` is ready to use.
3. Launch with `npm run start:built`.
4. Confirm the window title and top heading both say **AI Recorder**.
5. Leave live captions enabled and consent unchecked.

## Prepare

First preparation may download model and execution-provider assets. Stay online and keep AI
Recorder open until all three model cards report **READY**. Later test actions can run offline.

1. Select **Prepare local models**.
2. Confirm the button and model rail immediately show a busy state.
3. Confirm Nemotron, Whisper, and Qwen3.5 0.8B each reach **READY** and show the exact ID and CPU
   provider.
4. Confirm the final success says **AI Recorder offline ready · 3/3 models**.

## Record

1. Check the consent box.
2. Select **Start** and allow microphone access.
3. Say naturally:

   > An ordinary differential equation relates a function to its derivatives. For the first order
   > equation y prime equals negative two y, separate the variables. The solution is y of t equals c
   > times e to the negative two t. If y of zero equals three, then c equals three.

4. Before the first caption, confirm the indicator says **Recording · waiting for caption**.
5. Confirm Nemotron text replaces the previous draft instead of appending a history.

## Stop and review

1. Select **Stop**.
2. Confirm the UI moves through **Finalizing capture** and **Transcribing with Whisper**.
3. Confirm microphone use ends before the final transcript appears.
4. Confirm the Whisper transcript is editable and has a version.
5. Confirm the live draft is not copied into the final transcript.

## Correct and summarize

1. Correct one word in the final transcript.
2. Select **Generate summary** without first selecting **Save correction**.
3. Confirm the app visibly saves the correction before generating.
4. Confirm the transcript version increments.
5. Confirm the summary has one overview line followed by bullet lines and remains editable.

## Reset and WAV fallback

1. Select **Delete / reset** and confirm the button shows a busy state.
2. Confirm the transcript and summary clear while all three model cards remain ready.
3. Open the WAV fallback and choose `fixtures\ode-lesson.wav`.
4. Confirm the Whisper final transcript appears and remains editable.
5. Generate a summary and confirm it follows the same transcript-review flow as microphone
   capture.

## Failure observations

- If microphone access is denied, allow it in Windows and retry. If no microphone is available,
  use `fixtures\ode-lesson.wav`.
- If live captions fail during capture, retry once; Whisper should still produce the final
  transcript after Stop.
- If preparation or another action fails, close the app, relaunch with `npm run start:built`, retry
  once, and confirm the visible status. If it still fails, report only the visible error.

## Shut down

1. Close the **AI Recorder** window normally.
2. Wait for `npm run start:built` to return to the PowerShell prompt.
