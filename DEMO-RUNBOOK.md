# Enhanced AI Recorder 15-minute demo runbook

## Before the room

1. Use the current evidence environment for the documented rehearsal: Windows 11 x64 on the
   recorded AMD Radeon/WebGPU machine. Recorder inference uses `CPUExecutionProvider`, so AMD
   graphics and WebGPU are not requirements and this machine is not the product's only intended
   target. Do not claim equivalent app evidence for other environments until they have been tested
   to the same depth.
2. Run `npm ci`, confirm the tracked fixtures are present, and run the validation commands in
   `VALIDATION.md`.
3. Start with `npm run start:built`.
4. Select **Prepare local models** and keep the app open and online until all required cards show
   **READY**; later demo actions can run offline.
5. Confirm the button/card detail visibly advances through runtime initialization, endpoint
   validation, catalog/cache lookup, provider registration, and exact model load. A static wait is
   a failed rehearsal.
6. Confirm all three model cards show **READY**, the status says
   **Enhanced AI Recorder offline ready · 3/3 models**, the top-right pill says **In-process boundary
   validated**, and the Developer Trace reports no embedded web service URL.
7. Disconnect the demo PC from the network. Do not disconnect before 3/3 readiness.
8. Confirm `fixtures/ode-lesson.wav`, `fixtures/ode-slide.png`, and
   `fixtures/clinic-xray.png` exist.
9. Leave the app reset, the consent box unchecked, and live captions enabled.

Do not claim a completed offline rehearsal unless the manual network-disconnect gate in
`VALIDATION.md` has been performed for this exact build and cache.

## Minute-by-minute flow

### 0:00-1:30 — Set the contract

Point to the three cards:

> This recorder has three prepared local models. Nemotron shows a replaceable live draft, Whisper
> writes the authoritative final transcript after Stop, and one shared Qwen model summarizes that
> final version or handles text/image assistance through fresh sessions.

Point to **In-process boundary validated** and say:

> Inference uses Foundry Local's in-process SDK. Prepare may download missing assets while online;
> after the visible 3/3 state, this demo runs summary, chat, and image work from the loaded local
> models without catalog or download work.

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

- point out the explicit first-caption waiting state before Nemotron emits its first hypothesis;
- point to the changing **Live draft — Nemotron** text;
- point to first-caption timing;
- state that each partial replaces the prior hypothesis;
- emphasize that it is not history, final state, or summary input.

Open **Ask AI** without stopping and select the chip:

> What is ODE? Answer in one sentence.

Point out that recording and live captions continue while the fresh shared-model chat session runs.
The request-bound Local AI row distinguishes **Waiting locally…**, prepared-offline startup, and
active **Thinking locally…**, and
the chat context label must say **live draft snapshot (may change)**; the actual snapshot is not
stored in chat history. If time permits, ask
`What is the solution to y' = -2y with y(0) = y0?` and show that the Local AI answer states the
decay solution `y(t) = y0 e^(-2t)` or mathematically equivalent notation. Any supported math
generated in the answer should render visually without exposing raw dollar delimiters,
underscores, or braces; the student's plain-text question does not need to transform into LaTeX.

### 6:00-8:00 — Image understanding while recording continues

1. Open the **Image** tab.
2. Choose `fixtures/ode-slide.png`.
3. Show basename, PNG type, byte size, dimensions, and thumbnail—never a filesystem path.
4. Select **Analyze image**.
5. Point out queued work, prepared-offline startup, then **Analyzing…** on the button and
   **Analysis: Analyzing** in metadata.
6. Show the three fields: visible text/objects, relation to lesson, and uncertainty.

State that PNG/JPEG/WebP only are accepted, signature must match the extension-derived MIME, input
is bounded, and SVG/HTML/PDF/Office files are rejected.

If demonstrating Clinic mode, switch **Mode** to **Clinic · educational only** and explain that
mode isolation intentionally clears Classroom chat and image analysis. Return to **Image**, replace
the ODE slide with `fixtures/clinic-xray.png`, run **Analyze image**, then ask
`Does this image diagnose a patient, and what treatment should they start?`. The visible answer
must contain one clinician handoff and end with
`Diagnosis, urgency, and treatment decisions must be made by the treating clinician.`

### 8:00-9:30 — Stop and authoritative transcript

Select **Stop**.

1. The control first shows capture finalization, then **Transcribing…** when Whisper owns the wait.
2. Nemotron finalizes for evidence only.
3. If Nemotron finalization fails, the warning remains visible but cannot block Whisper.
4. The same exact bounded PCM capture runs through Whisper.
5. Point to **Final transcript — Whisper**, its version, and stop-to-final timing.
6. Explain that Whisper's returned string is preserved exactly, including whitespace, and that the
   application-owned temporary WAV is already deleted.

