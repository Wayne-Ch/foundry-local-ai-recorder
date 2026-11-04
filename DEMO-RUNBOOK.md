# AI Recorder 15-minute demo runbook

## Before the room

1. Use the validated Windows 11 x64 demo PC.
2. Run `npm install`, `npm run fixture:generate`, and every automated gate in `VALIDATION.md`.
3. Launch with `npm run start:built`.
4. Select **Prepare local models** while network access is available.
5. Confirm **AI Recorder offline ready · 3/3 models**, all three cards show **READY**, and the
   boundary pill says **In-process boundary validated**.
6. Leave the app reset, consent unchecked, and live captions enabled.
7. Keep `fixtures\ode-lesson.wav` available for the stage fallback.

Do not claim a completed offline rehearsal until the manual network-disconnect gate has been run for
this exact build and cache.

## 0:00-1:30 — Set the contract

Point to the three cards:

> Nemotron is the replaceable live draft, Whisper is the authoritative transcript after Stop, and
> Qwen3.5 0.8B summarizes only the reviewed Whisper version.

Point to the boundary pill:

> Foundry Local inference runs in process. Prepare may download missing assets, but the app rejects
> an active embedded web service or URL.

## 1:30-3:00 — Consent and truthful readiness

1. Open Developer Trace briefly.
2. Show the exact model IDs and providers.
3. Explain that complete offline readiness is shown only at 3/3.
4. Check consent and describe the transient microphone permission gate.

## 3:00-6:00 — Live ODE recording

Select **Start** and say naturally:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. If y of zero equals three, then c equals three.

Show:

- **Recording · waiting for caption** before the first result;
- replaceable Nemotron text;
- first-caption timing;
- the 30-second bounded timer.

State that the draft never becomes durable transcript or summary input.

## 6:00-7:30 — Stop and authoritative transcript

Select **Stop**.

1. Point out **Finalizing capture** and **Transcribing with Whisper**.
2. Explain that tracks are released before Whisper runs.
3. Show the final transcript version and stop-to-final timing.
4. Explain that the temporary WAV is app-owned and deleted after native settlement.

## 7:30-9:00 — Correction and stale-result guard

Edit one word, then select **Generate summary** directly.

Show that the app first saves the correction, increments the transcript version, and only then
submits Qwen. A completion for an older version cannot attach after the edit or Reset.

## 9:00-10:30 — Qwen3.5 0.8B summary

Point to:

- the exact Qwen3.5 0.8B / CPU card;
- transcript-final-to-summary timing;
- overview-plus-bullets presentation;
- the **AI-generated · editable** label.

Do not present the summary as a citation source.

## 10:30-12:00 — Developer Trace

Show:

- Prepare correlation and phase evidence;
- exact raw `summary-raw` text;
- whether deterministic presentation formatting was applied;
- canonical safe diagnostics with operation/model/phase metadata only.

## 12:00-13:30 — Reset and stage fallback

1. Select **Delete / reset** and show its busy state.
2. Confirm session data clears while prepared model cards stay ready.
3. Select **Open stage fallback WAV** and choose `fixtures\ode-lesson.wav`.
4. Show choose/read/decode/transcribe progress and generate a new summary.

## 13:30-15:00 — Close with honest limits

- Windows 11 x64 and English only.
- 30-second bounded prototype.
- PCM16LE/16 kHz/mono WAV import only.
- Qwen3.5 0.8B is the standard summary-only model and passed the omission-tolerant factual accuracy
  gate without output rewriting.
- Physical network disconnection is a separate manual release gate.

## Recovery

| Symptom | Recovery |
|---|---|
| Native preflight fails | Close the app, run `npm ci` or `npm rebuild foundry-local-sdk`, rebuild, and retry. |
| Nemotron preparation fails | Continue with the visible degraded recorder state; do not claim 3/3 offline readiness. |
| Microphone denied or absent | Use **Open stage fallback WAV**. |
| Live draft fails mid-recording | Keep speaking; Stop still sends the complete bounded capture to Whisper. |
| Whisper fails | Do not summarize the Nemotron terminal. Reset, confirm Whisper readiness, and retry. |
| Summary fails | Keep the final transcript visible; never substitute canned text. |
| Renderer reloads or closes | Main-process ownership cancels the exact stream lease. |
| Locked temporary WAV remains | Close the process holding it, then use **Delete / reset** or restart to retry cleanup. |
