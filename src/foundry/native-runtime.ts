import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSafeDiagnosticError,
  type SafeDiagnosticContext,
  toSafeDiagnostic,
} from "../shared/safe-diagnostic";

const WINDOWS_NATIVE_FILES = [
  "foundry_local_node.node",
  "foundry_local_preload.node",
  "foundry_local.dll",
  "Microsoft.Windows.AI.MachineLearning.dll",
  "onnxruntime.dll",
  "onnxruntime-genai.dll",
  "onnxruntime_providers_shared.dll",
] as const;

export interface NativeRuntimeProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly resolveSdkEntry?: () => string;
  readonly exists?: (filePath: string) => boolean;
}

export function missingFoundryNativeRuntimeFiles(options: NativeRuntimeProbeOptions = {}): readonly string[] {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "win32") {
    return [];
  }
  const sdkEntry = options.resolveSdkEntry?.() ?? fileURLToPath(import.meta.resolve("foundry-local-sdk"));
  const prebuildDirectory = path.resolve(path.dirname(sdkEntry), "..", "prebuilds", `${platform}-${arch}`);
  const exists = options.exists ?? existsSync;
  return WINDOWS_NATIVE_FILES.filter((fileName) => !exists(path.join(prebuildDirectory, fileName)));
}

export function assertFoundryNativeRuntimeReady(options: NativeRuntimeProbeOptions = {}): void {
  const missing = missingFoundryNativeRuntimeFiles(options);
  if (missing.length === 0) {
    return;
  }
  throw createSafeDiagnosticError("FOUNDRY_NATIVE_RUNTIME_MISSING", nativeRuntimeDiagnosticContext());
}

export function foundryNativeRuntimeError(error: unknown): Error {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_DLOPEN_FAILED") {
    return createSafeDiagnosticError(
      "FOUNDRY_NATIVE_RUNTIME_MISSING",
      nativeRuntimeDiagnosticContext(),
      error,
    );
  }
  const existing = toSafeDiagnostic(error, "RUNTIME_INITIALIZATION_FAILED");
  if (
    existing.code === "FOUNDRY_NATIVE_RUNTIME_MISSING" ||
    existing.code === "RUNTIME_INITIALIZATION_FAILED"
  ) {
    return createSafeDiagnosticError(
      existing.code,
      existing.context ?? {
        operation: "prepare",
        phase: "runtime_initialization",
      },
      error,
    );
  }
  return createSafeDiagnosticError(
    "RUNTIME_INITIALIZATION_FAILED",
    {
      operation: "prepare",
      phase: "runtime_initialization",
    },
    error,
  );
}

function nativeRuntimeDiagnosticContext(): SafeDiagnosticContext {
  return {
    operation: "prepare",
    phase: "native_runtime",
  };
}
