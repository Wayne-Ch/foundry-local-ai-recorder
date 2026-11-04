import { describe, expect, it } from "vitest";
import {
  ProcessTreeLeakError,
  ProcessTreeTimeoutError,
  runOwnedProcess,
} from "../scripts/electron-process-tree.mjs";

describe("Windows process-tree ownership", () => {
  it.runIf(process.platform === "win32")(
    "fails a successful parent when an orphan descendant survives, then removes the orphan",
    async () => {
      const parentScript = `
        import { spawn } from "node:child_process";
        const descendant = spawn(
          process.execPath,
          ["--input-type=module", "-e", "setInterval(() => {}, 1000);"],
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        console.log("ORPHAN_PID=" + descendant.pid);
        descendant.unref();
        setTimeout(() => process.exit(0), 750);
      `;

      let failure: unknown;
      try {
        await runOwnedProcess({
          command: process.execPath,
          args: ["--input-type=module", "-e", parentScript],
          cwd: process.cwd(),
          env: process.env,
          label: "orphan self-test",
          timeoutMs: 5_000,
          descendantExitTimeoutMs: 250,
          pollIntervalMs: 50,
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ProcessTreeLeakError);
      const output = failure instanceof ProcessTreeLeakError ? failure.output : String(failure);
      const orphanPid = Number.parseInt(output.match(/ORPHAN_PID=(\d+)/u)?.[1] ?? "", 10);
      expect(Number.isInteger(orphanPid)).toBe(true);
      await expect.poll(() => processExists(orphanPid), { timeout: 3_000 }).toBe(false);
    },
  );

  it.runIf(process.platform === "win32")("terminates the full owned tree on timeout", async () => {
    const parentScript = `
        import { spawn } from "node:child_process";
        const descendant = spawn(
          process.execPath,
          ["--input-type=module", "-e", "setInterval(() => {}, 1000);"],
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        console.log("TIMEOUT_ROOT_PID=" + process.pid);
        console.log("TIMEOUT_CHILD_PID=" + descendant.pid);
        descendant.unref();
        setInterval(() => {}, 1000);
      `;

    let failure: unknown;
    try {
      await runOwnedProcess({
        command: process.execPath,
        args: ["--input-type=module", "-e", parentScript],
        cwd: process.cwd(),
        env: process.env,
        label: "timeout self-test",
        timeoutMs: 1_000,
        descendantExitTimeoutMs: 250,
        pollIntervalMs: 50,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProcessTreeTimeoutError);
    const output = failure instanceof ProcessTreeTimeoutError ? failure.output : String(failure);
    const processIds = [
      Number.parseInt(output.match(/TIMEOUT_ROOT_PID=(\d+)/u)?.[1] ?? "", 10),
      Number.parseInt(output.match(/TIMEOUT_CHILD_PID=(\d+)/u)?.[1] ?? "", 10),
    ];
    expect(processIds.every(Number.isInteger)).toBe(true);
    for (const processId of processIds) {
      await expect.poll(() => processExists(processId), { timeout: 3_000 }).toBe(false);
    }
  });
});

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
