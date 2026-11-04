export const WINDOWS_NATIVE_FILES: readonly string[];

export interface MissingRequiredNativeFilesOptions {
  readonly prebuildDirectory: string;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (filePath: string) => boolean;
}

export interface EnsureFoundryNativeOptions {
  readonly cwd?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: NodeJS.ProcessEnv;
      readonly encoding: "utf8";
      readonly stdio: "inherit";
    },
  ) => {
    readonly error?: Error;
    readonly status: number | null;
  };
}

export function missingRequiredNativeFiles(options: MissingRequiredNativeFilesOptions): readonly string[];

export function ensureFoundryNative(options?: EnsureFoundryNativeOptions): void;
