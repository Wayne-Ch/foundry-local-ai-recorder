import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PRODUCT_STORAGE_NAMESPACE } from "../shared/product";

export interface RecorderPaths {
  readonly appDataDir: string;
  readonly logsDir: string;
  readonly modelCacheDir: string;
  readonly audioTempDir: string;
}

export function recorderOwnedPathLayout(
  localAppDataRoot: string,
  tempRoot: string,
): Pick<RecorderPaths, "appDataDir" | "logsDir" | "audioTempDir"> {
  const appDataDir = path.join(localAppDataRoot, PRODUCT_STORAGE_NAMESPACE);
  return {
    appDataDir,
    logsDir: path.join(appDataDir, "logs"),
    audioTempDir: path.join(tempRoot, PRODUCT_STORAGE_NAMESPACE, "audio"),
  };
}

export async function resolveRecorderPaths(): Promise<RecorderPaths> {
  const owned = recorderOwnedPathLayout(platformAppDataRoot(), os.tmpdir());
  const appDataDir = process.env.AI_RECORDER_APP_DATA_DIR?.trim()
    ? path.resolve(process.env.AI_RECORDER_APP_DATA_DIR.trim())
    : owned.appDataDir;
  const logsDir = path.join(appDataDir, "logs");
  const modelCacheDir = sharedModelCacheDir(appDataDir);
  const audioTempDir = owned.audioTempDir;
  await Promise.all([
    mkdir(appDataDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(modelCacheDir, { recursive: true }),
    mkdir(audioTempDir, { recursive: true }),
  ]);
  return { appDataDir, logsDir, modelCacheDir, audioTempDir };
}

function platformAppDataRoot(): string {
  return process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
}

function sharedModelCacheDir(appDataDir: string): string {
  const override = process.env.FOUNDRY_MODEL_CACHE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const foundrySharedCache = path.join(os.homedir(), ".foundry", "cache", "models");
  return existsSync(foundrySharedCache) ? foundrySharedCache : path.join(appDataDir, "models");
}
