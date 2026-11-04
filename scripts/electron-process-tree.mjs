import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POWERSHELL = "powershell.exe";
const PROCESS_SNAPSHOT_TIMEOUT_MS = 5_000;
const CHILD_DISCOVERY_GRACE_MS = PROCESS_SNAPSHOT_TIMEOUT_MS;
const CLEANUP_ATTEMPTS = 12;

const PROCESS_SNAPSHOT_SCRIPT = `
$ErrorActionPreference = "Stop"
$items = @(
  Get-CimInstance Win32_Process | ForEach-Object {
    [PSCustomObject]@{
      ProcessId = [int]$_.ProcessId
      ParentProcessId = [int]$_.ParentProcessId
      CreationDate = if ($null -eq $_.CreationDate) {
        ""
      } else {
        $_.CreationDate.ToUniversalTime().ToString("o")
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
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error(`${label} did not expose a process identifier.`);
  }

  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const closePromise = new Promise((resolve) => {
    child.once("close", () => resolve());
  });
  const tracker = new WindowsProcessTreeTracker(child.pid, Date.now());
  let cleanupCompleted = false;

  try {
    await tracker.refresh();
    const deadline = Date.now() + timeoutMs;
    let exit = null;
    while (exit === null && Date.now() < deadline) {
      await tracker.refresh();
      exit = await Promise.race([
        exitPromise,
        delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))).then(() => null),
      ]);
    }
    if (exit === null) {
      await terminateOwnedTree(tracker, child.pid, pollIntervalMs);
      cleanupCompleted = true;
      await settleExit(exitPromise);
      await settleClose(closePromise);
      throw new ProcessTreeTimeoutError(label, timeoutMs, output.join(""));
    }

    const descendantsDeadline = Date.now() + descendantExitTimeoutMs;
    let remaining = await tracker.refresh();
    while (remaining.length > 0 && Date.now() < descendantsDeadline) {
      await delay(pollIntervalMs);
      remaining = await tracker.refresh();
    }
    if (remaining.length > 0) {
      const leakedProcessIds = remaining.map(({ processId }) => processId);
      await terminateOwnedTree(tracker, child.pid, pollIntervalMs);
      cleanupCompleted = true;
      await settleClose(closePromise);
      throw new ProcessTreeLeakError(label, leakedProcessIds, output.join(""));
    }

    await settleClose(closePromise);
    return {
      ...exit,
      output: output.join(""),
      rootProcessId: child.pid,
    };
  } catch (error) {
    if (!cleanupCompleted) {
      await terminateOwnedTree(tracker, child.pid, pollIntervalMs).catch((cleanupError) => {
        throw new AggregateError(
          [error, cleanupError],
          `${label} failed and its owned process tree could not be fully cleaned up.`,
        );
      });
      await settleExit(exitPromise);
      await settleClose(closePromise);
    }
    throw error;
  }
}

class WindowsProcessTreeTracker {
  constructor(rootProcessId, startedAt) {
    this.rootProcessId = rootProcessId;
    this.startedAt = startedAt;
    this.known = new Map([
      [
        rootProcessId,
        {
          processId: rootProcessId,
          parentProcessId: 0,
          creationKey: null,
          createdAtMs: startedAt,
          lastSeenAt: startedAt,
        },
      ],
    ]);
  }

  async refresh() {
    const snapshot = await readProcessSnapshot();
    const now = Date.now();
    const byProcessId = new Map(snapshot.map((process) => [process.processId, process]));
    const root = byProcessId.get(this.rootProcessId);
    if (
      root !== undefined &&
      (root.createdAtMs === 0 || root.createdAtMs >= this.startedAt - PROCESS_SNAPSHOT_TIMEOUT_MS)
    ) {
      this.remember(root, now);
    }

    for (const [processId, known] of this.known) {
      const current = byProcessId.get(processId);
      if (current !== undefined && current.creationKey === known.creationKey) {
        known.lastSeenAt = now;
      }
    }

    let discovered = true;
    while (discovered) {
      discovered = false;
      for (const process of snapshot) {
        const parent = this.known.get(process.parentProcessId);
        if (parent === undefined || !isPlausibleChild(process, parent)) {
          continue;
        }
        discovered = this.remember(process, now) || discovered;
      }
    }

    return [...this.known.values()]
      .filter((known) => byProcessId.get(known.processId)?.creationKey === known.creationKey)
      .map(({ processId, parentProcessId }) => ({ processId, parentProcessId }));
  }

  remember(process, now) {
    const existing = this.known.get(process.processId);
    if (existing !== undefined) {
      if (existing.creationKey === null) {
        this.known.set(process.processId, {
          ...process,
          lastSeenAt: now,
        });
        return true;
      }
      if (existing.creationKey !== process.creationKey) {
        return false;
      }
      existing.lastSeenAt = now;
      return false;
    }
    this.known.set(process.processId, {
      ...process,
      lastSeenAt: now,
    });
    return true;
  }
}

function isPlausibleChild(process, parent) {
  if (
    process.createdAtMs !== 0 &&
    parent.createdAtMs !== 0 &&
    process.createdAtMs < parent.createdAtMs - 1_000
  ) {
    return false;
  }
  return process.createdAtMs === 0 || process.createdAtMs <= parent.lastSeenAt + CHILD_DISCOVERY_GRACE_MS;
}

async function terminateOwnedTree(tracker, rootProcessId, pollIntervalMs) {
  let remaining = [];
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    const current = await tracker.refresh();
    const processIds = [
      rootProcessId,
      ...current.map(({ processId }) => processId).filter((processId) => processId !== rootProcessId),
    ];
    await stopProcesses(processIds);
    await delay(pollIntervalMs);
    remaining = await tracker.refresh();
    if (remaining.length === 0) {
      return;
    }
  }
  throw new Error(
    `Owned process cleanup left process IDs running: ${remaining
      .map(({ processId }) => processId)
      .join(", ")}.`,
  );
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
    .map((process) => {
      const processId = Number(process.ProcessId);
      const parentProcessId = Number(process.ParentProcessId);
      const creationDate = typeof process.CreationDate === "string" ? process.CreationDate : "";
      return {
        processId,
        parentProcessId,
        creationKey: `${processId}:${creationDate}`,
        createdAtMs: Number.isFinite(Date.parse(creationDate)) ? Date.parse(creationDate) : 0,
      };
    })
    .filter(
      ({ processId, parentProcessId }) =>
        Number.isInteger(processId) && processId > 0 && Number.isInteger(parentProcessId),
    );
}

async function stopProcesses(processIds) {
  const uniqueProcessIds = [...new Set(processIds)].filter(
    (processId) => Number.isInteger(processId) && processId > 0,
  );
  if (uniqueProcessIds.length === 0) {
    return;
  }
  const script = `
$processIds = @(${uniqueProcessIds.join(",")})
foreach ($processId in $processIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
`;
  await execFileAsync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      timeout: PROCESS_SNAPSHOT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
}

async function settleExit(exitPromise) {
  await Promise.race([exitPromise.catch(() => undefined), delay(2_000)]);
}

async function settleClose(closePromise) {
  await Promise.race([closePromise, delay(2_000)]);
}

function assertWindows() {
  if (process.platform !== "win32") {
    throw new Error("Electron process-tree probes require Windows process ownership.");
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
