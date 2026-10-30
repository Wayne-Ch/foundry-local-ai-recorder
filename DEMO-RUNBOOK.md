# 15-minute classroom demo runbook

## Before the room

1. Use Wayne's Windows 11 x64 demo PC.
2. Run `npm install`, `npm run fixture:generate`, and the validation commands in `VALIDATION.md`.
3. Start with `npm run start:built`.
4. Select **Prepare local models** while network access is still available.
5. Confirm all three model cards show **READY**, the top-right pill says **In-process boundary
   validated**, and the Developer Trace reports no embedded web service URL.
6. Confirm `fixtures/ode-lesson.wav` exists for the stage fallback.
7. Leave the app reset, the consent box unchecked, and live captions enabled.

Do not claim a completed offline rehearsal unless the manual network-disconnect gate in
`VALIDATION.md` has been performed for this exact build and cache.

## Minute-by-minute flow

### 0:00-1:30 — Set the contract

Point to the three cards:

> This recorder has three distinct local stages. Nemotron shows a replaceable live draft, Whisper
> writes the authoritative final transcript after Stop, and Qwen summarizes only that final
> version.

Point to **In-process boundary validated** and say:

> Inference uses Foundry Local's in-process SDK. Model preparation may download missing assets; the
> app does not call an external inference endpoint or start Foundry's embedded web service.

### 1:30-3:00 — Consent and model readiness

1. Open Developer Trace briefly.
2. Show exact IDs and execution providers.
3. Check the consent box.
4. Explain the transient microphone permission gate and 30-second prototype bound.

### 3:00-6:00 — Live ODE recording

Select **Start** and say this original segment at a natural pace:

> An ordinary differential equation relates a function to its derivatives. For the first order
> equation y prime equals negative two y, separate the variables. The solution is y of t equals c
> times e to the negative two t. The initial value determines the constant c.

While speaking:

- point to the changing **Live draft — Nemotron** text;
- point to first-caption timing;
- state that each partial replaces the prior hypothesis;
- emphasize that it is not history, final state, or summary input.

### 6:00-7:30 — Stop and authoritative transcript

Select **Stop**.

1. Nemotron finalizes for evidence only.
2. If Nemotron finalization fails, the warning remains visible but cannot block Whisper.
3. The same exact bounded PCM capture runs through Whisper.
4. Point to **Final transcript — Whisper**, its version, and stop-to-final timing.
5. Explain that Whisper's returned string is preserved exactly, including whitespace, and that the
   application-owned temporary WAV is already deleted.

### 7:30-9:00 — Correction and invalidation

Make a small correction in the final transcript and select **Save correction**.

Point out:

- the transcript version increments;
- a prior summary would be removed;
- the live draft never appears in this versioned state.

### 9:00-10:30 — Local summary

Select **Generate summary**.

Point to:

- the submitted transcript version;
- transcript-final-to-summary timing;
- Qwen's exact model/EP card;
- the **AI-generated · editable** label.

Do not present the summary as a citation source. It is a concise transformation of the reviewed
transcript.

### 10:30-12:00 — Developer trace

Open the trace and show the responsibility boundary:

- Application: consent, PCM capture, frame ownership, WAV ownership, transcript versions, reset.
- Foundry Local: model lifecycle, `AudioSession`, `ChatSession`, preflight, native inference.

Show that the live terminal was explicitly discarded before Whisper finalization.

### 12:00-13:30 — Stage fallback

Optionally start a short recording and select **Cancel / reset** to show that cancellation discards
audio without Whisper or Qwen. Then select **Open stage fallback WAV** and choose
`fixtures/ode-lesson.wav`.

The fixture is Windows-synthesized original text. It goes through the same validated PCM and
Whisper temporary-WAV path; it is not a canned transcript.

Generate the summary again if time permits.

### 13:30-15:00 — Close with honest limits

- Windows 11 x64 only.
- English only.
- 30-second bounded prototype, not lecture-length stability.
- Imported WAV must already be PCM16LE/16 kHz/mono.
- Network-disconnect rehearsal is a separate manual gate.
- Image processing is a later typed service boundary, not a hidden disabled feature.

## Recovery

| Symptom | Recovery |
|---|---|
| Nemotron preparation fails | Continue with the visible Whisper-only fallback. Do not unload or reprepare the working core model. |
| Microphone denied or absent | Use **Open stage fallback WAV**. |
| Live captions fail mid-recording | Keep speaking; Stop still sends the complete application-owned capture to Whisper. |
| Whisper fails | Do not summarize the Nemotron terminal. Reset, confirm Whisper readiness, then retry or use the fixture. |
| Summary fails/truncates | Keep the final transcript visible. Retry only after confirming Qwen readiness; never show canned summary text. |
| Renderer reloads or window closes | Main-process ownership cancels the stream. Reopen, prepare if needed, and start a fresh recording. |
| Locked temporary file found at startup | The status/trace shows only the retained count and app-owned path policy. Close the process holding the file, then use **Delete / reset** or restart to retry cleanup. |
