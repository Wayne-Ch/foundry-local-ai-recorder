import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POWERSHELL = "powershell.exe";
const PROCESS_SNAPSHOT_TIMEOUT_MS = 5_000;
const JOB_CLEANUP_TIMEOUT_MS = 10_000;
const JOB_RUNNER_WATCHDOG_GRACE_MS = 30_000;
const JOB_RUNNER_SCRIPT = fileURLToPath(new URL("./windows-job-runner.ps1", import.meta.url));

const PROCESS_SNAPSHOT_SCRIPT = `
$ErrorActionPreference = "Stop"
$items = @(
  Get-CimInstance Win32_Process | ForEach-Object {
    $processId = [int]$_.ProcessId
    $creationValue = if ($null -eq $_.CreationDate) {
      ""
    } else {
      $fileTime = [long]$_.CreationDate.ToUniversalTime().ToFileTimeUtc()
      ($fileTime - ($fileTime % 10)).ToString()
    }
    [PSCustomObject]@{
      ProcessId = $processId
      CreationKey = if ($creationValue.Length -eq 0) {
        ""
      } else {
        "$($processId):$creationValue"
      }
    }
  }
)
ConvertTo-Json -Compress -Depth 3 -InputObject $items
`;

export class ProcessTreeLeakError extends Error {
  constructor(label, processIds, output) {
    super(
      `${label} left owned descendant processes running after its top-level process exited: ${processIds.join(
        ", ",
      )}. The full owned tree was terminated.`,
    );
    this.name = "ProcessTreeLeakError";
    this.processIds = processIds;
    this.output = output;
  }
}

export class ProcessTreeTimeoutError extends Error {
  constructor(label, timeoutMs, output) {
    super(`${label} timed out after ${timeoutMs} ms. The full owned process tree was terminated.`);
    this.name = "ProcessTreeTimeoutError";
    this.output = output;
  }
}

export async function runOwnedProcess({
  command,
  args = [],
  cwd,
  env,
  label,
  timeoutMs,
  descendantExitTimeoutMs = 5_000,
  pollIntervalMs = 100,
}) {
  assertWindows();
  const controlDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-recorder-job-"));
  const requestPath = path.join(controlDirectory, "request.json");
  const resultPath = path.join(controlDirectory, "result.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      command,
      args,
      cwd,
      timeoutMs,
      descendantExitTimeoutMs,
      pollIntervalMs,
      cleanupTimeoutMs: JOB_CLEANUP_TIMEOUT_MS,
      resultPath,
    }),
    "utf8",
  );

  const output = [];
  let helper;
  try {
    helper = spawn(
      POWERSHELL,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        JOB_RUNNER_SCRIPT,
        "-RequestPath",
        requestPath,
      ],
      {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    helper.stdout.on("data", (chunk) => output.push(chunk.toString()));
    helper.stderr.on("data", (chunk) => output.push(chunk.toString()));

    const watchdogMs =
      timeoutMs + descendantExitTimeoutMs + JOB_CLEANUP_TIMEOUT_MS + JOB_RUNNER_WATCHDOG_GRACE_MS;
    const helperExit = await waitForHelperExit(helper, watchdogMs);
    if (helperExit.timedOut) {
      throw new ProcessTreeTimeoutError(label, timeoutMs, output.join(""));
    }

    const rawResult = await readFile(resultPath, "utf8").catch(() => "");
    if (rawResult.length === 0) {
      throw new Error(
        `${label} Windows Job Object runner exited without a result (${helperExit.code}):\n${output.join(
          "",
        )}`,
      );
    }
    const result = normalizeJobResult(JSON.parse(rawResult.replace(/^\uFEFF/u, "")));
    await assertOwnedIdentitiesStopped(result.ownedIdentities);
    if (!result.cleanupSucceeded) {
      throw new Error(`${label} Windows Job Object cleanup did not reach zero active processes.`);
    }

    const combinedOutput = output.join("");
    if (result.kind === "timeout") {
      throw new ProcessTreeTimeoutError(label, timeoutMs, combinedOutput);
    }
    if (result.kind === "leak") {
      throw new ProcessTreeLeakError(label, result.processIds, combinedOutput);
    }
    if (result.kind === "error") {
      throw new Error(`${label} could not run in a Windows Job Object: ${result.message}`);
    }
    if (result.kind !== "exit" || result.exitCode === null) {
      throw new Error(`${label} Windows Job Object runner returned an invalid result.`);
    }

    return {
      code: result.exitCode,
      signal: null,
      output: combinedOutput,
      rootProcessId: result.rootProcessId,
    };
  } finally {
    if (helper !== undefined && helper.exitCode === null && helper.signalCode === null) {
      helper.kill();
    }
    await rm(controlDirectory, { recursive: true, force: true });
  }
}

