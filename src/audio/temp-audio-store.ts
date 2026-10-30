import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePcm16Wav } from "./audio-contract";

const CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OWNED_CAPTURE_PATTERN = /^capture-[A-Za-z0-9][A-Za-z0-9._-]*\.wav$/;
export const TEMP_AUDIO_FILE_MODE = 0o600;

export interface TempAudioWriteOptions {
  readonly mode: typeof TEMP_AUDIO_FILE_MODE;
}

export interface TempAudioStoreOptions {
  readonly createId?: () => string;
  readonly ensureDirectory?: (directory: string) => Promise<void>;
  readonly listFiles?: (directory: string) => Promise<readonly string[]>;
  readonly write?: (filePath: string, data: Uint8Array, options: TempAudioWriteOptions) => Promise<void>;
  readonly remove?: (filePath: string) => Promise<void>;
}

export interface TempAudioRecoveryReport {
  readonly discovered: number;
  readonly removed: number;
  readonly retained: number;
}

export class TempAudioStore {
  readonly #activePaths = new Set<string>();
  readonly #rootPath: string;
  readonly #createId: () => string;
  readonly #ensureDirectory: (directory: string) => Promise<void>;
  readonly #listFiles: (directory: string) => Promise<readonly string[]>;
  readonly #write: (filePath: string, data: Uint8Array, options: TempAudioWriteOptions) => Promise<void>;
  readonly #remove: (filePath: string) => Promise<void>;

  constructor(
    readonly rootDir: string,
    options: TempAudioStoreOptions = {},
  ) {
    this.#rootPath = path.resolve(rootDir);
    this.#createId = options.createId ?? randomUUID;
    this.#ensureDirectory =
      options.ensureDirectory ??
      (async (directory) => {
        await mkdir(directory, { recursive: true });
      });
    this.#listFiles =
      options.listFiles ??
      (async (directory) =>
        (await readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name));
    this.#write =
      options.write ??
      (async (filePath, data, writeOptions) => {
        await writeFile(filePath, data, writeOptions);
      });
    this.#remove = options.remove ?? unlink;
  }

  get activeCount(): number {
    return this.#activePaths.size;
  }

  async recoverOwnedCaptures(): Promise<TempAudioRecoveryReport> {
    let fileNames: readonly string[];
    try {
      fileNames = await this.#listFiles(this.#rootPath);
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        return { discovered: 0, removed: 0, retained: 0 };
      }
      throw error;
    }

    const ownedFileNames = [...new Set(fileNames.filter((fileName) => OWNED_CAPTURE_PATTERN.test(fileName)))];
    let removed = 0;
    for (const fileName of ownedFileNames) {
      const filePath = this.#resolveOwnedPath(fileName);
      this.#activePaths.add(filePath);
      try {
        await this.remove(filePath);
        removed += 1;
      } catch (error) {
        if (!isRetryableRemovalError(error)) {
          throw error;
        }
      }
    }

    return {
      discovered: ownedFileNames.length,
      removed,
      retained: this.#activePaths.size,
    };
  }

  async createWav(pcmBytes: Uint8Array): Promise<string> {
    await this.#ensureDirectory(this.#rootPath);
    const captureId = this.#createId();
    if (!CAPTURE_ID_PATTERN.test(captureId)) {
      throw new Error("Temporary audio capture ID must be a path-safe token.");
    }
    const filePath = this.#resolveOwnedPath(`capture-${captureId}.wav`);
    this.#activePaths.add(filePath);
    try {
      await this.#write(filePath, encodePcm16Wav(pcmBytes), {
        mode: TEMP_AUDIO_FILE_MODE,
      });
      return filePath;
    } catch (writeError) {
      try {
        await this.remove(filePath);
      } catch (cleanupError) {
        throw new AggregateError(
          [writeError, cleanupError],
          `Failed to write temporary audio file ${filePath} and cleanup also failed.`,
        );
      }
      throw writeError;
    }
  }

  async remove(filePath: string): Promise<void> {
    if (!this.#activePaths.has(filePath)) {
      return;
    }
    try {
      await this.#remove(filePath);
      this.#activePaths.delete(filePath);
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        this.#activePaths.delete(filePath);
        return;
      }
      throw error;
    }
  }

  async cleanupAll(): Promise<void> {
    const files = [...this.#activePaths];
    const outcomes = await Promise.allSettled(files.map(async (filePath) => this.remove(filePath)));
    const errors = outcomes
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => outcome.reason);
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, `Failed to remove ${errors.length} temporary audio captures.`);
    }
  }

  #resolveOwnedPath(fileName: string): string {
    if (!OWNED_CAPTURE_PATTERN.test(fileName)) {
      throw new Error(`Refusing non-owned temporary audio path: ${fileName}`);
    }
    const filePath = path.resolve(this.#rootPath, fileName);
    const relativePath = path.relative(this.#rootPath, filePath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Temporary audio path escaped its owned directory: ${fileName}`);
    }
    return filePath;
  }
}

export async function withTemporaryWav<T>(
  store: TempAudioStore,
  pcmBytes: Uint8Array,
  operation: (filePath: string) => Promise<T>,
): Promise<T> {
  const filePath = await store.createWav(pcmBytes);
  try {
    return await operation(filePath);
  } finally {
    await store.remove(filePath);
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRetryableRemovalError(error: unknown): boolean {
  return ["EACCES", "EBUSY", "EPERM"].some((code) => isFileSystemError(error, code));
}
