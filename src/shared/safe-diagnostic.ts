export const SAFE_DIAGNOSTIC_CODES = [
  "OPTIONAL_LIVE_FAILED",
  "OPTIONAL_LIVE_CLEANUP_PENDING",
  "OPERATION_ABORTED",
  "TIMEOUT",
  "RESOURCE_BUSY",
  "PERMISSION_DENIED",
  "IPC_UNAVAILABLE",
  "RESOURCE_UNAVAILABLE",
  "MULTIPLE_FAILURES",
  "FOUNDRY_NATIVE_RUNTIME_MISSING",
  "RUNTIME_INITIALIZATION_FAILED",
  "MODEL_PREPARATION_FAILED",
  "ENDPOINT_VALIDATION_FAILED",
  "LOCAL_OPERATION_FAILED",
  "UNKNOWN_FAILURE",
] as const;

export type SafeDiagnosticCode = (typeof SAFE_DIAGNOSTIC_CODES)[number];

export const SAFE_DIAGNOSTIC_NAMES = [
  "AbortError",
  "TimeoutError",
  "AggregateError",
  "DOMException",
  "Error",
  "UnknownError",
] as const;

export type SafeDiagnosticName = (typeof SAFE_DIAGNOSTIC_NAMES)[number];

export const SAFE_DIAGNOSTIC_OPERATIONS = [
  "prepare",
  "live_captions",
  "transcription",
  "summary",
  "reset",
] as const;

export type SafeDiagnosticOperation = (typeof SAFE_DIAGNOSTIC_OPERATIONS)[number];

export const SAFE_DIAGNOSTIC_PHASES = [
  "native_runtime",
  "runtime_initialization",
  "endpoint_validation",
  "catalog_lookup",
  "cache_lookup",
  "model_download",
  "provider_discovery",
  "provider_registration",
  "model_load",
  "inference",
  "cleanup",
] as const;

export type SafeDiagnosticPhase = (typeof SAFE_DIAGNOSTIC_PHASES)[number];

export interface SafeDiagnosticContext {
  readonly operation?: SafeDiagnosticOperation;
  readonly modelRole?: "whisper" | "nemotron" | "summary";
  readonly phase?: SafeDiagnosticPhase;
}

export interface SafeDiagnostic {
  readonly code: SafeDiagnosticCode;
  readonly name: SafeDiagnosticName;
  readonly safeSummary: string;
  readonly truncated: boolean;
  readonly context?: SafeDiagnosticContext;
}

const SAFE_SUMMARIES: Readonly<Record<SafeDiagnosticCode, string>> = {
  OPTIONAL_LIVE_FAILED: "Optional live captions failed; Whisper audio remains authoritative.",
  OPTIONAL_LIVE_CLEANUP_PENDING: "Optional live-caption cleanup is still draining.",
  OPERATION_ABORTED: "The local operation was aborted.",
  TIMEOUT: "The local operation did not finish within its bounded wait.",
  RESOURCE_BUSY: "A local native resource is still busy.",
  PERMISSION_DENIED: "A required local resource could not be accessed.",
  IPC_UNAVAILABLE: "The local IPC channel is unavailable.",
  RESOURCE_UNAVAILABLE: "A required local resource is unavailable.",
  MULTIPLE_FAILURES: "Multiple local operations failed.",
  FOUNDRY_NATIVE_RUNTIME_MISSING:
    "Foundry Local native runtime files are incomplete or incompatible. Close the app, run npm ci (or npm rebuild foundry-local-sdk), rebuild, and relaunch.",
  RUNTIME_INITIALIZATION_FAILED: "The Foundry Local in-process runtime could not be initialized.",
  MODEL_PREPARATION_FAILED: "A required local model could not be prepared.",
  ENDPOINT_VALIDATION_FAILED: "The Foundry Local in-process endpoint guard could not be validated.",
  LOCAL_OPERATION_FAILED: "A local recorder operation failed.",
  UNKNOWN_FAILURE: "The operation failed without safe diagnostic details.",
};

const SOURCE_CODE_MAP: Readonly<Record<string, SafeDiagnosticCode>> = {
  ABORT_ERR: "OPERATION_ABORTED",
  ERR_ABORTED: "OPERATION_ABORTED",
  ERR_CANCELED: "OPERATION_ABORTED",
  ECANCELED: "OPERATION_ABORTED",
  ETIMEDOUT: "TIMEOUT",
  ERR_OPERATION_TIMED_OUT: "TIMEOUT",
  EBUSY: "RESOURCE_BUSY",
  EACCES: "PERMISSION_DENIED",
  EPERM: "PERMISSION_DENIED",
  ENOENT: "RESOURCE_UNAVAILABLE",
  ERR_IPC_CHANNEL_CLOSED: "IPC_UNAVAILABLE",
  ERR_IPC_DISCONNECTED: "IPC_UNAVAILABLE",
};

