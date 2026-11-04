import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProcessTreeLeakError,
  ProcessTreeTimeoutError,
  runOwnedProcess,
  selectMatchingProcessIdentities,
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

  it.runIf(process.platform === "win32")(
    "owns a detached grandchild created by a transient intermediary before the first snapshot",
    async () => {
      const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-recorder-job-race-"));
      const intermediaryPath = path.join(fixtureDirectory, "intermediary.mjs");
      const grandchildPath = path.join(fixtureDirectory, "grandchild.mjs");
      const grandchildPidPath = path.join(fixtureDirectory, "grandchild.pid");
      const stopPath = path.join(fixtureDirectory, "stop");
      await Promise.all([
        writeFile(
          intermediaryPath,
          `
            import { spawn } from "node:child_process";
            import { writeFileSync } from "node:fs";
            const [grandchildPath, grandchildPidPath, stopPath] = process.argv.slice(2);
            const grandchild = spawn(process.execPath, [grandchildPath, stopPath], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
            writeFileSync(grandchildPidPath, String(grandchild.pid), "utf8");
            grandchild.unref();
          `,
          "utf8",
        ),
        writeFile(
          grandchildPath,
          `
            import { existsSync } from "node:fs";
            const stopPath = process.argv[2];
            const timer = setInterval(() => {
              if (existsSync(stopPath)) {
                clearInterval(timer);
                process.exit(0);
              }
            }, 50);
          `,
          "utf8",
        ),
      ]);
      const rootScript = `
        import { spawn } from "node:child_process";
        const intermediary = spawn(
          process.execPath,
          ${JSON.stringify([intermediaryPath, grandchildPath, grandchildPidPath, stopPath])},
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        intermediary.unref();
      `;

      let grandchildPid = Number.NaN;
      try {
        let failure: unknown;
        try {
          await runOwnedProcess({
            command: process.execPath,
            args: ["--input-type=module", "-e", rootScript],
            cwd: process.cwd(),
            env: process.env,
            label: "transient intermediary self-test",
            timeoutMs: 5_000,
            descendantExitTimeoutMs: 250,
            pollIntervalMs: 50,
          });
        } catch (error) {
          failure = error;
        }

        await expect
          .poll(
            async () => {
              const value = await readFile(grandchildPidPath, "utf8").catch(() => "");
              return Number.parseInt(value, 10);
            },
            { timeout: 3_000 },
          )
          .toSatisfy(Number.isInteger);
        grandchildPid = Number.parseInt(await readFile(grandchildPidPath, "utf8"), 10);
        expect(failure).toBeInstanceOf(ProcessTreeLeakError);
        await expect.poll(() => processExists(grandchildPid), { timeout: 3_000 }).toBe(false);
      } finally {
        await writeFile(stopPath, "", "utf8").catch(() => undefined);
        if (Number.isInteger(grandchildPid)) {
          await expect.poll(() => processExists(grandchildPid), { timeout: 3_000 }).toBe(false);
        }
        await rm(fixtureDirectory, { recursive: true, force: true });
      }
    },
  );

  it("never selects an unrelated PID replacement for termination after an injected snapshot", () => {
    const original = {
      processId: 4242,
      creationKey: "4242:owned-creation",
    };
    const replacement = {
      processId: 4242,
      creationKey: "4242:replacement-creation",
    };
    const terminated = selectMatchingProcessIdentities([original], [replacement]);

    expect(terminated).toEqual([]);
    expect(selectMatchingProcessIdentities([original], [original])).toEqual([original]);
  });

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
