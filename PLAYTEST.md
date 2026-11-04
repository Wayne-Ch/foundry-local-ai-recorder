# AI Recorder colleague playtest

Use a Windows 11 x64 PC with Git, Node.js 22 or later, npm, and internet access for installation
and first preparation. Record observations without including private transcript content or local
paths.

> [!IMPORTANT]
> The first **Prepare local models** can take several minutes and download roughly 2 GB or more of
> model and execution-provider assets. Remain online, keep **AI Recorder** open, and wait until all
> three required model cards show **READY** and the app says
> **AI Recorder offline ready · 3/3 models**. Do not disconnect before that checkpoint. After the
> cache is complete and all three models load successfully, subsequent demo actions can run
> offline.

## Setup

1. From the parent folder where you want the canonical clone, run:

   ```powershell
   git clone --branch feature/ai-recorder-ux-parity --single-branch https://github.com/Wayne-Ch/foundry-local-smart-ai-recorder.git ai-recorder
   Set-Location .\ai-recorder
   ```

2. Run `npm install`, `npm run fixture:generate`, and `npm run build`.
3. Launch with `npm run start:built`.
4. Confirm the window title and top heading both say **AI Recorder**.
5. Leave live captions enabled and consent unchecked.

## Prepare

1. Select **Prepare local models**.
2. Confirm the button and model rail immediately show busy state.
3. Confirm each card reports truthful phases such as catalog check, download, provider
   registration, load, and ready.
4. Confirm the final success says **AI Recorder offline ready · 3/3 models**.
5. Confirm Nemotron, Whisper, and Qwen3.5 0.8B each show the exact ID and CPU provider.

The first preparation has no fixed duration because uncached model and execution-provider assets
must download before loading. A second cached preparation should show loading without a new
download phase.

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
