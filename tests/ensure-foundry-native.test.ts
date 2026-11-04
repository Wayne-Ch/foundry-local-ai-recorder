import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureFoundryNative, WINDOWS_NATIVE_FILES } from "../scripts/ensure-foundry-native.mjs";
import { missingFoundryNativeRuntimeFiles } from "../src/foundry/native-runtime";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Foundry native materialization", () => {
  it("post-verifies the same complete Windows file set as the Prepare preflight", () => {
    const preflightFiles = missingFoundryNativeRuntimeFiles({
      platform: "win32",
      arch: "x64",
      resolveSdkEntry: () => path.join("C:\\repo", "node_modules", "foundry-local-sdk", "dist", "index.js"),
      exists: () => false,
    });

    expect(WINDOWS_NATIVE_FILES).toEqual(preflightFiles);
  });

  it("repairs a partial ORT artifact when the primary DLL exists but the shared provider DLL is missing", async () => {
    const fixture = await createFixture(["onnxruntime_providers_shared.dll"]);
    const spawn = vi.fn(() => {
      expect(existsSync(fixture.primaryPath)).toBe(false);
      writeFileSync(fixture.primaryPath, "repaired primary");
      writeFileSync(fixture.sharedPath, "repaired shared");
      return successfulSpawn();
    });

    ensureFoundryNative({
      cwd: fixture.root,
      platform: "win32",
      arch: "x64",
      spawn,
    });

    expect(spawn).toHaveBeenCalledOnce();
    expect(existsSync(fixture.primaryPath)).toBe(true);
    expect(existsSync(fixture.sharedPath)).toBe(true);
    await expect(
      (await import("node:fs/promises"))
        .readdir(fixture.prebuildDirectory)
        .then((files) => files.some((file) => file.startsWith(".ai-recorder-ort-repair-"))),
    ).resolves.toBe(false);
  });

  it("fails safely and actionably when installation still leaves a required native file missing", async () => {
    const fixture = await createFixture(["onnxruntime_providers_shared.dll"]);
    const spawn = vi.fn(() => {
      writeFileSync(fixture.primaryPath, "still partial");
      return successfulSpawn();
    });

    let failure: unknown;
    try {
      ensureFoundryNative({
        cwd: fixture.root,
        platform: "win32",
        arch: "x64",
        spawn,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toContain("onnxruntime_providers_shared.dll");
    expect(message).toContain("npm rebuild foundry-local-sdk");
    expect(message).not.toContain(fixture.root);
    expect(existsSync(fixture.primaryPath)).toBe(true);
  });

  it("preserves the primary DLL when explicit SDK installation bypass is enabled", async () => {
    const fixture = await createFixture(["onnxruntime_providers_shared.dll"]);
    const previous = process.env.FOUNDRY_LOCAL_SKIP_INSTALL;
    process.env.FOUNDRY_LOCAL_SKIP_INSTALL = "1";
    try {
      const spawn = vi.fn(() => {
        expect(existsSync(fixture.primaryPath)).toBe(true);
        return successfulSpawn();
      });

      ensureFoundryNative({
        cwd: fixture.root,
        platform: "win32",
        arch: "x64",
        spawn,
      });

      expect(spawn).toHaveBeenCalledOnce();
      expect(existsSync(fixture.primaryPath)).toBe(true);
      expect(existsSync(fixture.sharedPath)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.FOUNDRY_LOCAL_SKIP_INSTALL;
      } else {
        process.env.FOUNDRY_LOCAL_SKIP_INSTALL = previous;
      }
    }
  });
});

async function createFixture(missing: readonly string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-recorder-native-"));
  tempRoots.push(root);
  const sdkRoot = path.join(root, "node_modules", "foundry-local-sdk");
  const installer = path.join(sdkRoot, "script", "install-native.cjs");
  const prebuildDirectory = path.join(sdkRoot, "prebuilds", "win32-x64");
  await mkdir(path.dirname(installer), { recursive: true });
  await mkdir(prebuildDirectory, { recursive: true });
  await writeFile(installer, "process.exitCode = 0;\n", "utf8");
  await Promise.all(
    WINDOWS_NATIVE_FILES.filter((fileName) => !missing.includes(fileName)).map((fileName) =>
      writeFile(path.join(prebuildDirectory, fileName), fileName, "utf8"),
    ),
  );
  return {
    root,
    prebuildDirectory,
    primaryPath: path.join(prebuildDirectory, "onnxruntime.dll"),
    sharedPath: path.join(prebuildDirectory, "onnxruntime_providers_shared.dll"),
  };
}

function successfulSpawn(): { readonly status: 0 } {
  return { status: 0 };
}
