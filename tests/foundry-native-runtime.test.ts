import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFoundryNativeRuntimeReady,
  foundryNativeRuntimeError,
  missingFoundryNativeRuntimeFiles,
} from "../src/foundry/native-runtime";
import { toSafeDiagnostic } from "../src/shared/safe-diagnostic";

describe("Foundry native runtime preflight", () => {
  it("reports missing Windows runtime dependencies before manager creation", () => {
    const sdkEntry = path.join("C:\\repo", "node_modules", "foundry-local-sdk", "dist", "index.js");
    const missing = missingFoundryNativeRuntimeFiles({
      platform: "win32",
      arch: "x64",
      resolveSdkEntry: () => sdkEntry,
      exists: (filePath) => !filePath.endsWith("onnxruntime-genai.dll"),
    });

    expect(missing).toEqual(["onnxruntime-genai.dll"]);
    expect(() =>
      assertFoundryNativeRuntimeReady({
        platform: "win32",
        arch: "x64",
        resolveSdkEntry: () => sdkEntry,
        exists: (filePath) => !filePath.endsWith("onnxruntime-genai.dll"),
      }),
    ).toThrow("Foundry Local native runtime files are incomplete");
  });

  it("maps loader failures to the actionable canonical diagnostic", () => {
    const failure = foundryNativeRuntimeError(
      Object.assign(new Error("specified procedure could not be found"), {
        code: "ERR_DLOPEN_FAILED",
      }),
    );

    expect(toSafeDiagnostic(failure)).toMatchObject({
      code: "FOUNDRY_NATIVE_RUNTIME_MISSING",
      context: {
        operation: "prepare",
        phase: "native_runtime",
      },
    });
  });
});
