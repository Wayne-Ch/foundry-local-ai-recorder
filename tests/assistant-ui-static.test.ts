import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("assistant UI and Electron isolation", () => {
  it("keeps the side panel keyboard-readable and exposes non-color status text", async () => {
    const [source, progress, controlProgress, recorderProgress, styles] = await Promise.all([
      read("src/renderer/app.ts"),
      read("src/renderer/assistant-progress.ts"),
      read("src/renderer/assistant-control-progress.ts"),
      read("src/renderer/recorder-progress.ts"),
      read("src/renderer/styles.css"),
    ]);

    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-expanded="true"');
    expect(source).toContain('event.key !== "ArrowLeft"');
    expect(source).toContain("event.ctrlKey || event.metaKey");
    expect(source).toContain("assistantStatus.textContent");
    expect(source).toContain("document.createTextNode(value)");
    expect(source).toContain("renderAssistantChatRows(state)");
    expect(source).toContain("renderImageAnalyzeButton(elements.imageAnalyze, imageProgress)");
    expect(source).toContain("<strong>Shared Qwen</strong>");
    expect(source).toContain("Enhanced offline ready · 3/3 models");
    expect(source).toContain("Shared local summary and assistant model is ready.");
    expect(source).not.toContain("qwen3-0.6b-generic-gpu:2");
    expect(source).toContain('setRecorderOperation({ kind: "transcribing" })');
    expect(source).toContain('setRecorderOperation({ kind: "summary_generating" })');
    expect(source).toContain('setRecorderOperation({ kind: "resetting" })');
    expect(source.match(/generation !== operationGeneration/g)?.length).toBeGreaterThanOrEqual(10);
    expect(source).toContain('elements.reset.disabled = recorderOperation.kind === "resetting"');
    expect(recorderProgress).toContain('elements.modelRail.setAttribute("aria-busy"');
    expect(recorderProgress).toContain('elements.liveDraft.setAttribute("aria-busy"');
    expect(recorderProgress).toContain('elements.finalTranscript.setAttribute("aria-busy"');
    expect(recorderProgress).toContain('elements.summaryOutput.setAttribute("aria-busy"');
    expect(progress).toContain('"Thinking locally…"');
    expect(progress).toContain('"Loading the prepared cached shared model locally…"');
    expect(progress).toContain('"Waiting locally…"');
    expect(progress).toContain('"Analyzing…"');
    expect(controlProgress).toContain('"Queuing…"');
    expect(controlProgress).toContain('"Cancelling…"');
    expect(controlProgress).toContain('"Opening picker…"');
    expect(controlProgress).toContain('"Queuing analysis…"');
    expect(progress).toContain('row.setAttribute("aria-busy", "true")');
    expect(progress).toContain('value.setAttribute("role", "status")');
    expect(progress).toContain("row.append(role, text, contextLabels(message))");
    expect(recorderProgress).toContain('"Recording · waiting for caption"');
    expect(recorderProgress).toContain('"Transcribing with Whisper"');
    expect(recorderProgress).toContain('"Generating summary"');
    expect(recorderProgress).toContain('"Clearing session data"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toContain("assistantHistory.innerHTML");
    expect(source).not.toContain("imageAnalysis.innerHTML");
    expect(progress).not.toContain(".innerHTML");
  });

  it("preserves sandboxed preload isolation and main-frame ownership checks", async () => {
    const [main, preload] = await Promise.all([read("src/main/main.ts"), read("src/preload/preload.ts")]);

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("frame !== event.sender.mainFrame");
    expect(main).toContain("assistantSessionOwnership.assertOwned");
    expect(main.match(/new FoundryRecorderRuntime\(\)/g)).toHaveLength(1);
    expect(main).toContain("new RecorderController(foundryRuntime, createRecorderOperationJournal())");
    expect(main).toContain("runtime: foundryRuntime");
    expect(main).not.toContain("FoundryAssistantRuntime");
    expect(main).toContain("setWindowOpenHandler(() =>");
    expect(preload).toContain('contextBridge.exposeInMainWorld("recorderApi", api)');
    expect(preload).not.toContain('exposeInMainWorld("electron"');
  });

  it("keeps filesystem paths and original bytes out of renderer-visible image contracts", async () => {
    const contracts = await read("src/assistant/assistant-types.ts");

    expect(contracts).toContain("thumbnailDataUrl: string");
    expect(contracts).toContain("basename: string");
    expect(contracts).not.toMatch(/readonly\s+(?:file)?path:/i);
    expect(contracts).not.toMatch(/readonly\s+bytes:/i);
  });

  it("enforces LF text checkouts and preserves binary fixtures on Windows", async () => {
    const attributes = await read(".gitattributes");

    expect(attributes).toContain("* text=auto eol=lf");
    expect(attributes).toContain("*.png binary");
    expect(attributes).toContain("*.wav binary");
  });
});

async function read(file: string): Promise<string> {
  return readFile(path.resolve(file), "utf8");
}
