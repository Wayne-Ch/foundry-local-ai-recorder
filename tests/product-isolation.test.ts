import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TempAudioStore } from "../src/audio/temp-audio-store";
import { recorderOwnedPathLayout } from "../src/foundry/paths";
import {
  PRODUCT_NAME,
  PRODUCT_PACKAGE_NAME,
  PRODUCT_STORAGE_NAMESPACE,
  PRODUCT_USER_DATA_NAMESPACE,
} from "../src/shared/product";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AI Recorder product isolation", () => {
  it("uses a stable identity and app-owned path namespace", () => {
    expect(PRODUCT_NAME).toBe("AI Recorder");
    expect(PRODUCT_PACKAGE_NAME).toBe("foundry-local-ai-recorder");
    expect(PRODUCT_USER_DATA_NAMESPACE).toBe("AI Recorder");
    expect(PRODUCT_STORAGE_NAMESPACE).toBe("FoundryLocalAIRecorder");

    const layout = recorderOwnedPathLayout("C:\\LocalAppData", "C:\\Temp");
    expect(layout).toEqual({
      appDataDir: path.join("C:\\LocalAppData", PRODUCT_STORAGE_NAMESPACE),
      logsDir: path.join("C:\\LocalAppData", PRODUCT_STORAGE_NAMESPACE, "logs"),
      audioTempDir: path.join("C:\\Temp", PRODUCT_STORAGE_NAMESPACE, "audio"),
    });
    expect(JSON.stringify(layout)).not.toContain("SmartAIRecorder");
    expect(JSON.stringify(layout)).not.toContain("EnhancedAIRecorder");
  });

  it("never removes another app namespace during orphan recovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-recorder-isolation-"));
    tempRoots.push(root);
    const standardDir = path.join(root, PRODUCT_STORAGE_NAMESPACE, "audio");
    const enhancedDir = path.join(root, "FoundryLocalEnhancedAIRecorder", "audio");
    const standard = new TempAudioStore(standardDir);
    const standardCapture = path.join(standardDir, "capture-standard.wav");
    const enhancedCapture = path.join(enhancedDir, "capture-enhanced.wav");

    await Promise.all([mkdir(standardDir, { recursive: true }), mkdir(enhancedDir, { recursive: true })]);
    await writeFile(standardCapture, "standard");
    await writeFile(enhancedCapture, "enhanced");

    await expect(standard.recoverOwnedCaptures()).resolves.toMatchObject({
      discovered: 1,
      removed: 1,
      retained: 0,
    });
    await expect(readFile(enhancedCapture, "utf8")).resolves.toBe("enhanced");
  });
});
