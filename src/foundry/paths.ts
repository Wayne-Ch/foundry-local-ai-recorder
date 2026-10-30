import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface RecorderPaths {
  readonly appDataDir: string;
  readonly logsDir: string;
  readonly modelCacheDir: string;
  readonly audioTempDir: string;
}

export async function resolveRecorderPaths(): Promise<RecorderPaths> {
  const appDataDir = platformAppDataDir();
  const logsDir = path.join(appDataDir, "logs");
  const modelCacheDir = sharedModelCacheDir(appDataDir);
  const audioTempDir = path.join(os.tmpdir(), "FoundryLocalSmartAIRecorder", "audio");
  await Promise.all([
    mkdir(appDataDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(modelCacheDir, { recursive: true }),
    mkdir(audioTempDir, { recursive: true }),
  ]);
  return { appDataDir, logsDir, modelCacheDir, audioTempDir };
}

function platformAppDataDir(): string {
  const override = process.env.SMART_RECORDER_APP_DATA_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const root = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
  return path.join(root, "FoundryLocalSmartAIRecorder");
}

function sharedModelCacheDir(appDataDir: string): string {
  const override = process.env.FOUNDRY_MODEL_CACHE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const foundrySharedCache = path.join(os.homedir(), ".foundry", "cache", "models");
  return existsSync(foundrySharedCache) ? foundrySharedCache : path.join(appDataDir, "models");
}
