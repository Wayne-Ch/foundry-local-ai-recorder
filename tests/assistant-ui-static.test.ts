import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("assistant UI and Electron isolation", () => {
  it("keeps the side panel keyboard-readable and exposes non-color status text", async () => {
    const source = await read("src/renderer/app.ts");

    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-expanded="true"');
    expect(source).toContain('event.key !== "ArrowLeft"');
    expect(source).toContain("event.ctrlKey || event.metaKey");
    expect(source).toContain("assistantStatus.textContent");
    expect(source).toContain("document.createTextNode(value)");
    expect(source).not.toContain("assistantHistory.innerHTML");
    expect(source).not.toContain("imageAnalysis.innerHTML");
  });

  it("preserves sandboxed preload isolation and main-frame ownership checks", async () => {
    const [main, preload] = await Promise.all([read("src/main/main.ts"), read("src/preload/preload.ts")]);

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("frame !== event.sender.mainFrame");
    expect(main).toContain("assistantSessionOwnership.assertOwned");
    expect(main.match(/new FoundryRecorderRuntime\(\)/g)).toHaveLength(1);
    expect(main).toContain("new RecorderController(foundryRuntime)");
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
});

async function read(file: string): Promise<string> {
  return readFile(path.resolve(file), "utf8");
}