export function selectMatchingProcessIdentities(owned, snapshot) {
  const liveByProcessId = new Map(snapshot.map((identity) => [identity.processId, identity.creationKey]));
  const matching = [];
  const seen = new Set();
  for (const identity of owned) {
    const key = `${identity.processId}:${identity.creationKey}`;
    if (!seen.has(key) && liveByProcessId.get(identity.processId) === identity.creationKey) {
      seen.add(key);
      matching.push(identity);
    }
  }
  return matching;
}

async function waitForHelperExit(helper, watchdogMs) {
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    helper.kill();
  }, watchdogMs);
  const exited = new Promise((resolve, reject) => {
    helper.once("error", reject);
    helper.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    return { ...(await exited), timedOut };
  } finally {
    clearTimeout(watchdog);
  }
}

function normalizeJobResult(value) {
  const kind = typeof value.Kind === "string" ? value.Kind : "";
  const exitCode = Number.isInteger(value.ExitCode) ? value.ExitCode : null;
  const rootProcessId = Number.isInteger(value.RootProcessId) ? value.RootProcessId : 0;
  const processIds = Array.isArray(value.ProcessIds)
    ? value.ProcessIds.filter((processId) => Number.isInteger(processId) && processId > 0)
    : [];
  const ownedIdentities = Array.isArray(value.OwnedIdentities)
    ? value.OwnedIdentities.flatMap((identity) => {
        const processId = Number(identity?.ProcessId);
        const creationKey = typeof identity?.CreationKey === "string" ? identity.CreationKey : "";
        return Number.isInteger(processId) && processId > 0 && creationKey.length > 0
          ? [{ processId, creationKey }]
          : [];
      })
    : [];
  return {
    kind,
    exitCode,
    rootProcessId,
    processIds,
    ownedIdentities,
    cleanupSucceeded: value.CleanupSucceeded === true,
    message: typeof value.Message === "string" ? value.Message : "Unknown Job Object failure.",
  };
}

async function assertOwnedIdentitiesStopped(ownedIdentities) {
  if (ownedIdentities.length === 0) {
    return;
  }
  const snapshot = await readProcessSnapshot();
  const remaining = selectMatchingProcessIdentities(ownedIdentities, snapshot);
  if (remaining.length > 0) {
    throw new Error(
      `Windows Job Object cleanup left owned process identities running: ${remaining
        .map(({ creationKey }) => creationKey)
        .join(", ")}.`,
    );
  }
}

async function readProcessSnapshot() {
  const { stdout } = await execFileAsync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PROCESS_SNAPSHOT_SCRIPT],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: PROCESS_SNAPSHOT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  const parsed = JSON.parse(stdout.trim() || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((process) => ({
      processId: Number(process.ProcessId),
      creationKey: typeof process.CreationKey === "string" ? process.CreationKey : "",
    }))
    .filter(
      ({ processId, creationKey }) => Number.isInteger(processId) && processId > 0 && creationKey.length > 0,
    );
}

function assertWindows() {
  if (process.platform !== "win32") {
    throw new Error("Electron process-tree probes require Windows process ownership.");
  }
}
