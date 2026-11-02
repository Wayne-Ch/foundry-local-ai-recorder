export const SAFE_DIAGNOSTIC_CODES = [
  "OPTIONAL_LIVE_FAILED",
  "OPTIONAL_LIVE_CLEANUP_PENDING",
  "OPTIONAL_ASSISTANT_FAILED",
  "OPTIONAL_ASSISTANT_CLEANUP_PENDING",
  "OPERATION_ABORTED",
  "TIMEOUT",
  "RESOURCE_BUSY",
  "PERMISSION_DENIED",
  "IPC_UNAVAILABLE",
  "RESOURCE_UNAVAILABLE",
  "MULTIPLE_FAILURES",
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

export interface SafeDiagnostic {
  readonly code: SafeDiagnosticCode;
  readonly name: SafeDiagnosticName;
  readonly safeSummary: string;
  readonly truncated: boolean;
}

const SAFE_SUMMARIES: Readonly<Record<SafeDiagnosticCode, string>> = {
  OPTIONAL_LIVE_FAILED: "Optional live captions failed; Whisper audio remains authoritative.",
  OPTIONAL_LIVE_CLEANUP_PENDING: "Optional live-caption cleanup is still draining.",
  OPTIONAL_ASSISTANT_FAILED:
    "The optional local assistant failed; recording, transcription, and summary remain available.",
  OPTIONAL_ASSISTANT_CLEANUP_PENDING:
    "Optional assistant cleanup is still draining; the core recorder remains available.",
  OPERATION_ABORTED: "The local operation was aborted.",
  TIMEOUT: "The local operation did not finish within its bounded wait.",
  RESOURCE_BUSY: "A local native resource is still busy.",
  PERMISSION_DENIED: "A required local resource could not be accessed.",
  IPC_UNAVAILABLE: "The local IPC channel is unavailable.",
  RESOURCE_UNAVAILABLE: "A required local resource is unavailable.",
  MULTIPLE_FAILURES: "Multiple local operations failed.",
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

export function toSafeDiagnostic(
  value: unknown,
  fallbackCode: SafeDiagnosticCode = "UNKNOWN_FAILURE",
): SafeDiagnostic {
  const source = asDiagnosticSource(value);
  const code = safeCode(source.code, source.name, fallbackCode);
  return {
    code,
    name: safeName(source.name, code, value),
    safeSummary: SAFE_SUMMARIES[code],
    truncated: source.truncated || source.hasRawDetail,
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
  const omission = diagnostic.truncated ? "; details omitted" : "";
  return `${diagnostic.safeSummary} [${diagnostic.code}/${diagnostic.name}${omission}]`;
}

function asDiagnosticSource(value: unknown): {
  readonly code: string | null;
  readonly name: string | null;
  readonly truncated: boolean;
  readonly hasRawDetail: boolean;
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
  };
  const candidateCode = typeof candidate.code === "string" ? candidate.code : null;
  const canonicalSummary =
    candidateCode !== null && SAFE_CODE_SET.has(candidateCode)
      ? SAFE_SUMMARIES[candidateCode as SafeDiagnosticCode]
      : null;
  return {
    code: candidateCode,
    name: typeof candidate.name === "string" ? candidate.name : null,
    truncated: candidate.truncated === true,
    hasRawDetail:
      (typeof candidate.message === "string" && candidate.message.length > 0) ||
      (typeof candidate.safeSummary === "string" && candidate.safeSummary !== canonicalSummary),
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