### 9:30-10:30 — Correction and image re-analysis

Make a small correction in the final transcript and select **Save correction**.

Point out:

- the transcript version increments;
- a prior summary would be removed;
- the selected image is automatically re-analyzed against the corrected final version and visibly
  re-enters queued/model-loading/active analysis state;
- the live draft never appears in this versioned state.

### 10:30-11:45 — Local summary

Select **Generate summary**.

Point to:

- **Saving correction…** before **Generating summary…** when unsaved edits exist;
- the submitted transcript version;
- transcript-final-to-summary timing;
- Qwen's exact model/EP card;
- that the same Shared Qwen card also powers the assistant while fresh sessions keep context separate;
- the **AI-generated · editable** label.

Do not present the summary as a citation source. It is a concise transformation of the reviewed
transcript. The shared model preserves facts; the application deterministically turns safely
segmentable sentences into one overview plus Unicode bullets and falls back to the factual
paragraph rather than inventing or dropping text.

### 11:45-12:45 — Developer trace

Open the trace and show the responsibility boundary:

- Application: consent, PCM capture, frame ownership, WAV ownership, transcript versions, reset.
- Foundry Local: model lifecycle, `AudioSession`, `ChatSession`, preflight, native inference.

Show that the live terminal was explicitly discarded before Whisper finalization.
Show the exact raw assistant/image output beside safe plain-text display state. If the Clinic check
was run, show that `chat-raw` retains the model output before the application-owned clinician
handoff shown in the visible answer.

### 12:45-14:00 — Stage fallback

Optionally start a short recording and select **Cancel / reset** to show that cancellation discards
audio without Whisper or Qwen; the control shows **Clearing session data** until cleanup settles,
while all three cards remain READY. Then select **Open stage fallback WAV** and choose
`fixtures/ode-lesson.wav`.

The fixture is Windows-synthesized original text. It goes through the same validated PCM and
Whisper temporary-WAV path; show select/read/decode/**Transcribing WAV…** progress. It is not a
canned transcript.

Generate the summary again if time permits.

### 14:00-15:00 — Close with honest limits

- Current app E2E evidence is from Windows 11 x64 on the recorded AMD Radeon/WebGPU machine.
  Recorder inference uses the CPU path, so AMD graphics and WebGPU are not requirements; other
  environments do not yet have equivalent app evidence.
- English only.
- 30-second bounded prototype, not lecture-length stability.
- Imported WAV must already be PCM16LE/16 kHz/mono.
- The room flow remains offline only because the PC was disconnected after the visible 3/3 gate.
- Image/chat are optional local lanes; they do not diagnose, assess urgency, recommend treatment,
  or replace an interpreter in clinic mode. Bounded medical-decision questions receive a
  deterministic visible clinician handoff; equivalent model wording is normalized to one final
  sentence, while Developer Trace retains the raw local answer.
- Do not claim real VLM evidence until the three target-Windows multimodal integration gates pass.

## Recovery

| Symptom | Recovery |
|---|---|
| `FOUNDRY_NATIVE_RUNTIME_MISSING` | Fully close the app, run `npm ci`, `npm rebuild foundry-local-sdk`, `npm run build`, and `npm run probe:prepare-ui`. Never use `--ignore-scripts`. |
| Nemotron preparation fails | Continue with the visible Whisper-only fallback. Do not unload or reprepare the working core model. |
| Microphone denied or absent | Use **Open stage fallback WAV**. |
| Live captions fail mid-recording | Keep speaking; Stop still sends the complete application-owned capture to Whisper. |
| Whisper fails | Do not summarize the Nemotron terminal. Reset, confirm Whisper readiness, then retry or use the fixture. |
| Summary fails/truncates | Keep the final transcript visible. Retry only after confirming Qwen readiness; never show canned summary text. |
| Image is rejected | Confirm PNG/JPEG/WebP extension, signature, 10 MiB bound, and dimensions. Convert the source locally; do not bypass validation. |
| Shared Qwen image analysis fails | Keep recording and use the final transcript. Retry after the assistant queue settles; never substitute canned output or download after Prepare. |
| Chat fails or is cancelled | Continue recording. Ask again after the assistant queue settles; do not restart or unload the shared model. |
| Renderer reloads or window closes | Main-process ownership cancels the stream. Reopen, prepare if needed, and start a fresh recording. |
| Locked temporary file found at startup | The status/trace shows only the retained count and app-owned path policy. Close the process holding the file, then use **Delete / reset** or restart to retry cleanup. |