const SAFE_CODE_SET = new Set<string>(SAFE_DIAGNOSTIC_CODES);
const SAFE_NAME_SET = new Set<string>(SAFE_DIAGNOSTIC_NAMES);
const SAFE_OPERATION_SET = new Set<string>(SAFE_DIAGNOSTIC_OPERATIONS);
const SAFE_PHASE_SET = new Set<string>(SAFE_DIAGNOSTIC_PHASES);
const SAFE_MODEL_ROLE_SET = new Set<string>(["whisper", "nemotron", "summary"]);
const SERIALIZED_SAFE_DIAGNOSTIC_PREFIX = "__AI_RECORDER_SAFE_DIAGNOSTIC__:";

export function toSafeDiagnostic(
  value: unknown,
  fallbackCode: SafeDiagnosticCode = "UNKNOWN_FAILURE",
): SafeDiagnostic {
  const serialized = parseSerializedSafeDiagnostic(value);
  if (serialized !== null) {
    return serialized;
  }
  const source = asDiagnosticSource(value);
  const code = safeCode(source.code, source.name, fallbackCode);
  return {
    code,
    name: safeName(source.name, code, value),
    safeSummary: SAFE_SUMMARIES[code],
    truncated: source.truncated || source.hasRawDetail,
    ...(source.context === undefined ? {} : { context: source.context }),
  };
}

export function sanitizeSafeDiagnostic(
  value: unknown,
  fallbackCode: SafeDiagnosticCode = "UNKNOWN_FAILURE",
): SafeDiagnostic | null {
  return value === null || value === undefined ? null : toSafeDiagnostic(value, fallbackCode);
}

export function combineSafeDiagnostics(
  first: SafeDiagnostic | null,
  second: SafeDiagnostic | null,
): SafeDiagnostic | null {
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }
  return {
    code: "MULTIPLE_FAILURES",
    name: "AggregateError",
    safeSummary: SAFE_SUMMARIES.MULTIPLE_FAILURES,
    truncated: true,
  };
}

export function formatSafeDiagnostic(diagnostic: SafeDiagnostic): string {
  const context = diagnostic.context;
  const metadata = [
    context?.operation === undefined ? null : `operation=${context.operation}`,
    context?.modelRole === undefined ? null : `model=${context.modelRole}`,
    context?.phase === undefined ? null : `phase=${context.phase}`,
    diagnostic.truncated ? "details omitted" : null,
  ].filter((value): value is string => value !== null);
  return `${diagnostic.safeSummary} [${diagnostic.code}/${diagnostic.name}${
    metadata.length === 0 ? "" : `; ${metadata.join("; ")}`
  }]`;
}

export function createSafeDiagnosticError(
  code: SafeDiagnosticCode,
  context?: SafeDiagnosticContext,
  cause?: unknown,
): Error & { readonly code: SafeDiagnosticCode; readonly diagnosticContext?: SafeDiagnosticContext } {
  return Object.assign(new Error(SAFE_SUMMARIES[code], cause === undefined ? undefined : { cause }), {
    code,
    ...(context === undefined ? {} : { diagnosticContext: context }),
  });
}

export function serializeSafeDiagnostic(
  value: unknown,
  fallbackCode: SafeDiagnosticCode = "UNKNOWN_FAILURE",
): string {
  return `${SERIALIZED_SAFE_DIAGNOSTIC_PREFIX}${JSON.stringify(toSafeDiagnostic(value, fallbackCode))}`;
}

function asDiagnosticSource(value: unknown): {
  readonly code: string | null;
  readonly name: string | null;
  readonly truncated: boolean;
  readonly hasRawDetail: boolean;
  readonly context?: SafeDiagnosticContext;
} {
  if (typeof value !== "object" || value === null) {
    return {
      code: null,
      name: null,
      truncated: false,
      hasRawDetail: typeof value === "string" && value.length > 0,
    };
  }
  const candidate = value as {
    readonly code?: unknown;
    readonly name?: unknown;
    readonly message?: unknown;
    readonly safeSummary?: unknown;
    readonly truncated?: unknown;
    readonly context?: unknown;
    readonly diagnosticContext?: unknown;
  };
  const candidateCode = typeof candidate.code === "string" ? candidate.code : null;
  const canonicalSummary =
    candidateCode !== null && SAFE_CODE_SET.has(candidateCode)
      ? SAFE_SUMMARIES[candidateCode as SafeDiagnosticCode]
      : null;
  const context = safeContext(candidate.diagnosticContext ?? candidate.context);
  return {
    code: candidateCode,
    name: typeof candidate.name === "string" ? candidate.name : null,
    truncated: candidate.truncated === true,
    hasRawDetail:
      (typeof candidate.message === "string" &&
        candidate.message.length > 0 &&
        candidate.message !== canonicalSummary) ||
      (typeof candidate.safeSummary === "string" && candidate.safeSummary !== canonicalSummary),
    ...(context === undefined ? {} : { context }),
  };
}

