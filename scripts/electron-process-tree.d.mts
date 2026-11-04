export interface OwnedProcessOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly label: string;
  readonly timeoutMs: number;
  readonly descendantExitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface OwnedProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly rootProcessId: number;
}

export interface ProcessIdentity {
  readonly processId: number;
  readonly creationKey: string;
}

export class ProcessTreeLeakError extends Error {
  readonly processIds: readonly number[];
  readonly output: string;
}

export class ProcessTreeTimeoutError extends Error {
  readonly output: string;
}

export function runOwnedProcess(options: OwnedProcessOptions): Promise<OwnedProcessResult>;

export function selectMatchingProcessIdentities(
  owned: readonly ProcessIdentity[],
  snapshot: readonly ProcessIdentity[],
): readonly ProcessIdentity[];
