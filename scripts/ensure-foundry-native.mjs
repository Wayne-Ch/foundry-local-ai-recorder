import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WINDOWS_NATIVE_FILES = [
  "foundry_local_node.node",
  "foundry_local_preload.node",
  "foundry_local.dll",
  "Microsoft.Windows.AI.MachineLearning.dll",
  "onnxruntime.dll",
  "onnxruntime-genai.dll",
  "onnxruntime_providers_shared.dll",
];

const ORT_PRIMARY_FILE = "onnxruntime.dll";
const ORT_SHARED_FILE = "onnxruntime_providers_shared.dll";

export function missingRequiredNativeFiles({
  prebuildDirectory,
  platform = process.platform,
  exists = existsSync,
}) {
  if (platform !== "win32") {
    return [];
  }
  return WINDOWS_NATIVE_FILES.filter((fileName) => !exists(path.join(prebuildDirectory, fileName)));
}

export function ensureFoundryNative({
  cwd = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  spawn = spawnSync,
} = {}) {
  const sdkRoot = path.resolve(cwd, "node_modules", "foundry-local-sdk");
  const installer = path.join(sdkRoot, "script", "install-native.cjs");
  if (!existsSync(installer)) {
    throw new Error("foundry-local-sdk is not installed. Run npm ci and retry.");
  }

  const prebuildDirectory = path.join(sdkRoot, "prebuilds", `${platform}-${arch}`);
  const missingBefore = missingRequiredNativeFiles({ prebuildDirectory, platform });
  const primaryPath = path.join(prebuildDirectory, ORT_PRIMARY_FILE);
  const skipInstall = process.env.FOUNDRY_LOCAL_SKIP_INSTALL === "1";
  let primaryBackup = null;
  if (
    !skipInstall &&
    platform === "win32" &&
    missingBefore.includes(ORT_SHARED_FILE) &&
    existsSync(primaryPath)
  ) {
    primaryBackup = path.join(
      prebuildDirectory,
      `.enhanced-ai-recorder-ort-repair-${process.pid}-${randomUUID()}.dll`,
    );
    renameSync(primaryPath, primaryBackup);
  }

  try {
    const result = spawn(process.execPath, [installer], {
      cwd,
      env: process.env,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.error) {
      throw new Error(
        "Unable to start the Foundry Local native installer. Run npm ci or npm rebuild foundry-local-sdk and retry.",
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `Foundry Local native runtime installation failed with exit code ${result.status}. Run npm rebuild foundry-local-sdk and retry.`,
      );
    }

    if (!skipInstall) {
      const missingAfter = missingRequiredNativeFiles({ prebuildDirectory, platform });
      if (missingAfter.length > 0) {
        throw new Error(
          `Foundry Local native runtime installation is incomplete. Missing required files: ${missingAfter.join(
            ", ",
          )}. Run npm rebuild foundry-local-sdk (or npm ci) and retry.`,
        );
      }
    }
  } catch (error) {
    restorePrimaryBackup(primaryBackup, primaryPath);
    throw error;
  }

  discardPrimaryBackup(primaryBackup);
}

function restorePrimaryBackup(backupPath, primaryPath) {
  if (backupPath === null || !existsSync(backupPath)) {
    return;
  }
  if (existsSync(primaryPath)) {
    rmSync(backupPath, { force: true });
    return;
  }
  renameSync(backupPath, primaryPath);
}

function discardPrimaryBackup(backupPath) {
  if (backupPath !== null) {
    rmSync(backupPath, { force: true });
  }
}

function safeInstallError(error) {
  if (
    error instanceof Error &&
    (error.message.startsWith("foundry-local-sdk is not installed.") ||
      error.message.startsWith("Unable to start the Foundry Local native installer.") ||
      error.message.startsWith("Foundry Local native runtime installation"))
  ) {
    return error.message;
  }
  return "Foundry Local native runtime setup failed. Run npm ci or npm rebuild foundry-local-sdk and retry.";
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  try {
    ensureFoundryNative();
  } catch (error) {
    console.error(`[enhanced-ai-recorder] ${safeInstallError(error)}`);
    process.exitCode = 1;
  }
}