function parseSerializedSafeDiagnostic(value: unknown): SafeDiagnostic | null {
  const message =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null && "message" in value && typeof value.message === "string"
        ? value.message
        : null;
  if (message === null) {
    return null;
  }
  const prefixIndex = message.indexOf(SERIALIZED_SAFE_DIAGNOSTIC_PREFIX);
  if (prefixIndex < 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(message.slice(prefixIndex + SERIALIZED_SAFE_DIAGNOSTIC_PREFIX.length));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as {
      readonly code?: unknown;
      readonly name?: unknown;
      readonly safeSummary?: unknown;
      readonly truncated?: unknown;
      readonly context?: unknown;
    };
    if (
      typeof candidate.code !== "string" ||
      !SAFE_CODE_SET.has(candidate.code) ||
      typeof candidate.name !== "string" ||
      !SAFE_NAME_SET.has(candidate.name) ||
      candidate.safeSummary !== SAFE_SUMMARIES[candidate.code as SafeDiagnosticCode] ||
      typeof candidate.truncated !== "boolean"
    ) {
      return null;
    }
    const context = safeContext(candidate.context);
    return {
      code: candidate.code as SafeDiagnosticCode,
      name: candidate.name as SafeDiagnosticName,
      safeSummary: candidate.safeSummary,
      truncated: candidate.truncated,
      ...(context === undefined ? {} : { context }),
    };
  } catch {
    return null;
  }
}

function safeContext(value: unknown): SafeDiagnosticContext | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as {
    readonly operation?: unknown;
    readonly modelRole?: unknown;
    readonly phase?: unknown;
  };
  const operation =
    typeof candidate.operation === "string" && SAFE_OPERATION_SET.has(candidate.operation)
      ? (candidate.operation as SafeDiagnosticOperation)
      : undefined;
  const modelRole =
    typeof candidate.modelRole === "string" && SAFE_MODEL_ROLE_SET.has(candidate.modelRole)
      ? (candidate.modelRole as NonNullable<SafeDiagnosticContext["modelRole"]>)
      : undefined;
  const phase =
    typeof candidate.phase === "string" && SAFE_PHASE_SET.has(candidate.phase)
      ? (candidate.phase as SafeDiagnosticPhase)
      : undefined;
  if (operation === undefined && modelRole === undefined && phase === undefined) {
    return undefined;
  }
  return {
    ...(operation === undefined ? {} : { operation }),
    ...(modelRole === undefined ? {} : { modelRole }),
    ...(phase === undefined ? {} : { phase }),
  };
}

function safeCode(
  sourceCode: string | null,
  sourceName: string | null,
  fallbackCode: SafeDiagnosticCode,
): SafeDiagnosticCode {
  if (sourceCode !== null && SAFE_CODE_SET.has(sourceCode)) {
    return sourceCode as SafeDiagnosticCode;
  }
  if (sourceCode !== null && SOURCE_CODE_MAP[sourceCode] !== undefined) {
    return SOURCE_CODE_MAP[sourceCode];
  }
  if (sourceName === "NativeSettlementTimeoutError" || sourceName === "TimeoutError") {
    return "TIMEOUT";
  }
  if (sourceName === "AbortError") {
    return "OPERATION_ABORTED";
  }
  if (sourceName === "AggregateError") {
    return "MULTIPLE_FAILURES";
  }
  return fallbackCode;
}

function safeName(sourceName: string | null, code: SafeDiagnosticCode, value: unknown): SafeDiagnosticName {
  if (sourceName !== null && SAFE_NAME_SET.has(sourceName)) {
    return sourceName as SafeDiagnosticName;
  }
  if (sourceName === "NativeSettlementTimeoutError" || code === "TIMEOUT") {
    return "TimeoutError";
  }
  if (code === "OPERATION_ABORTED") {
    return "AbortError";
  }
  if (code === "MULTIPLE_FAILURES" || value instanceof AggregateError) {
    return "AggregateError";
  }
  if (value instanceof DOMException) {
    return "DOMException";
  }
  if (value instanceof Error) {
    return "Error";
  }
  return "UnknownError";
}
