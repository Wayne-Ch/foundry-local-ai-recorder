import { describe, expect, it } from "vitest";
import {
  createSafeDiagnosticError,
  formatSafeDiagnostic,
  serializeSafeDiagnostic,
  toSafeDiagnostic,
} from "../src/shared/safe-diagnostic";

describe("safe diagnostic metadata", () => {
  it("preserves canonical operation, model, and phase metadata through an IPC error message", () => {
    const source = createSafeDiagnosticError("MODEL_PREPARATION_FAILED", {
      operation: "prepare",
      modelRole: "summary",
      phase: "model_load",
    });
    const wrapped = new Error(
      `Error invoking remote method 'recorder:prepare': Error: ${serializeSafeDiagnostic(source)}`,
    );

    const diagnostic = toSafeDiagnostic(wrapped, "LOCAL_OPERATION_FAILED");

    expect(diagnostic).toEqual({
      code: "MODEL_PREPARATION_FAILED",
      name: "Error",
      safeSummary: "A required local model could not be prepared.",
      truncated: false,
      context: {
        operation: "prepare",
        modelRole: "summary",
        phase: "model_load",
      },
    });
    expect(formatSafeDiagnostic(diagnostic)).toBe(
      "A required local model could not be prepared. [MODEL_PREPARATION_FAILED/Error; operation=prepare; model=summary; phase=model_load]",
    );
  });

  it("keeps actionable native recovery canonical and omits raw loader detail", () => {
    const raw = Object.assign(new Error("C:\\Users\\someone\\private\\onnxruntime.dll could not be loaded"), {
      code: "ERR_DLOPEN_FAILED",
    });
    const safe = createSafeDiagnosticError(
      "FOUNDRY_NATIVE_RUNTIME_MISSING",
      { operation: "prepare", phase: "native_runtime" },
      raw,
    );

    const rendered = formatSafeDiagnostic(toSafeDiagnostic(safe));

    expect(rendered).toContain("run npm ci (or npm rebuild foundry-local-sdk)");
    expect(rendered).toContain("phase=native_runtime");
    expect(rendered).not.toContain("C:\\Users");
    expect(rendered).not.toContain("onnxruntime.dll");
  });
});
