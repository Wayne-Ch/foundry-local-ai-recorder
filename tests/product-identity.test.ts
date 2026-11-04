import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recorderOwnedPathLayout } from "../src/foundry/paths";
import {
  PRODUCT_NAME,
  PRODUCT_PACKAGE_NAME,
  PRODUCT_STORAGE_NAMESPACE,
  PRODUCT_USER_DATA_NAMESPACE,
} from "../src/shared/product";

describe("Enhanced AI Recorder identity", () => {
  it("keeps package, window, profile, and owned storage names aligned", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      readonly name: string;
      readonly productName: string;
      readonly description: string;
    };

    expect(PRODUCT_NAME).toBe("Enhanced AI Recorder");
    expect(PRODUCT_PACKAGE_NAME).toBe("foundry-local-enhanced-ai-recorder");
    expect(PRODUCT_USER_DATA_NAMESPACE).toBe(PRODUCT_NAME);
    expect(PRODUCT_STORAGE_NAMESPACE).toBe("FoundryLocalEnhancedAIRecorder");
    expect(packageJson).toMatchObject({
      name: PRODUCT_PACKAGE_NAME,
      productName: PRODUCT_NAME,
    });
    expect(packageJson.description).toContain(PRODUCT_NAME);
    const localAppDataRoot = path.resolve("test-local-app-data");
    const tempRoot = path.resolve("test-temp");
    expect(recorderOwnedPathLayout(localAppDataRoot, tempRoot)).toEqual({
      appDataDir: path.join(localAppDataRoot, PRODUCT_STORAGE_NAMESPACE),
      logsDir: path.join(localAppDataRoot, PRODUCT_STORAGE_NAMESPACE, "logs"),
      audioTempDir: path.join(tempRoot, PRODUCT_STORAGE_NAMESPACE, "audio"),
    });
  });
});
