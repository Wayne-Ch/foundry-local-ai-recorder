# AI Recorder Test Guide

Record observations without including private transcript content or local paths.

## Requirements

- A Windows 11 x64 PC.
- Git for Windows.
- Node.js and npm.
- Internet access for installation and first preparation.
- Several GB of free disk space for dependencies and model assets.
- A microphone is needed only for live voice-path testing; use the stage fallback WAV flow when no
  microphone is available.

## Validated configuration

This playtest's current E2E evidence was collected on a Windows 11 x64 machine with AMD Radeon
graphics, working WebGPU, and 64 GB RAM.
Validation used Node.js 26.13.0 and npm 11.20.0. All Recorder models use the
documented `CPUExecutionProvider` path; AMD Radeon/WebGPU identifies the evidence environment and
is not a model requirement. This configuration is not the product's only intended target. Foundry
Local's broader public platform and hardware support is separate, and other app environments must
not be presented as having equivalent evidence until tested to the same depth. No minimum RAM
requirement has been established; 64 GB describes the validated machine, not a product minimum.

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

Developer-only WAV regeneration and the required diff check are documented in
[VALIDATION.md](VALIDATION.md#developer-fixture-integrity).

## Prepare

First preparation can take several minutes while uncached model and execution-provider assets
download; stay online and keep AI Recorder open until all three model cards report **READY**.
Later demo actions can run offline.

1. Select **Prepare local models**.
2. Confirm the button and model rail immediately show busy state.
3. Confirm each card reports truthful phases such as catalog check, download, provider
   registration, load, and ready.
4. Confirm the final success says **AI Recorder offline ready · 3/3 models**.
5. Confirm Nemotron, Whisper, and Qwen3.5 0.8B each show the exact ID and CPU provider.

## Record

1. Check the consent box.
2. Select **Start** and allow microphone access.
3. Say naturally:

   > An ordinary differential equation relates a function to its derivatives. For the first order
   > equation y prime equals negative two y, separate the variables. The solution is y of t equals c
   > times e to the negative two t. If y of zero equals three, then c equals three.

4. Before the first caption, confirm the indicator says **Recording · waiting for caption**.
5. Confirm Nemotron text replaces the previous draft instead of appending a history.
6. Confirm the first-caption timing appears.

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
6. Open Developer Trace and confirm `summary-raw` retains the exact raw Qwen text while the summary
   field shows the deterministic presentation form.

## Reset and WAV fallback

1. Select **Delete / reset** and confirm the button shows a busy state.
2. Confirm transcript, summary, timing, and trace session data clear while all three model cards
   remain ready.
3. Select **Open stage fallback WAV** and choose `fixtures\ode-lesson.wav`.
4. Confirm the control moves through choose, read, decode, and Whisper transcription phases.
5. Generate a summary and confirm it follows the same versioned path as microphone capture.

## Failure observations

- Deny microphone access and confirm the app offers the WAV path without exposing a raw native
  message.
- Disable live captions before Prepare and confirm the UI does not claim 3/3 complete readiness.
- If Nemotron fails during capture, confirm Whisper still produces the authoritative final.
- If any failure occurs, record only the canonical code, operation, model, and phase metadata shown
  in the UI or Developer Trace.

## Shutdown and residue

1. Close the **AI Recorder** window normally.
2. Wait for `npm run start:built` to return to the PowerShell prompt.
3. From the clone root, run the following checks. Both commands must produce no output:

   ```powershell
   $repo = (Resolve-Path .).Path
   Get-CimInstance Win32_Process |
     Where-Object {
       $_.Name -in @("electron.exe", "node.exe") -and
       $_.CommandLine -and
       $_.CommandLine.Contains($repo, [System.StringComparison]::OrdinalIgnoreCase)
     }

   Get-ChildItem -LiteralPath "$env:TEMP\FoundryLocalAIRecorder\audio" `
     -Filter "capture-*.wav" -File -ErrorAction SilentlyContinue
   ```

## Pass criteria

- Every visible product name is **AI Recorder**.
- The only model roles are Nemotron, Whisper, and Qwen3.5 0.8B.
- The summary may be concise, but it must not assign a false role, relationship, equation, number,
  unit, name, date, or cause.
- Prepare, recording, Stop, WAV import, correction-save, summary, and Reset have truthful progress.
- No stale completion restores transcript or summary state after Reset.
- No owned temporary WAV remains after transcription or Reset.
- Normal window close returns the launch command to the prompt with no clone-owned Electron/Node
  process left running.
